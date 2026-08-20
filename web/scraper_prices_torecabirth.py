"""秋葉原のカードショップ「トレカバース」(torecabirth.jp)から名探偵コナンTCGの
価格を取得し price_history に保存するモジュール。

わいTVと同じOcnk系ECカートで、HTML構造(`li.list_item_cell`, `.goods_name`,
`.price .figure`)も共通。単品カードは「コナンカード:ブースターパック」配下の
弾ごとのカテゴリ10個、「コナンカード:プロモカード」配下のカテゴリ2個、
エグゼクティブコレクション2個、スターターデッキ/テーマデッキ11個(計25カテゴリ)
に分かれており、1カテゴリに全件まとまっているわいTVと違い複数カテゴリを回る
必要がある。
(2026-08-20追記: 以前はスターターデッキ/テーマデッキを「未開封の箱・デッキ製品
でグッズ扱い」として対象外にしていたが誤りで、実際にはブースター同様に単品バラ
売りの専用カテゴリが存在していた。)

商品名には「服部平蔵＆遠山銀司郎【MR】《緑》[型番1082]」のように【】内の
レアリティと、[型番xxxx]としてDBの`card_id`列(レアリティ違いをまとめる
業務キー)がそのまま入っている。そのため(card_id, rarity)の組み合わせで
カードを特定する。

ブースターパックのカテゴリはそれぞれ弾(=収録パック)が確定しているため、
そのカテゴリに対応する収録パックのカードだけに絞り込んでから(card_id, rarity)
で照合することで、わいTVでは絞り込めなかったパック内の重複(例: 同じ
card_id+rarityでもパックが違う)を回避できる。

プロモカード(カテゴリ48, 49)は上記のカテゴリ単位の絞り込みが効かない一方、
商品名自体に「[型番 0198][プロモーションパックVol.8キラバージョン]」のように
収録パック名の注記が付いている。同じcard_id+rarityのPRカードが複数の配布回に
またがって存在するケース(例: 大岡紅葉の型番0198はチャレンジ戦配布/Vol.8通常/
Vol.8キラの3枚)が多いため、この注記をcards.packと突き合わせて絞り込む
(表記揺れは_normalize_pack_textで吸収する)。

SECレアリティは同じcard_id+rarityで2種類の実物カード(card_num末尾がSec1/Sec2)
が存在するが、商品名の注記が「レンガ」ならSec1、「サイン入り」(青山剛昌先生
サイン入り)ならSec2と判別できることが分かっているため、detect_variant_suffix()
でこれを読み取って絞り込みに使う。それでも(card_id, rarity[, pack, 注記])で
1枚に絞り込めない場合は記録しない(誤った価格を書き込むより記録しない方が
安全、というわいTVでの方針を踏襲)。

スターターデッキ/テーマデッキのDレアリティは、通常版とホイル(キラ)加工版が
連番のcard_num(例: D08003/D08004)で別カードとして登録されており、商品名の
「キラ加工」という注記の有無でしか区別できない。メルカードでの調査で「card_num
が小さい方がホイル版」という対応が分かっている(暫定情報)ため、同じ規則を
_resolve_foil_pair()で適用する。

トレカバースのrobots.txtはAI学習ボット(GPTBot等)のみDisallowで一般クローラー
への制限が無いが、他サイトと同様に安全側でリクエスト間隔30秒を採用する。
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

BASE_URL = "https://www.torecabirth.jp/product-list/{category}"
PAGE_SIZE = 100

# カテゴリID -> 対応する収録パックの先頭コード(cards.packは
# "CT-P10 Case-Booster 10 追憶の盟友"のように先頭にコードが来るため前方一致で絞る)。
# プロモカテゴリ(48, 49)は複数パックの商品が混在するためパック指定なし(None)。
BOOSTER_CATEGORY_PACKS = {
    2: "CT-P01",
    7: "CT-P02",
    25: "CT-P03",
    68: "CT-P04",
    75: "CT-P05",
    83: "CT-P06",
    84: "CT-P07",
    111: "CT-P08",
    122: "CT-P09",
    134: "CT-P10",
    # エグゼクティブコレクション(公式サイトのカード一覧には無く、scraper_executive_
    # collection.pyでトレカバースの商品一覧から逆輸入したカード。pack列の先頭コードは
    # そちらと合わせてEXC01/EXC02にしてある)。
    141: "EXC01",
    142: "EXC02",
    # スターターデッキ/テーマデッキも(未開封の箱ではなく)単品バラ売りのカテゴリが
    # 別に存在することが判明したため追加(2026-08-20)。旧ドキュメント(モジュール
    # docstring)では「デッキ製品でグッズ扱いのため対象外」としていたが誤りだった。
    9: "CT-D01",
    10: "CT-D02",
    11: "CT-D03",
    12: "CT-D04",
    13: "CT-D05",
    26: "CT-D06",
    42: "CT-D07",
    73: "CT-D08",
    74: "CT-D09",
    103: "CT-D10",
    123: "CT-D11",
}
PROMO_CATEGORIES = [48, 49]
ALL_CATEGORIES = list(BOOSTER_CATEGORY_PACKS) + PROMO_CATEGORIES

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

REQUEST_TIMEOUT = 15
REQUEST_DELAY_SEC = 30
MAX_PAGES_PER_CATEGORY = 20

# 商品名の中の「【レアリティ】」「[型番xxxx]」、続けてあれば「[プロモパック名]」を取り出す。
# 例: "大岡紅葉【PR】《緑》[型番 0198][プロモーションパックVol.8キラバージョン]"
#     "萩原千速 【PR】《黄》[型番 0940] [チャレンジ戦 他] 未開封"
NAME_PATTERN = re.compile(r"【([A-Za-z0-9]+)】.*?\[型番\s*([A-Za-z0-9]+)\]\s*(?:\[\s*([^\]]*?)\s*\])?")

# SECレアリティは同じcard_id+レアリティで2種類の実物カード(card_num末尾がSec1/Sec2)が
# 存在し、商品名の「レンガ」「サイン入り」という注記でどちらか判別できる
# (レンガ=Sec1、青山剛昌先生サイン入り=Sec2であることをユーザーに確認済み)。
#
# 同様に一部のパック(CT-P10等)には通常版と絵違いの「IFパラレル」が同じcard_id+
# レアリティで存在し、card_num末尾に"2"が付くだけの別カードとして登録されている
# (例: 通常版B10065P、IFパラレルB10065P2。P2=IFパラレルであることをユーザーに
# 確認済み)。商品名の「IFパラレル」という注記で判別する。
def detect_variant_suffix(name_text: str) -> str | None:
    if "サイン" in name_text:
        return "Sec2"
    if "レンガ" in name_text:
        return "Sec1"
    if "IFパラレル" in name_text:
        return "IF"
    if "キラ加工" in name_text:
        return "FOIL"
    return None


# cards.packの表記("PRカード（プロモーションパックVol.8（キラバージョン）」等)と
# 商品名の注記("プロモーションパックVol.8キラバージョン")は外側の「PRカード（）」の
# 有無・括弧の全角半角・空白の有無で揺れるため、両方に適用して比較可能な形に揃える。
def _normalize_pack_text(text: str | None) -> str:
    if not text:
        return ""
    text = text.strip()
    if text.startswith("PRカード"):
        text = text[len("PRカード"):]
    for ch in "（）() 　":
        text = text.replace(ch, "")
    return text

logger = logging.getLogger(__name__)


def fetch_page(category: int, page: int) -> str:
    resp = requests.get(
        BASE_URL.format(category=category),
        params={"num": PAGE_SIZE, "page": page},
        headers=HEADERS,
        timeout=REQUEST_TIMEOUT,
    )
    resp.raise_for_status()
    return resp.text


def parse_items(html: str) -> list[tuple[str, str, int, str | None, str | None]]:
    """(card_id, レアリティ, 価格, 判別用の注記(Sec1/Sec2/None), プロモパック名の注記(あれば))
    のリストを返す。品切れ商品は除外する。
    """
    soup = BeautifulSoup(html, "html.parser")
    results = []
    for li in soup.select("li.list_item_cell"):
        name_el = li.select_one(".goods_name")
        if not name_el:
            continue

        name_text = name_el.get_text()
        m = NAME_PATTERN.search(name_text)
        if not m:
            continue
        rarity, model_number, pack_tag = m.group(1), m.group(2), m.group(3)
        variant = detect_variant_suffix(name_text)

        stock_el = li.select_one(".stock")
        if stock_el and "在庫なし" in stock_el.get_text():
            continue

        price_el = li.select_one(".price .figure")
        if not price_el:
            continue
        price_text = price_el.get_text().replace("円", "").replace(",", "").strip()
        try:
            price = int(price_text)
        except ValueError:
            continue

        results.append((model_number, rarity, price, variant, pack_tag))
    return results


def parse_total_count(html: str) -> int:
    soup = BeautifulSoup(html, "html.parser")
    el = soup.select_one(".count_number .number")
    if not el:
        return 0
    return int(el.get_text().replace(",", ""))


def build_lookup(conn):
    """カード特定用の対応表を3種類作る。値は(cards.id, card_num)のリスト。

    - (card_id, レアリティ, パックコード) -> [(cards.id, card_num), ...] (ブースターカテゴリ用)
    - (card_id, レアリティ, 正規化したパック名) -> [(cards.id, card_num), ...] (プロモカテゴリ用。
      商品名の「[プロモーションパックVol.8キラバージョン]」等をcards.packと突き合わせる)
    - (card_id, レアリティ) -> [(cards.id, card_num), ...] (どちらでも絞り込めない場合の最終フォールバック)
    """
    lookup_with_pack: dict[tuple[str, str, str], list[tuple[int, str]]] = defaultdict(list)
    lookup_by_promo_pack: dict[tuple[str, str, str], list[tuple[int, str]]] = defaultdict(list)
    lookup: dict[tuple[str, str], list[tuple[int, str]]] = defaultdict(list)
    for row in db.search_cards(conn):
        base_key = (row["card_id"], row["rarity"])
        entry = (row["id"], row["card_num"])
        lookup[base_key].append(entry)
        pack = row["pack"] or ""
        pack_code = pack.split()[0] if pack.split() else ""
        if pack_code:
            lookup_with_pack[(base_key[0], base_key[1], pack_code)].append(entry)
        normalized_pack = _normalize_pack_text(pack)
        if normalized_pack:
            lookup_by_promo_pack[(base_key[0], base_key[1], normalized_pack)].append(entry)
    return lookup_with_pack, lookup_by_promo_pack, lookup


def _narrow_by_variant(candidates: list[tuple[int, str]], variant: str | None) -> int | None:
    """候補が2件以上ある場合、商品名の注記(Sec1/Sec2/IF)で1件に絞り込めればそのcards.idを、
    絞り込めなければNoneを返す(誤った価格を割り当てるより記録しない方が安全なため)。
    """
    if len(candidates) == 1:
        return candidates[0][0]

    # IFパラレルはcard_num末尾に"2"が付くだけの別カードなので(Sec1/Sec2のような
    # 固有の接尾辞ではなく)、候補2件が「無印」「無印+"2"」の組になっているかを
    # 直接突き合わせて判別する。この組が見つかった場合、商品名に「IFパラレル」の
    # 注記があればIF側を、無ければ(=無印の商品名なら)無印側を選べる。
    if len(candidates) == 2:
        (pk_a, num_a), (pk_b, num_b) = candidates
        if num_a + "2" == num_b:
            if_pk, base_pk = pk_b, pk_a
        elif num_b + "2" == num_a:
            if_pk, base_pk = pk_a, pk_b
        else:
            if_pk = base_pk = None
        if if_pk is not None:
            return if_pk if variant == "IF" else base_pk

    if variant:
        narrowed = [pk for pk, card_num in candidates if card_num.endswith(variant)]
        if len(narrowed) == 1:
            return narrowed[0]
    return None


_TRAILING_NUM = re.compile(r"(\d+)$")


def _consecutive_card_nums(num_a: str, num_b: str) -> bool:
    """card_numの接頭辞(英字部分)が一致し、末尾の数字部分がちょうど1違いの連番かどうか。
    例: D08003/D08004 -> True。同じcard_idが別デッキに再録されているケース
    (例: D01002/D08022)や、末尾が数字で終わらないcard_numはFalseになる。
    """
    m_a, m_b = _TRAILING_NUM.search(num_a), _TRAILING_NUM.search(num_b)
    if not m_a or not m_b:
        return False
    if num_a[: m_a.start()] != num_b[: m_b.start()]:
        return False
    return abs(int(m_a.group(1)) - int(m_b.group(1))) == 1


def _resolve_foil_pair(candidates: list[tuple[int, str]], is_foil: bool) -> int | None:
    """テーマデッキのDレアリティは、通常版とホイル(キラ)加工版が別カードとして
    登録されているが、Sec1/Sec2やIFパラレルと違って接尾辞での判別ができない。
    候補がちょうど2件かつ、そのcard_numが実際に連番の場合に限り(単に2件たまたま
    揃っただけの無関係な組み合わせを誤ってペア扱いしないため)、card_numの昇順で
    小さい方をホイル版、大きい方を通常版とみなし(メルカードでの調査でユーザーに
    確認済み。ただし現時点の暫定情報)、商品名の「キラ加工」という注記の有無に
    応じてどちらか1件のcards.idを返す。それ以外はNoneを返す。
    """
    if len(candidates) != 2:
        return None
    ordered = sorted(candidates, key=lambda c: c[1])
    if not _consecutive_card_nums(ordered[0][1], ordered[1][1]):
        return None
    return ordered[0][0] if is_foil else ordered[1][0]


def resolve_candidate(model_number, rarity, pack_code, pack_tag, variant, lookup_with_pack, lookup_by_promo_pack, lookup):
    """(card_id, レアリティ, パックコード, プロモパック名の注記, 判別用の注記) から、
    1枚に絞り込めればそのcards.idを、絞り込めなければNoneを返す。
    """
    if pack_code:
        pack_candidates = lookup_with_pack.get((model_number, rarity, pack_code))
        if pack_candidates:
            narrowed = _narrow_by_variant(pack_candidates, variant)
            if narrowed is None and rarity == "D":
                narrowed = _resolve_foil_pair(pack_candidates, variant == "FOIL")
            return narrowed

    if pack_tag:
        promo_candidates = lookup_by_promo_pack.get((model_number, rarity, _normalize_pack_text(pack_tag)))
        if promo_candidates:
            return _narrow_by_variant(promo_candidates, variant)

    base_candidates = lookup.get((model_number, rarity), [])
    return _narrow_by_variant(base_candidates, variant)


def sync_prices(conn=None, delay: float = REQUEST_DELAY_SEC, progress_callback=None) -> dict:
    """トレカバースからカード価格を取得し price_history に保存する。

    progress_callback(category, page, last_page, matched_count) が指定されていれば
    ページ取得のたびに呼び出す。
    """
    owns_conn = conn is None
    if owns_conn:
        conn = db.get_connection()
        db.init_db(conn)

    lookup_with_pack, lookup_by_promo_pack, lookup = build_lookup(conn)
    logger.info("価格取得対象: %d件(card_id x レアリティの組み合わせ)", len(lookup))

    all_prices: dict[int, list[int]] = defaultdict(list)
    first_request = True

    try:
        for category in ALL_CATEGORIES:
            pack_code = BOOSTER_CATEGORY_PACKS.get(category)
            page = 1
            last_page = 1
            while page <= min(last_page, MAX_PAGES_PER_CATEGORY):
                if not first_request:
                    time.sleep(delay)
                first_request = False

                try:
                    html = fetch_page(category, page)
                except requests.RequestException as exc:
                    logger.warning("トレカバースの取得に失敗 (category=%d, page=%d): %s", category, page, exc)
                    break

                if page == 1:
                    total = parse_total_count(html)
                    last_page = max(1, -(-total // PAGE_SIZE))  # 切り上げ除算

                for model_number, rarity, price, variant, pack_tag in parse_items(html):
                    card_pk = resolve_candidate(
                        model_number, rarity, pack_code, pack_tag, variant,
                        lookup_with_pack, lookup_by_promo_pack, lookup,
                    )
                    if card_pk is None:
                        continue
                    all_prices[card_pk].append(price)

                if progress_callback:
                    progress_callback(category, page, last_page, len(all_prices))

                page += 1

        run_recorded_at = datetime.now(timezone.utc).isoformat()
        for card_pk, prices in all_prices.items():
            count = len(prices)
            min_price = min(prices)
            db.insert_price(conn, card_pk, "トレカバース", min_price, recorded_at=run_recorded_at, sample_count=count)

        summary = {
            "target": len(lookup),
            "matched": len(all_prices),
        }
        logger.info("完了: %d件のカードの価格を取得(トレカバース)", summary["matched"])
        return summary
    finally:
        if owns_conn:
            conn.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")

    def _print_progress(category, page, last_page, matched_count):
        logger.info("カテゴリ%d ページ%d/%d取得完了 (累計マッチ %d件)", category, page, last_page, matched_count)

    sync_prices(progress_callback=_print_progress)
