"""カードショップわいTV(名探偵コナンTCG含む複数TCG取扱店)から価格を取得し
price_history に保存するモジュール。

わいTV(Ocnk系ECカート)は、カードラボ・竜のしっぽ・メルカードと同じ系列の
HTML構造(`li.list_item_cell`, `.goods_name`, `.price .figure`)を使っている。

ただし商品名にはカード番号がそのまま入っておらず、「カード名（[パック ]ID[xxxx]
レアリティ） 状態X」という独自形式になっている
(例: "赤木英雄（CT-P10 ID[P082] C） 状態A"、パック無しの例: "探偵の目（ID[0407] PR） 状態A")。
この「ID」はDBの`card_id`列(レアリティ違いをまとめる業務キー)と一致する
(実際に card_id="0179" の江戸川コナンPRがサイト上でも「ID[0179] PR」と表記されて
いることを確認済み)。そのため (card_id, rarity) の組み合わせでカードを特定する。

メルカードと同様、「PR」のように同じcard_idに何十種類ものプロモ違いが存在する
レアリティだと (card_id, rarity) だけでは1枚に絞り込めないことがある
(例: 江戸川コナンのPRカードだけでcard_id=P001に10種類以上ある)。パック表記
(例: "CT-P10")が商品名に付いている場合はそれも使って絞り込む。

SECレアリティは同じcard_id+rarityで2種類の実物カード(card_num末尾がSec1/Sec2)が
存在するが、商品名中の「レンガ」(無印, Sec1)「サイン入り」(Sec2)という注記で
判別できる(トレカバースで判明した対応と同じ)。detect_variant_suffix()で判定して
絞り込みに使う。それでも絞り込めない場合はレコードしない(誤った価格を書き込む
より記録しない方が安全)。

「《未開封》」で始まる商品名は、チャレンジ戦・探偵マスターズ等の未開封プロモ
パックの出品で、中身の1枚だけの単品カードとは全く別物の値段になるため除外する。

売り切れの商品は一覧から消えず、<li>に"list_item_soldout"クラスが付いたまま
最後に売れた時の価格が表示され続ける(2026-08-16にSR中森銀三で発覚)。これを
チェックせず記録すると、売り切れなのに古い価格が最新の相場として残り続けて
しまうため除外する。

対象カテゴリは「コナンカード」カテゴリ(product-list/110)。単品カード以外
(オリパ・BOX等)も同じカテゴリに混在しているが、それらは「ID[...]」表記を
持たないため、正規表現にマッチせず自然に除外される。

わいTVのrobots.txtには一般クローラー向けのDisallow指定が無い(AI学習ボットのみ
拒否)が、他サイトと同様に安全側でリクエスト間隔30秒を採用する。
"""
import logging
import re
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import requests
from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import db
from unresolved_report import write_unresolved

BASE_URL = "https://www.cardshop-waitv.net/product-list/110"
PAGE_SIZE = 120

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

REQUEST_TIMEOUT = 15
REQUEST_DELAY_SEC = 30
MAX_PAGES = 60

# 商品名の中の「[パック ]ID[xxxx] レアリティ」を取り出す(半角[]/全角［］どちらもあり得る)。
# パック表記は無いことも多いため任意。「一球入魂パラレル」等の別の注記カッコが
# 先に出てくることがあるため、末尾固定ではなく「ID[...]」を目印にsearchする。
# レアリティの直後に「SECレンガ」のように日本語の注記が閉じ括弧との間に挟まる
# ことがあるため、レアリティ自体は英数字のみ拾い、それ以降は読み飛ばす
# (以前はレアリティ直後が英数字以外だと正規表現ごとマッチせず、商品自体が
# 丸ごと読み飛ばされていた)。
# パック表記にはPRカードの「PR_vol11」「PR_vol11_kira」のようにアンダースコア
# 区切りのものもあるため、文字クラスに"_"も含める(以前は無く、末尾の"kira"等
# 一部しか拾えていなかった)。
NAME_PATTERN = re.compile(
    r"(?:([A-Za-z0-9_\-]+)\s+)?ID[\[［]([^\]］]+)[\]］]\s+([A-Za-z0-9]+)[^）)]*[）)]"
)
ALNUM_ONLY_PATTERN = re.compile(r"[^A-Za-z0-9]+")


def detect_variant_suffix(name_text: str) -> str | None:
    """商品名全体(例: "横溝重悟（CT-P09 ID[P077] SECレンガ） 状態A")から、
    SECの2種類(Sec1=レンガ/無印, Sec2=サイン入り)を判別する。どちらでもなければNone。
    「レンガ」の位置はレアリティ直後の場合と、名前直後の別の括弧内の場合の両方が
    あるため、括弧の位置に依らずタイトル全体から探す。

    同様に一部のパック(CT-P10等)の高レアには通常版と絵違いの「IFパラレル」が
    同じcard_id+レアリティで存在し、card_num末尾に"2"が付くだけの別カードとして
    登録されている(例: 通常版B10065P、IFパラレルB10065P2)。商品名の
    「IFパラレル」という注記で判別する。
    """
    if "サイン" in name_text:
        return "Sec2"
    if "レンガ" in name_text:
        return "Sec1"
    if "IFパラレル" in name_text:
        return "IF"
    return None

logger = logging.getLogger(__name__)


def normalize_id(value: str) -> str:
    """card_idと商品名中のIDの表記ゆれ(先頭ゼロの有無)を吸収して比較できる形にする。"""
    value = value.strip()
    return str(int(value)) if value.isdigit() else value.upper()


def normalize_pack_code(value: str) -> str:
    """収録パック表記の表記ゆれ(ハイフンの有無・位置)を吸収する。"""
    return ALNUM_ONLY_PATTERN.sub("", value).upper()


# PRカードのパック表記は"PR_vol11"(通常)/"PR_vol11_kira"(キラバージョン)という
# 独自形式で、CT-Pxx系のブースターパックコードとは別物(cards.packの先頭コードとは
# 突き合わせられない)。cards.packの"プロモーションパックVol.11（キラバージョン）"
# 等と比較できる文字列に変換する。
PROMO_PACK_PATTERN = re.compile(r"^PR_vol(\d+)(_kira)?$", re.IGNORECASE)


def normalize_waitv_promo_pack(pack: str) -> str:
    m = PROMO_PACK_PATTERN.match(pack)
    if not m:
        return ""
    text = f"プロモーションパックvol.{m.group(1)}"
    if m.group(2):
        text += "キラバージョン"
    return text


def normalize_db_pack_text(pack: str | None) -> str:
    """cards.packの表記("PRカード（プロモーションパックVol.11（キラバージョン）」等)を、
    normalize_waitv_promo_packと比較できる形に揃える(外側の「PRカード（）」の
    有無・括弧の全角半角・空白の有無・vol.の大文字小文字の表記ゆれを吸収する)。
    """
    if not pack:
        return ""
    pack = pack.strip()
    if pack.startswith("PRカード"):
        pack = pack[len("PRカード"):]
    for ch in "（）() 　":
        pack = pack.replace(ch, "")
    return pack.lower()


def fetch_page(page: int) -> str:
    params = {"num": PAGE_SIZE, "page": page}
    resp = requests.get(BASE_URL, params=params, headers=HEADERS, timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    return resp.text


def parse_items(html: str) -> list[tuple[str, str, str | None, str | None, int]]:
    """(内部ID, レアリティ, 収録パック表記, SEC判別用の注記, 価格) のリストを返す。

    パック表記・SEC判別用の注記は無ければNone。「ID[...]」表記が無い商品
    (オリパ・BOX等)や、「《未開封》」から始まる未開封プロモパックの出品は対象外として除く。
    """
    soup = BeautifulSoup(html, "html.parser")
    results = []
    for li in soup.select("li.list_item_cell"):
        name_el = li.select_one(".goods_name")
        if not name_el:
            continue

        name_text = name_el.get_text()
        if "未開封" in name_text:
            continue

        # 売り切れの商品は<li>に"list_item_soldout"クラスが付き、価格欄には
        # 最後に売れた時の値段が残ったままになる(<p class="stock soldout">在庫数×</p>)。
        # これをチェックしないと、売り切れなのに古い価格を最新の相場として
        # 記録し続けてしまう(実際に中森銀三SRで発生していた不具合)。
        if "list_item_soldout" in (li.get("class") or []):
            continue

        m = NAME_PATTERN.search(name_text)
        if not m:
            continue
        pack, model_number, rarity = m.group(1), m.group(2), m.group(3)
        variant = detect_variant_suffix(name_text)

        price_el = li.select_one(".price .figure")
        if not price_el:
            continue

        price_text = price_el.get_text().replace("¥", "").replace(",", "").strip()
        try:
            price = int(price_text)
        except ValueError:
            continue

        results.append((model_number, rarity, pack, variant, price))
    return results


def parse_total_count(html: str) -> int:
    soup = BeautifulSoup(html, "html.parser")
    el = soup.select_one(".count_number .number")
    if not el:
        return 0
    return int(el.get_text().replace(",", ""))


def build_lookup(conn):
    """カード特定用の対応表を4種類作る。

    - (正規化card_id, レアリティ, 正規化パックコード) -> cards.idのリスト(ブースター用)
    - (正規化card_id, レアリティ, 正規化パック名) -> cards.idのリスト(PRカードの
      "PR_vol11"等の表記用。normalize_waitv_promo_pack/normalize_db_pack_text参照)
    - (正規化card_id, レアリティ) -> cards.idのリスト
    - cards.id -> card_num(SECのSec1/Sec2、IFパラレル、テーマデッキのホイル判別用)
    """
    lookup_with_pack: dict[tuple[str, str, str], list[int]] = defaultdict(list)
    lookup_by_promo_pack: dict[tuple[str, str, str], list[int]] = defaultdict(list)
    lookup: dict[tuple[str, str], list[int]] = defaultdict(list)
    card_num_by_id: dict[int, str] = {}
    for row in db.search_cards(conn):
        base_key = (normalize_id(row["card_id"]), row["rarity"])
        lookup[base_key].append(row["id"])
        card_num_by_id[row["id"]] = row["card_num"]
        pack = row["pack"] or ""
        pack_code = pack.split()[0] if pack.split() else ""
        if pack_code:
            lookup_with_pack[(base_key[0], base_key[1], normalize_pack_code(pack_code))].append(row["id"])
        normalized_pack = normalize_db_pack_text(pack)
        if normalized_pack:
            lookup_by_promo_pack[(base_key[0], base_key[1], normalized_pack)].append(row["id"])
    return lookup_with_pack, lookup_by_promo_pack, lookup, card_num_by_id


def _resolve_if_pair(candidates: list[int], card_num_by_id: dict[int, str], variant: str | None) -> int | None:
    """候補がちょうど2件で、card_numが「無印」「無印+"2"」(IFパラレル)の組になっている
    場合に限り、商品名の注記(IF/無し)に応じてどちらか1件のcards.idを返す。
    それ以外(2件でない、またはIFパラレルの組ではない)はNoneを返す。
    """
    if len(candidates) != 2:
        return None
    pk_a, pk_b = candidates
    num_a, num_b = card_num_by_id.get(pk_a, ""), card_num_by_id.get(pk_b, "")
    if num_a + "2" == num_b:
        if_pk, base_pk = pk_b, pk_a
    elif num_b + "2" == num_a:
        if_pk, base_pk = pk_a, pk_b
    else:
        return None
    return if_pk if variant == "IF" else base_pk


_TRAILING_NUM = re.compile(r"(\d+)$")


def _consecutive_card_nums(num_a: str, num_b: str) -> bool:
    """card_numの接頭辞(英字部分)が一致し、末尾の数字部分がちょうど1違いの連番かどうか。
    例: D08019/D08020 -> True。同じcard_idが別デッキに再録されているケース
    (例: D01002/D08022)はFalseになる。
    """
    m_a, m_b = _TRAILING_NUM.search(num_a), _TRAILING_NUM.search(num_b)
    if not m_a or not m_b:
        return False
    if num_a[: m_a.start()] != num_b[: m_b.start()]:
        return False
    return abs(int(m_a.group(1)) - int(m_b.group(1))) == 1


def _resolve_foil_pair(candidates: list[int], card_num_by_id: dict[int, str]) -> int | None:
    """テーマデッキのDレアリティは、通常版とホイル(キラ)加工版が連番のcard_numで
    別カードとして登録されているが、わいTVの商品名にはどちらか判別できる注記が
    一切無い(トレカバースの「キラ加工」・メルカードの「ホイル版」に相当する表記が
    無いことを確認済み)。候補がちょうど2件かつ実際に連番の場合に限り、判別材料が
    無い以上は安全側として常に大きい方(通常版)とみなす(メルカードで注記が無い
    場合に無印側とみなす方針と同じ)。それ以外はNoneを返す。
    """
    if len(candidates) != 2:
        return None
    ordered = sorted(candidates, key=lambda pk: card_num_by_id.get(pk, ""))
    if not _consecutive_card_nums(card_num_by_id.get(ordered[0], ""), card_num_by_id.get(ordered[1], "")):
        return None
    return ordered[1]


def resolve_candidate(model_number, rarity, pack, variant, lookup_with_pack, lookup_by_promo_pack, lookup, card_num_by_id):
    """(内部ID, レアリティ, 収録パック表記, SEC/IF判別用の注記) から、1枚に絞り込めれば
    そのcards.idを、絞り込めなければNoneを返す。
    """
    norm_id = normalize_id(model_number)
    base_key = (norm_id, rarity)

    pack_candidates = None
    if pack:
        pack_candidates = lookup_with_pack.get((norm_id, rarity, normalize_pack_code(pack)))
        if pack_candidates:
            if len(pack_candidates) == 1:
                return pack_candidates[0]
            if_resolved = _resolve_if_pair(pack_candidates, card_num_by_id, variant)
            if if_resolved is not None:
                return if_resolved

    if pack:
        normalized_promo = normalize_waitv_promo_pack(pack)
        if normalized_promo:
            promo_candidates = lookup_by_promo_pack.get((norm_id, rarity, normalized_promo))
            if promo_candidates and len(promo_candidates) == 1:
                return promo_candidates[0]

    if variant:
        candidates_for_variant = pack_candidates if pack_candidates else lookup.get(base_key, [])
        narrowed = [pk for pk in candidates_for_variant if card_num_by_id.get(pk, "").endswith(variant)]
        if len(narrowed) == 1:
            return narrowed[0]

    base_candidates = lookup.get(base_key, [])
    if_resolved = _resolve_if_pair(base_candidates, card_num_by_id, variant)
    if if_resolved is not None:
        return if_resolved
    if rarity == "D":
        foil_resolved = _resolve_foil_pair(pack_candidates if pack_candidates else base_candidates, card_num_by_id)
        if foil_resolved is not None:
            return foil_resolved
    # 候補が2件以上ある場合は1枚に絞り込めない(例: PRカードの絵違いが多数ある等)。
    # 誤った価格を割り当てるより、記録しない方が安全なためスキップする。
    if len(base_candidates) == 1:
        return base_candidates[0]
    return None


def sync_prices(conn=None, delay: float = REQUEST_DELAY_SEC, progress_callback=None) -> dict:
    """わいTVからカード価格を取得し price_history に保存する。

    progress_callback(page, matched_count) が指定されていればページ取得のたびに呼び出す。
    """
    owns_conn = conn is None
    if owns_conn:
        conn = db.get_connection()
        db.init_db(conn)

    lookup_with_pack, lookup_by_promo_pack, lookup, card_num_by_id = build_lookup(conn)
    logger.info("価格取得対象: %d件(card_id x レアリティの組み合わせ)", len(lookup))

    all_prices: dict[int, list[int]] = defaultdict(list)
    unresolved_entries: list[dict] = []
    first_request = True

    try:
        page = 1
        last_page = 1
        while page <= min(last_page, MAX_PAGES):
            if not first_request:
                time.sleep(delay)
            first_request = False

            try:
                html = fetch_page(page)
            except requests.RequestException as exc:
                logger.warning("わいTVの取得に失敗 (page=%d): %s", page, exc)
                break

            if page == 1:
                total = parse_total_count(html)
                last_page = max(1, -(-total // PAGE_SIZE))  # 切り上げ除算

            for model_number, rarity, pack, variant, price in parse_items(html):
                card_pk = resolve_candidate(model_number, rarity, pack, variant, lookup_with_pack, lookup_by_promo_pack, lookup, card_num_by_id)
                if card_pk is None:
                    hint_parts = [f"pack={pack!r}"] if pack else []
                    if variant:
                        hint_parts.append(f"variant={variant}")
                    unresolved_entries.append({
                        "raw_key": model_number, "rarity": rarity, "price": price,
                        "hint": " ".join(hint_parts),
                    })
                    continue
                all_prices[card_pk].append(price)

            if progress_callback:
                progress_callback(page, len(all_prices))

            page += 1

        run_recorded_at = datetime.now(timezone.utc).isoformat()
        for card_pk, prices in all_prices.items():
            count = len(prices)
            min_price = min(prices)
            db.insert_price(conn, card_pk, "わいTV", min_price, recorded_at=run_recorded_at, sample_count=count)

        write_unresolved("わいTV", unresolved_entries)

        summary = {
            "target": len(lookup),
            "matched": len(all_prices),
        }
        logger.info("完了: %d件のカードの価格を取得(わいTV)", summary["matched"])
        return summary
    finally:
        if owns_conn:
            conn.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")

    def _print_progress(page, matched_count):
        logger.info("ページ%d取得完了 (累計マッチ %d件)", page, matched_count)

    sync_prices(progress_callback=_print_progress)
