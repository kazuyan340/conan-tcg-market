"""カードラボから名探偵コナンTCGカードの価格を取得し price_history に保存するモジュール。

駿河屋と違い、カードラボの検索結果には `goods_name` というクラスの要素に
"【CTCG】{カード名}【{レアリティ}】{パック略称}[{カード番号}]" という形式で
カード番号とレアリティがそのまま残っている。しかもキーワード「CTCG」1つで
全カード種を横断検索できるため(1ページ120件・全18ページ程度)、駿河屋のように
レアリティ単位で検索を分ける必要がない。

カードラボのrobots.txtには一般クローラー向けのCrawl-delay指定が無いが、
駿河屋と同様に安全側でリクエスト間隔30秒を採用する。
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

SEARCH_URL = "https://www.c-labo-online.jp/product-list/"
KEYWORD = "CTCG"
PAGE_SIZE = 120

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

# 全カードを1キーワード検索で取得済みなので、C/CP/R/RPを除外しても追加アクセスは
# 減らない(既に取得したデータを捨てているだけだった)。除外なしに変更。
EXCLUDED_RARITIES = []

REQUEST_TIMEOUT = 15
REQUEST_DELAY_SEC = 30
MAX_PAGES = 60  # 安全のための上限(実際の最終ページはparse_total_countから算出)

# 例: "【CTCG】怪盗キッド【PR】[PR024]" / "【CTCG】犯人【C】CT-P02[B02088]"
# 検索キーワードがハイライトされ goods_name 内に <b> タグ等が混ざるため、
# 呼び出し側でテキスト抽出(get_text)した後にこの正規表現を適用する。
NAME_PATTERN = re.compile(r"【([^】]+)】(?:[^【\[]*)\[([^\]\[]+)\]\s*$")

# 上と同じ商品名テキストからキャラ名部分だけを取り出す(管理ページの
# 「反映できていないカード」一覧に表示するため。価格照合には使わない)。
# レアリティの後ろにパック略称が挟まることがある(例:
# "【CTCG】犯人【C】CT-P02[B02088]")ため、末尾の[型番]の直前は任意の文字列を許容する。
PRODUCT_NAME_PATTERN = re.compile(r"^【CTCG】(.+?)【[^】]+】[^【\[]*\[[^\]]+\]\s*$")

logger = logging.getLogger(__name__)


def fetch_search_page(page: int) -> str:
    params = {"keyword": KEYWORD, "num": PAGE_SIZE, "page": page}
    resp = requests.get(SEARCH_URL, params=params, headers=HEADERS, timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    return resp.text


def parse_items(html: str) -> list[tuple[str, str, int | None, str | None, str | None, str | None]]:
    """(card_num, rarity, price, キャラ名(あれば), 商品画像URL(あれば),
    商品ページURL(あれば)) のリストを返す。在庫切れの場合はpriceがNoneになる
    (呼び出し側で「今回は在庫切れと確認できた」の判定に使う)。末尾3つは価格照合
    には使わず、1枚に特定できなかった場合の管理ページ表示用(unresolved_report参照)。
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
        rarity, card_num = m.group(1), m.group(2)

        name_m = PRODUCT_NAME_PATTERN.match(name_text)
        product_name = name_m.group(1) if name_m else None
        photo_el = li.select_one(".global_photo")
        image_url = photo_el.get("data-src") if photo_el else None
        link_el = li.select_one("a.item_data_link")
        product_url = link_el.get("href") if link_el else None

        if "list_item_soldout" in (li.get("class") or []):
            results.append((card_num, rarity, None, product_name, image_url, product_url))
            continue

        price_el = li.select_one(".price .figure")
        if not price_el:
            continue

        price_text = price_el.get_text().split("円")[0].replace(",", "").strip()
        try:
            price = int(price_text)
        except ValueError:
            continue

        results.append((card_num, rarity, price, product_name, image_url, product_url))
    return results


def parse_total_count(html: str) -> int:
    soup = BeautifulSoup(html, "html.parser")
    el = soup.select_one(".count_number .number")
    if not el:
        return 0
    return int(el.get_text().replace(",", ""))


def sync_prices(conn=None, delay: float = REQUEST_DELAY_SEC, progress_callback=None) -> dict:
    """高レアリティカードの価格をカードラボから取得し price_history に保存する。

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
                html = fetch_search_page(page)
            except requests.RequestException as exc:
                logger.warning("カードラボの取得に失敗 (page=%d): %s", page, exc)
                break

            if page == 1:
                total = parse_total_count(html)
                last_page = max(1, -(-total // PAGE_SIZE))  # 切り上げ除算

            for card_num, rarity, price, product_name, image_url, product_url in parse_items(html):
                if card_num not in target_by_num or price is None:
                    if card_num not in target_by_num and price is not None:
                        unresolved_entries.append({
                            "raw_key": card_num, "rarity": rarity, "price": price, "hint": "",
                            "product_name": product_name, "image_url": image_url, "product_url": product_url,
                        })
                    continue
                all_prices[card_num].append(price)

            if progress_callback:
                progress_callback(page, last_page, len(all_prices))

            page += 1

        run_recorded_at = datetime.now(timezone.utc).isoformat()
        for card_num, prices in all_prices.items():
            card_id = target_by_num[card_num]
            count = len(prices)
            min_price = min(prices)
            db.insert_price(conn, card_id, "カードラボ", min_price, recorded_at=run_recorded_at, sample_count=count)

        write_unresolved("カードラボ", unresolved_entries)

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
