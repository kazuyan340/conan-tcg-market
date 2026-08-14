"""秋葉原のカードショップ「トレカバース」(torecabirth.jp)から名探偵コナンTCGの
価格を取得し price_history に保存するモジュール。

わいTVと同じOcnk系ECカートで、HTML構造(`li.list_item_cell`, `.goods_name`,
`.price .figure`)も共通。ただし単品カードは「コナンカード:ブースターパック」
配下の弾ごとのカテゴリ10個と、「コナンカード:プロモカード」配下のカテゴリ2個
(計12カテゴリ)に分かれており(スターターデッキ/テーマデッキ/エグゼクティブ
コレクションのカテゴリは未開封の箱・デッキ製品でありグッズ扱いのため対象外)、
1カテゴリに全件まとまっているわいTVと違い複数カテゴリを回る必要がある。

商品名には「服部平蔵＆遠山銀司郎【MR】《緑》[型番1082]」のように【】内の
レアリティと、[型番xxxx]としてDBの`card_id`列(レアリティ違いをまとめる
業務キー)がそのまま入っている。そのため(card_id, rarity)の組み合わせで
カードを特定する。

ブースターパックのカテゴリはそれぞれ弾(=収録パック)が確定しているため、
そのカテゴリに対応する収録パックのカードだけに絞り込んでから(card_id, rarity)
で照合することで、わいTVでは絞り込めなかったパック内の重複(例: 同じ
card_id+rarityでもパックが違う)を回避できる。ただしプロモカテゴリ2つは
複数パックの商品が混在しており、かつSECレアリティ等は同じcard_id+rarityで
「レンガ版」「サイン入り版」のように商品名からは区別できない別カード
(card_num違い)が存在することがあるため、(card_id, rarity[, pack])で1枚に
絞り込めない場合は記録しない(誤った価格を書き込むより記録しない方が安全、
というわいTVでの方針を踏襲)。

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

# 商品名の中の「【レアリティ】」「[型番xxxx]」を取り出す。
NAME_PATTERN = re.compile(r"【([A-Za-z0-9]+)】.*?\[型番\s*([A-Za-z0-9]+)\]")

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


def parse_items(html: str) -> list[tuple[str, str, int]]:
    """(card_id, レアリティ, 価格) のリストを返す。品切れ商品は除外する。"""
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
        rarity, model_number = m.group(1), m.group(2)

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

        results.append((model_number, rarity, price))
    return results


def parse_total_count(html: str) -> int:
    soup = BeautifulSoup(html, "html.parser")
    el = soup.select_one(".count_number .number")
    if not el:
        return 0
    return int(el.get_text().replace(",", ""))


def build_lookup(conn):
    """カード特定用の対応表を2種類作る。

    - (card_id, レアリティ, パックコード) -> cards.idのリスト (ブースターカテゴリ用)
    - (card_id, レアリティ) -> cards.idのリスト (プロモカテゴリ用)
    """
    lookup_with_pack: dict[tuple[str, str, str], list[int]] = defaultdict(list)
    lookup: dict[tuple[str, str], list[int]] = defaultdict(list)
    for row in db.search_cards(conn):
        base_key = (row["card_id"], row["rarity"])
        lookup[base_key].append(row["id"])
        pack = row["pack"] or ""
        pack_code = pack.split()[0] if pack.split() else ""
        if pack_code:
            lookup_with_pack[(base_key[0], base_key[1], pack_code)].append(row["id"])
    return lookup_with_pack, lookup


def resolve_candidate(model_number, rarity, pack_code, lookup_with_pack, lookup):
    """(card_id, レアリティ, パックコード) から、1枚に絞り込めればそのcards.idを、
    絞り込めなければNoneを返す。
    """
    if pack_code:
        pack_candidates = lookup_with_pack.get((model_number, rarity, pack_code))
        if pack_candidates and len(pack_candidates) == 1:
            return pack_candidates[0]
        if pack_candidates:
            return None

    base_candidates = lookup.get((model_number, rarity), [])
    # 候補が2件以上ある場合は1枚に絞り込めない(例: SECの「レンガ版」「サイン入り版」等)。
    # 誤った価格を割り当てるより、記録しない方が安全なためスキップする。
    if len(base_candidates) == 1:
        return base_candidates[0]
    return None


def sync_prices(conn=None, delay: float = REQUEST_DELAY_SEC, progress_callback=None) -> dict:
    """トレカバースからカード価格を取得し price_history に保存する。

    progress_callback(category, page, last_page, matched_count) が指定されていれば
    ページ取得のたびに呼び出す。
    """
    owns_conn = conn is None
    if owns_conn:
        conn = db.get_connection()
        db.init_db(conn)

    lookup_with_pack, lookup = build_lookup(conn)
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

                for model_number, rarity, price in parse_items(html):
                    card_pk = resolve_candidate(model_number, rarity, pack_code, lookup_with_pack, lookup)
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
