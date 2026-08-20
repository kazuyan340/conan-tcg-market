"""名探偵コナン&ロルカナ専門店「フルアヘッド」(full-conan.com)から
価格を取得し price_history に保存するモジュール。

MakeShop系のECカートシステムを使っており、商品名にそのまま公式のカード番号が
含まれている(例: "B10062Sec1 松田陣平 SEC [ID:P038]【レンガ版】"、
"【パラレル】B10021P 服部平蔵＆遠山銀司郎 MRP [ID:1082]")。
先頭の【パラレル】等のタグを除けば、最初のトークンがそのままDBの`card_num`と
一致するため、駿河屋と同様にカード番号ベースで直接マッチングできる。

「conan」カテゴリ(https://www.full-conan.com/view/category/conan )が
名探偵コナン関連商品を横断的に含む1カテゴリになっており(2026年8月時点で
2,394件・1ページ50件)、これを丸ごとページングして取得すれば全商品を網羅できる。

full-conan.comにはrobots.txt自体が存在しない(Crawl-delay指定なし)ため、
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

# ページ1も含めて/shopbrand/conan/page{N}/recommend/ で統一してアクセスできる。
LIST_URL_TEMPLATE = "https://www.full-conan.com/shopbrand/conan/page{page}/recommend/"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

REQUEST_TIMEOUT = 15
REQUEST_DELAY_SEC = 30
MAX_PAGES = 100  # 安全のための上限(実際の最終ページは全商品件数から算出)

# 先頭の【パラレル】等のタグを飛ばし、最初の英数字トークンをカード番号として拾う。
# 例: "B10062Sec1 松田陣平 SEC [ID:P038]【レンガ版】" -> "B10062Sec1"
#     "【パラレル】B10021P 服部平蔵＆遠山銀司郎 MRP [ID:1082]" -> "B10021P"
CARD_NUM_PATTERN = re.compile(r"^(?:【[^】]*】)*([A-Za-z0-9]+)\s")

TOTAL_COUNT_PATTERN = re.compile(r"全[^\[]*\[([\d,]+)\]")

logger = logging.getLogger(__name__)


def fetch_page(page: int) -> str:
    resp = requests.get(LIST_URL_TEMPLATE.format(page=page), headers=HEADERS, timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    return resp.text


def parse_items(html: str) -> list[tuple[str, int | None]]:
    """(card_num, price) のリストを返す。売り切れの場合はpriceがNoneになる
    (呼び出し側で「今回は売り切れと確認できた」の判定に使う)。
    """
    soup = BeautifulSoup(html, "html.parser")
    results = []
    for name_el in soup.select("span.itemName"):
        container = name_el.find_parent("div")
        if not container:
            continue

        m = CARD_NUM_PATTERN.match(name_el.get_text().strip() + " ")
        if not m:
            continue
        card_num = m.group(1)

        # 売り切れ商品は<p class="soldout">sold out</p>が同じブロック内に付くが、
        # 価格(<strong>)自体は最後に売れた時の値段が残ったままなので、これを
        # チェックしないと在庫切れの古い価格を最新の相場として記録してしまう。
        if container.select_one(".soldout"):
            results.append((card_num, None))
            continue

        price_el = container.select_one(".itemPrice strong")
        if not price_el:
            continue

        price_text = price_el.get_text().split("円")[0].replace(",", "").strip()
        try:
            price = int(price_text)
        except ValueError:
            continue

        results.append((card_num, price))
    return results


def parse_total_count(html: str) -> int:
    m = TOTAL_COUNT_PATTERN.search(html)
    return int(m.group(1).replace(",", "")) if m else 0


def sync_prices(conn=None, delay: float = REQUEST_DELAY_SEC, progress_callback=None) -> dict:
    """フルアヘッドからカード価格を取得し price_history に保存する。

    progress_callback(page, last_page, matched_count) が指定されていれば
    ページ取得のたびに呼び出す。
    """
    owns_conn = conn is None
    if owns_conn:
        conn = db.get_connection()
        db.init_db(conn)

    target_by_num = {row["card_num"]: row["id"] for row in db.search_cards(conn)}
    logger.info("価格取得対象: %d件", len(target_by_num))

    all_prices: dict[str, list[int]] = defaultdict(list)
    unresolved_entries: list[dict] = []
    first_request = True
    page_size = 50

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
                logger.warning("フルアヘッドの取得に失敗 (page=%d): %s", page, exc)
                break

            if page == 1:
                total = parse_total_count(html)
                last_page = max(1, -(-total // page_size))  # 切り上げ除算

            for card_num, price in parse_items(html):
                if card_num not in target_by_num or price is None:
                    if card_num not in target_by_num and price is not None:
                        unresolved_entries.append({"raw_key": card_num, "rarity": None, "price": price, "hint": ""})
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
            db.insert_price(conn, card_id, "フルアヘッド", min_price, recorded_at=run_recorded_at, sample_count=count)

        write_unresolved("フルアヘッド", unresolved_entries)

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
