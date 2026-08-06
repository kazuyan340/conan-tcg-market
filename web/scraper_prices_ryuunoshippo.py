"""トレカショップ竜のしっぽから名探偵コナンTCGカードの価格を取得し price_history に保存するモジュール。

カードラボと同じ系列のECカートシステムを使っており、HTML構造もほぼ同一。
違いはカード番号の表記形式で、竜のしっぽでは
"[{内部ID}]{カード名}({レアリティ})({カード番号})" という形式になっている
(例: "[1082]服部平蔵&遠山銀司郎(MR)(B10021)")。

さらに好都合なことに、`/product-list/429` が最初から「名探偵コナンTCG」専用
カテゴリになっており(2,199件・全19ページ@num=120)、カードラボのように
キーワード検索で絞り込む必要すらない。

竜のしっぽのrobots.txtには一般クローラー向けのCrawl-delay指定が無いが、
駿河屋・カードラボと同様に安全側でリクエスト間隔30秒を採用する。
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

CATEGORY_URL = "https://www.ryuunoshippo.com/product-list/429"
PAGE_SIZE = 120

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

# 名探偵コナンTCG専用カテゴリを丸ごと取得済みなので、C/CP/R/RPを除外しても追加アクセスは
# 減らない(既に取得したデータを捨てているだけだった)。除外なしに変更。
EXCLUDED_RARITIES = []

REQUEST_TIMEOUT = 15
REQUEST_DELAY_SEC = 30
MAX_PAGES = 60  # 安全のための上限(実際の最終ページはparse_total_countから算出)

# 例: "[1082]服部平蔵&遠山銀司郎(MR)(B10021)"
NAME_PATTERN = re.compile(r"\(([^()]+)\)\(([^()]+)\)\s*$")

logger = logging.getLogger(__name__)


def fetch_page(page: int) -> str:
    params = {"num": PAGE_SIZE, "page": page}
    resp = requests.get(CATEGORY_URL, params=params, headers=HEADERS, timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    return resp.text


def parse_items(html: str) -> list[tuple[str, str, int | None]]:
    """(card_num, rarity, price) のリストを返す。在庫切れの場合はpriceがNoneになる
    (呼び出し側で「今回は在庫切れと確認できた」の判定に使う)。
    """
    soup = BeautifulSoup(html, "html.parser")
    results = []
    for li in soup.select("li.list_item_cell"):
        name_el = li.select_one(".goods_name")
        if not name_el:
            continue

        m = NAME_PATTERN.search(name_el.get_text())
        if not m:
            continue
        rarity, card_num = m.group(1), m.group(2)

        if "list_item_soldout" in (li.get("class") or []):
            results.append((card_num, rarity, None))
            continue

        price_el = li.select_one(".price .figure")
        if not price_el:
            continue

        price_text = price_el.get_text().split("円")[0].replace(",", "").strip()
        try:
            price = int(price_text)
        except ValueError:
            continue

        results.append((card_num, rarity, price))
    return results


def parse_total_count(html: str) -> int:
    soup = BeautifulSoup(html, "html.parser")
    el = soup.select_one(".count_number .number")
    if not el:
        return 0
    return int(el.get_text().replace(",", ""))


def sync_prices(conn=None, delay: float = REQUEST_DELAY_SEC, progress_callback=None) -> dict:
    """高レアリティカードの価格を竜のしっぽから取得し price_history に保存する。

    progress_callback(page, last_page, matched_count) が指定されていれば
    ページ取得のたびに呼び出す。
    """
    owns_conn = conn is None
    if owns_conn:
        conn = db.get_connection()
        db.init_db(conn)

    all_rarities = db.get_distinct_values(conn, "rarity")
    target_rarities = [r for r in all_rarities if r not in EXCLUDED_RARITIES]

    target_rows = db.search_cards(conn, rarities=target_rarities)
    target_by_num = {row["card_num"]: row["id"] for row in target_rows}
    logger.info("価格取得対象: %d件 (レアリティ: %s)", len(target_by_num), ", ".join(target_rarities))

    all_prices: dict[str, list[int]] = defaultdict(list)
    soldout_card_nums: set[str] = set()
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
                logger.warning("竜のしっぽの取得に失敗 (page=%d): %s", page, exc)
                break

            if page == 1:
                total = parse_total_count(html)
                last_page = max(1, -(-total // PAGE_SIZE))  # 切り上げ除算

            for card_num, rarity, price in parse_items(html):
                if card_num not in target_by_num:
                    continue
                if price is None:
                    soldout_card_nums.add(card_num)
                else:
                    all_prices[card_num].append(price)

            if progress_callback:
                progress_callback(page, last_page, len(all_prices))

            page += 1

        run_recorded_at = datetime.now(timezone.utc).isoformat()
        for card_num, prices in all_prices.items():
            card_id = target_by_num[card_num]
            count = len(prices)
            min_price = min(prices)
            db.insert_price(conn, card_id, "竜のしっぽ", min_price, recorded_at=run_recorded_at, sample_count=count)

        # 在庫切れと確認できたカードは、次に再入荷して確認できるまで最安値を出せないため、
        # フロント側の「何日か経ったら-にする」猶予を待たずその場で古い記録を消す。
        confirmed_soldout = soldout_card_nums - set(all_prices)
        if confirmed_soldout:
            soldout_ids = [target_by_num[num] for num in confirmed_soldout if num in target_by_num]
            deleted = db.delete_prices(conn, soldout_ids, "竜のしっぽ")
            logger.info("在庫切れ確認: %d件の古い価格記録を削除", deleted)

        unmatched = sorted(set(target_by_num) - set(all_prices))
        summary = {
            "target": len(target_by_num),
            "matched": len(all_prices),
            "unmatched": len(unmatched),
        }
        logger.info(
            "完了: 対象%d件中 %d件の価格を取得 (未取得 %d件)",
            summary["target"], summary["matched"], summary["unmatched"],
        )
        return summary
    finally:
        if owns_conn:
            conn.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")

    def _print_progress(page, last_page, matched_count):
        logger.info("ページ%d/%d取得完了 (累計マッチ %d件)", page, last_page, matched_count)

    sync_prices(progress_callback=_print_progress)
