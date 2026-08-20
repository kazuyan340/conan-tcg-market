"""メルカード秋葉原(名探偵コナンTCG専門通販)から価格を取得し price_history に保存するモジュール。

メルカードはカードラボ・竜のしっぽと同じ系列のECカートシステムを使っており、
HTML構造(`li.list_item_cell`, `.goods_name`, `.price .figure`)もほぼ同一。

ただし商品名には駿河屋・竜のしっぽのような「カード番号」がそのまま入っておらず、
名前+レアリティ+色+内部ID+収録パックが並ぶ形式になっている
(例: "萩原千速【SRCP】《黄》［1011]【CT-P09】")。この「内部ID」はDBの`card_id`列
(レアリティ違いをまとめる業務キー)と一致する。数字だけのカード(先頭ゼロ落ちした
表記、例: 1011)と、"P001"のような英字始まりのカード(パートナー/PRカード等、
card_idそのままの表記)の両方があるため、両方を吸収できる正規化を行う。
そのため、カード番号ではなく (card_id, rarity) の組み合わせでカードを特定する。

ただし「PR」のように同じcard_idに何十種類ものプロモ違いが存在するレアリティだと、
(card_id, rarity)だけでは1枚に絞り込めないことが珍しくない
(例: 江戸川コナンのPRカードだけでcard_id=P001に15種類ある)。この場合に全候補へ
同じ価格を書き込むと、無関係な高額商品の値段が別カードに紐付く事故になる
(実際に「探偵マスターズ2026」の未開封パック598,000円が江戸川コナンPR007の
相場として誤登録された)。曖昧な場合は以下の優先順位で絞り込みを試みる。

1. 収録パック表記(例: "【CT-P09】"、構築済みデッキなら"【CTD-01】") - 江戸川コナンの
   「D」レアリティがCT-D01とCT-D08の2つの構築済みデッキに再録されている、といった
   ケースを区別できる。ただしPRカードにはそもそも収録パック表記が付かない。
2. カード名の後ろに付く注釈(例: "江戸川コナン(探偵マスターズ2026)")と、DBの`pack`列
   (例: "PRカード(セブン‐イレブンキャンペーン)")の文字列に重なりがあるかどうか。
   注釈が無い商品や、同じイベント内に複数種類のPRカードがある場合(探偵マスターズ等)
   は依然として絞り込めない。
3. SECレアリティは同じcard_id+rarityで2種類の実物カード(card_num末尾がSec1/Sec2)が
   存在するが、内部ID欄の表記が「SEC版Pxxx」(無印, レンガ版=Sec1)か「書き下ろし
   サイン入りSEC版Pxxx」(サイン入り版=Sec2)かで判別できる(トレカバースで判明した
   レンガ=Sec1/サイン入り=Sec2の対応と同じ)。曖昧な候補をこれで絞り込む。
4. それでも複数候補が残る場合は、誤った値段を出すより記録しない方が安全なため諦める。

対象カテゴリは「パートナー」「キャラ」「イベント」「事件」の4つ(単品カードのみ。
「サプライ・未開封」「セット販売」「デッキ販売」は除外)。

メルカードのrobots.txtには一般クローラー向けのCrawl-delay指定が無いが、
他サイトと同様に安全側でリクエスト間隔30秒を採用する。
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

BASE_URL = "https://www.mercardconan.jp/product-list"
# カテゴリ番号: 1=パートナー, 2=キャラ, 3=イベント, 4=事件 (5=サプライ, 6=セット販売, 7=デッキ販売は除外)
CATEGORY_IDS = ["1", "2", "3", "4"]
PAGE_SIZE = 120

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

REQUEST_TIMEOUT = 15
REQUEST_DELAY_SEC = 30
MAX_PAGES_PER_CATEGORY = 60

# 名前部分の末尾、レアリティ・色・内部ID・収録パックを取り出す(半角[]/全角[]の
# どちらもあり得る)。収録パック表記(末尾の【...】)はPRカード等には無いため任意。
# 内部IDの中に「SEC版」等の接頭辞が付くケース(例: [SEC版P079])もあるため、
# 一旦カッコの中身を丸ごと拾ってから、末尾の英数字部分だけをIDとして取り出す。
NAME_PATTERN = re.compile(
    r"【([^】]+)】《[^》]+》[\[【［]([^\]］]+)[\]］](?:【([^】]+)】)?\s*$"
)
ID_TAIL_PATTERN = re.compile(r"[A-Za-z0-9]+$")
ALNUM_ONLY_PATTERN = re.compile(r"[^A-Za-z0-9]+")
# カード名の後ろに付く注釈(例: "(探偵マスターズ2026)")を拾う。
ANNOTATION_PATTERN = re.compile(r"[（(]([^）)]+)[）)]")
# 収録パック表記は通常、内部ID直後の末尾【...】に付くが、"工藤新一［CTP04]【C】《青》
# ［P007]"のように、カード名の直後・【レアリティ】より前に付く商品もある。
# NAME_PATTERNの末尾パック表記(group3)が無い場合、この直前位置も探す。
# ただし"江戸川コナン［P001]【C】《青》［P001]"のように、内部IDをそのまま同じ
# 角カッコ書式で重複表記しているだけの商品もあるため、実在のパックコードが必ず
# "CT"で始まる(CT-P01/CT-D08等)ことを利用し、それ以外(内部IDの重複)を除外する。
LEADING_PACK_PATTERN = re.compile(r"[\[［](CT[A-Za-z0-9\-]*)[\]／]\s*$", re.IGNORECASE)
# 注釈とDBのpack列を突き合わせるときに無視する記号類(空白・カッコ・各種ハイフン)。
# 長音記号「ー」は正式な文字として使われるカードもあるため対象に含めない。
DECORATION_PATTERN = re.compile(r"[\s()（）\-‐‑‒–—−]+")

logger = logging.getLogger(__name__)


def detect_variant_suffix(raw_id_text: str) -> str | None:
    """内部ID欄の生テキスト(例: "書き下ろしサイン入りSEC版P079", "SEC版P079", "P001")から、
    SECの2種類(Sec1=レンガ/無印, Sec2=サイン入り)を判別する。どちらでもなければNone。
    """
    if "サイン" in raw_id_text:
        return "Sec2"
    if "SEC版" in raw_id_text:
        return "Sec1"
    return None


def normalize_id(value: str) -> str:
    """card_idと内部IDの表記ゆれ(先頭ゼロの有無・余分な接頭辞)を吸収して比較できる形にする。"""
    value = value.strip()
    m = ID_TAIL_PATTERN.search(value)
    if m:
        value = m.group(0)
    return str(int(value)) if value.isdigit() else value.upper()


def extract_pack_tag(raw_id_text: str) -> str:
    """内部ID欄の生テキストから、末尾のID部分より前に付く収録パック名の注記を取り出す
    (例: "キラバージョン0094"->"キラバージョン"、
    "プロモーションパック vol.13キラバージョン431"->"プロモーションパック vol.13キラバージョン"、
    "P001"->"")。PRカードで(card_id, rarity)だけでは1枚に絞り込めない場合に、
    これをcards.packと突き合わせて絞り込む。
    """
    m = ID_TAIL_PATTERN.search(raw_id_text)
    if not m:
        return ""
    return raw_id_text[:m.start()].strip()


def normalize_pack_code(value: str) -> str:
    """収録パック表記の表記ゆれ(ハイフンの有無・位置)を吸収する。

    例: メルカードの「CTD-01」「CT-P09」と、DBの`pack`列の先頭トークン
    「CT-D01」「CT-P09」は、記号を除去すればどちらも一致する形になる
    (「CTD01」「CTP09」)。
    """
    return ALNUM_ONLY_PATTERN.sub("", value).upper()


def normalize_annotation_text(value: str) -> str:
    """カード名の注釈・内部ID欄のパック名注記とDBのpack列を比較するため、空白・カッコ・
    ハイフン類を除去し、DBだけに付く「PRカード」という外側の接頭辞、および
    "vol."/"Vol."のような大文字小文字の表記ゆれを吸収する。
    """
    value = DECORATION_PATTERN.sub("", value)
    if value.startswith("PRカード"):
        value = value[len("PRカード"):]
    return value.lower()


def fetch_page(category: str, page: int) -> str:
    params = {"num": PAGE_SIZE, "page": page}
    resp = requests.get(f"{BASE_URL}/{category}", params=params, headers=HEADERS, timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    return resp.text


def parse_items(html: str) -> list[tuple[str, str, str | None, str | None, str | None, str | None, int | None]]:
    """(内部ID, レアリティ, 収録パック表記, 名前の注釈, SEC判別用の注記, 内部ID欄のパック名注記,
    価格) のリストを返す。

    収録パック表記・注釈・SEC判別用の注記・パック名注記は無ければNone。在庫切れの場合は
    価格がNoneになる(呼び出し側で「今回は在庫切れと確認できた」の判定に使う)。
    未開封の非単品商品(プロモパック丸ごとの出品等)は除外する。
    """
    soup = BeautifulSoup(html, "html.parser")
    results = []
    for li in soup.select("li.list_item_cell"):
        name_el = li.select_one(".goods_name")
        if not name_el:
            continue

        name_text = name_el.get_text()
        # 「未開封」はプロモパック/イベント参加賞のパッケージ丸ごとの出品で、
        # 中身の1枚だけの単品カードとは全く別物の値段になる(数十万円クラスのことも
        # ある)。同じ【レアリティ】《色》［ID]の書式を使いまわしているせいで単品と
        # 誤マッチしてしまうため、ここで除外する(実際に江戸川コナンPR007が
        # 「探偵マスターズ2026」未開封パックの598,000円と誤って紐付いた事例あり)。
        if "未開封" in name_text:
            continue

        m = NAME_PATTERN.search(name_text)
        if not m:
            continue
        rarity, model_number, pack = m.group(1), m.group(2), m.group(3)
        variant = detect_variant_suffix(model_number)
        pack_tag = extract_pack_tag(model_number)

        prefix_text = name_text[:m.start()]
        if not pack:
            leading_pack = LEADING_PACK_PATTERN.search(prefix_text)
            if leading_pack:
                pack = leading_pack.group(1)

        annotation_matches = ANNOTATION_PATTERN.findall(prefix_text)
        annotation = annotation_matches[-1] if annotation_matches else None

        if "list_item_soldout" in (li.get("class") or []):
            results.append((model_number, rarity, pack, annotation, variant, pack_tag, None))
            continue

        price_el = li.select_one(".price .figure")
        if not price_el:
            continue

        price_text = price_el.get_text().split("円")[0].replace(",", "").strip()
        try:
            price = int(price_text)
        except ValueError:
            continue

        results.append((model_number, rarity, pack, annotation, variant, pack_tag, price))
    return results


def parse_total_count(html: str) -> int:
    soup = BeautifulSoup(html, "html.parser")
    el = soup.select_one(".count_number .number")
    if not el:
        return 0
    return int(el.get_text().replace(",", ""))


def build_lookup(conn):
    """カード特定用の対応表を4種類作る。

    - (正規化card_id, レアリティ, 正規化パックコード) -> cards.idのリスト(先頭パックのみ)
    - (正規化card_id, レアリティ) -> cards.idのリスト
    - cards.id -> 正規化したpack列全文(注釈との突き合わせ用)
    - cards.id -> card_num(SECのSec1/Sec2判別用)
    """
    lookup_with_pack: dict[tuple[str, str, str], list[int]] = defaultdict(list)
    lookup: dict[tuple[str, str], list[int]] = defaultdict(list)
    pack_text_by_id: dict[int, str] = {}
    card_num_by_id: dict[int, str] = {}
    for row in db.search_cards(conn):
        base_key = (normalize_id(row["card_id"]), row["rarity"])
        lookup[base_key].append(row["id"])
        pack = row["pack"] or ""
        pack_text_by_id[row["id"]] = normalize_annotation_text(pack)
        card_num_by_id[row["id"]] = row["card_num"]
        pack_code = pack.split()[0] if pack.split() else ""
        if pack_code:
            lookup_with_pack[(base_key[0], base_key[1], normalize_pack_code(pack_code))].append(row["id"])
    return lookup_with_pack, lookup, pack_text_by_id, card_num_by_id


def _match_by_pack_tag(candidates: list[int], norm_tag: str, pack_text_by_id: dict[int, str]) -> int | None:
    """内部ID欄のパック名注記(正規化済み)から候補を絞り込む。
    完全一致が1件ならそれを、無ければ「注記がcards.packの部分文字列になっている」候補が
    1件だけならそれを返す(注記が「キラバージョン」のようにVol.番号を欠く省略形の
    ことがあるため)。どちらも1件に絞れなければNoneを返す。
    """
    if not norm_tag:
        return None
    exact = [pk for pk in candidates if pack_text_by_id.get(pk, "") == norm_tag]
    if len(exact) == 1:
        return exact[0]
    contains = [pk for pk in candidates if norm_tag in pack_text_by_id.get(pk, "")]
    if len(contains) == 1:
        return contains[0]
    return None


def _resolve_if_pair_by_annotation(candidates: list[int], card_num_by_id: dict[int, str], annotation: str | None) -> int | None:
    """候補がちょうど2件で、card_numが「無印」「無印+"2"」(IFパラレル)の組になっている
    場合に限り、名前の注記から絞り込む。CT-P10のIFパラレルは無印側が「夕方」の
    野球シーンで統一されており、IFパラレル側は「幼少期」「カフェ」等カードごとに
    異なるシーンになっている(ユーザーに画像で確認済み)。そのため「夕方」なら無印、
    それ以外の注記(空でなければ)ならIFパラレルとみなす。注記自体が無い場合は、
    出品名だけでは判別できないため無印側とみなす(1121/1122のように無印側しか
    出品されていないケースを含め、注記なしのIFパラレル側の誤登録より無印側への
    集約を優先する方針であることをユーザーに確認済み)。IFパラレルの組でなければ
    Noneを返す。
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
    if not annotation:
        return base_pk
    return base_pk if annotation == "夕方" else if_pk


_TRAILING_NUM = re.compile(r"(\d+)$")


def _consecutive_card_nums(num_a: str, num_b: str) -> bool:
    """card_numの接頭辞(英字部分)が一致し、末尾の数字部分がちょうど1違いの連番かどうか。
    例: D08019/D08020 -> True。D01002/D08022のように接頭辞のパック部分ごと違う
    (同キャラの別デッキへの再録)場合や、末尾がP/Sec1のように数字で終わらない
    場合はFalseになる。
    """
    m_a, m_b = _TRAILING_NUM.search(num_a), _TRAILING_NUM.search(num_b)
    if not m_a or not m_b:
        return False
    if num_a[: m_a.start()] != num_b[: m_b.start()]:
        return False
    return abs(int(m_a.group(1)) - int(m_b.group(1))) == 1


def _resolve_foil_pair(candidates: list[int], card_num_by_id: dict[int, str], is_foil: bool) -> int | None:
    """テーマデッキのDレアリティは、通常版とホイル版が連番のcard_num(例: D08019/D08020)
    で別カードとして登録されている。候補がちょうど2件かつ、そのcard_numが実際に
    連番の場合に限り(単に2件たまたま揃っただけの無関係な組み合わせを誤って
    ペア扱いしないため)、card_numの昇順で小さい方をホイル版、大きい方を通常版と
    みなし(ユーザーに確認済み。ただし現時点の暫定情報)、商品名の「ホイル版」と
    いう注記の有無に応じてどちらか1件のcards.idを返す。それ以外はNoneを返す。
    """
    if len(candidates) != 2:
        return None
    ordered = sorted(candidates, key=lambda pk: card_num_by_id.get(pk, ""))
    if not _consecutive_card_nums(card_num_by_id.get(ordered[0], ""), card_num_by_id.get(ordered[1], "")):
        return None
    return ordered[0] if is_foil else ordered[1]


def resolve_candidate(model_number, rarity, pack, annotation, variant, pack_tag, lookup_with_pack, lookup, pack_text_by_id, card_num_by_id):
    """(内部ID, レアリティ, 収録パック表記, 注釈, SEC判別用の注記, 内部ID欄のパック名注記) から、
    1枚に絞り込めればそのcards.idを、絞り込めなければNoneを返す。
    優先順位はparse_items/モジュールdocstring参照。
    """
    norm_id = normalize_id(model_number)
    base_key = (norm_id, rarity)

    pack_candidates = None
    if pack:
        pack_candidates = lookup_with_pack.get((norm_id, rarity, normalize_pack_code(pack)))
        if pack_candidates and len(pack_candidates) == 1:
            return pack_candidates[0]

    if annotation:
        norm_annotation = normalize_annotation_text(annotation)
        if norm_annotation:
            matches = [
                pk for pk in lookup.get(base_key, [])
                if norm_annotation in pack_text_by_id.get(pk, "")
            ]
            if len(matches) == 1:
                return matches[0]

    candidates_for_if_pair = pack_candidates if pack_candidates else lookup.get(base_key, [])
    if_resolved = _resolve_if_pair_by_annotation(candidates_for_if_pair, card_num_by_id, annotation)
    if if_resolved is not None:
        return if_resolved

    if pack_tag:
        resolved = _match_by_pack_tag(lookup.get(base_key, []), normalize_annotation_text(pack_tag), pack_text_by_id)
        if resolved is not None:
            return resolved

    if rarity == "D":
        foil_resolved = _resolve_foil_pair(candidates_for_if_pair, card_num_by_id, "ホイル版" in model_number)
        if foil_resolved is not None:
            return foil_resolved

    if variant:
        candidates_for_variant = pack_candidates if pack_candidates else lookup.get(base_key, [])
        narrowed = [pk for pk in candidates_for_variant if card_num_by_id.get(pk, "").endswith(variant)]
        if len(narrowed) == 1:
            return narrowed[0]

    base_candidates = lookup.get(base_key, [])
    # 候補が2件以上ある場合は1枚に絞り込めない(例: PRカードの絵違いが多数ある等)。
    # 誤った値段/在庫状況を割り当てるより、記録しない方が安全なためスキップする。
    if len(base_candidates) == 1:
        return base_candidates[0]
    return None


def sync_prices(conn=None, delay: float = REQUEST_DELAY_SEC, progress_callback=None) -> dict:
    """メルカードからカード価格を取得し price_history に保存する。

    progress_callback(category, page, matched_count) が指定されていれば
    ページ取得のたびに呼び出す。
    """
    owns_conn = conn is None
    if owns_conn:
        conn = db.get_connection()
        db.init_db(conn)

    lookup_with_pack, lookup, pack_text_by_id, card_num_by_id = build_lookup(conn)
    logger.info("価格取得対象: %d件(card_id x レアリティの組み合わせ)", len(lookup))

    all_prices: dict[int, list[int]] = defaultdict(list)
    unresolved_entries: list[dict] = []
    first_request = True

    try:
        for category in CATEGORY_IDS:
            page = 1
            last_page = 1
            while page <= min(last_page, MAX_PAGES_PER_CATEGORY):
                if not first_request:
                    time.sleep(delay)
                first_request = False

                try:
                    html = fetch_page(category, page)
                except requests.RequestException as exc:
                    logger.warning("メルカードの取得に失敗 (category=%s page=%d): %s", category, page, exc)
                    break

                if page == 1:
                    total = parse_total_count(html)
                    last_page = max(1, -(-total // PAGE_SIZE))  # 切り上げ除算

                for model_number, rarity, pack, annotation, variant, pack_tag, price in parse_items(html):
                    card_pk = resolve_candidate(
                        model_number, rarity, pack, annotation, variant, pack_tag,
                        lookup_with_pack, lookup, pack_text_by_id, card_num_by_id,
                    )
                    if card_pk is None or price is None:
                        if card_pk is None and price is not None:
                            hint_parts = []
                            if pack:
                                hint_parts.append(f"pack={pack!r}")
                            if annotation:
                                hint_parts.append(f"annotation={annotation!r}")
                            if pack_tag:
                                hint_parts.append(f"pack_tag={pack_tag!r}")
                            unresolved_entries.append({
                                "raw_key": model_number, "rarity": rarity, "price": price,
                                "hint": " ".join(hint_parts),
                            })
                        continue
                    all_prices[card_pk].append(price)

                if progress_callback:
                    progress_callback(category, page, len(all_prices))

                page += 1

        run_recorded_at = datetime.now(timezone.utc).isoformat()
        for card_pk, prices in all_prices.items():
            count = len(prices)
            min_price = min(prices)
            db.insert_price(conn, card_pk, "メルカード", min_price, recorded_at=run_recorded_at, sample_count=count)

        write_unresolved("メルカード", unresolved_entries)

        summary = {
            "target": len(lookup),
            "matched": len(all_prices),
        }
        logger.info("完了: %d件のカードの価格を取得(メルカード)", summary["matched"])
        return summary
    finally:
        if owns_conn:
            conn.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")

    def _print_progress(category, page, matched_count):
        logger.info("カテゴリ%s ページ%d取得完了 (累計マッチ %d件)", category, page, matched_count)

    sync_prices(progress_callback=_print_progress)
