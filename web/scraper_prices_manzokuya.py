"""カードショップ「まんぞく屋」(shopmanzokuya.com)から名探偵コナンTCGの価格を
取得し price_history に保存するモジュール。

EC-CUBE系のECカートシステムを使っており、商品名(alt/テキスト)に
「!★パラ〈SRP〉B10066P2伊達航」のような形式でレアリティ記号と、そのまま
DBの`card_num`と完全一致するカード番号が含まれている(例外的にプロモカードは
「P012PR251 世良真純」のように業務キーcard_id(P012)の直後にcard_num(PR251)が
連結される)。そのため駿河屋・フルアヘッドと同様、カード番号ベースで直接
マッチングできる。

対象カテゴリ(category_id=3556)が名探偵コナンTCGの単品カードを1カテゴリに
まとめているため、これを丸ごとページングして取得すれば全商品を網羅できる
(2026年8月時点で132件・1ページ100件・2ページ)。

まんぞく屋のrobots.txtは`/*.csv$`のみDisallowで一般クローラーへの制限が無いが、
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

LIST_URL = "https://shopmanzokuya.com/products/list"
CATEGORY_ID = 3556
PAGE_SIZE = 100

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

REQUEST_TIMEOUT = 15
REQUEST_DELAY_SEC = 30
MAX_PAGES = 20

# 商品名からカード番号を取り出す。通常のブースター収録カードは
# "B10066P2伊達航"のようにアルファベット1〜2文字+5桁の数字([Pパラレル番号/Secサイン
# 番号の接尾辞つきのことも])、プロモカードは業務キー(P012等)の直後に
# "PR251"のような3桁のプロモ番号が連結される形式。
CARD_NUM_PATTERN = re.compile(r"(?:PR\d{3}|[A-Z]{1,2}\d{5}(?:P\d?|Sec\d)?)")

TOTAL_COUNT_PATTERN = re.compile(r"(\d+)件")

logger = logging.getLogger(__name__)


def fetch_page(page: int) -> str:
    params = {"category_id": CATEGORY_ID, "pageno": page}
    resp = requests.get(LIST_URL, params=params, headers=HEADERS, timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    return resp.text


def parse_items(html: str) -> list[tuple[str, int]]:
    """(card_num, price) のリストを返す。在庫0件(品切れ)の商品は除外する。"""
    soup = BeautifulSoup(html, "html.parser")
    results = []
    for li in soup.select("li.ec-shelfGrid__item"):
        name_el = li.select_one(".ec-shelfGrid__item-text")
        if not name_el:
            continue

        stock_el = li.select_one(".productStock")
        if stock_el:
            stock_text = stock_el.get_text(strip=True)
            # "在庫:0" は品切れ(過去の最終価格が残ったままのため記録しない)。
            # "在庫:◯"(在庫あり)や"在庫:2"等の具体的な点数は対象。
            if re.search(r"在庫:0\b", stock_text):
                continue

        m = CARD_NUM_PATTERN.search(name_el.get_text())
        if not m:
            continue
        card_num = m.group(0)

        price_el = li.select_one(".price02-default")
        if not price_el:
            continue
        price_text = price_el.get_text().replace("￥", "").replace(",", "")
        price_text = re.sub(r"\(税込\)", "", price_text).strip()
        try:
            price = int(price_text)
        except ValueError:
            continue

        results.append((card_num, price))
    return results


def parse_total_count(html: str) -> int:
    soup = BeautifulSoup(html, "html.parser")
    el = soup.select_one(".ec-searchnavRole__counter .ec-font-bold")
    if not el:
        return 0
    m = TOTAL_COUNT_PATTERN.search(el.get_text())
    return int(m.group(1)) if m else 0


def sync_prices(conn=None, delay: float = REQUEST_DELAY_SEC, progress_callback=None) -> dict:
    """まんぞく屋からカード価格を取得し price_history に保存する。

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
                logger.warning("まんぞく屋の取得に失敗 (page=%d): %s", page, exc)
                break

            if page == 1:
                total = parse_total_count(html)
                last_page = max(1, -(-total // PAGE_SIZE))  # 切り上げ除算

            for card_num, price in parse_items(html):
                if card_num not in target_by_num:
                    continue
                all_prices[card_num].append(price)

            if progress_callback:
                progress_callback(page, last_page, len(all_prices))

            page += 1

        run_recorded_at = datetime.now(timezone.utc).isoformat()
        for card_num, prices in all_prices.items():
            card_pk = target_by_num[card_num]
            count = len(prices)
            min_price = min(prices)
            db.insert_price(conn, card_pk, "まんぞく屋", min_price, recorded_at=run_recorded_at, sample_count=count)

        unmatched = sorted(set(target_by_num) - set(all_prices))
        summary = {
            "target": len(target_by_num),
            "matched": len(all_prices),
            "unmatched": len(unmatched),
        }
        logger.info(
            "完了: 対象%d件中 %d件の価格を取得(まんぞく屋) (未取得 %d件)",
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
