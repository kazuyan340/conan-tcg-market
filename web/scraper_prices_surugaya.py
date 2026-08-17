"""駿河屋から高レアリティカードの価格を取得し price_history に保存するモジュール。

検索結果ページの各商品は `div.item` 1個にまとまっており、その中に商品名
(`.product-name`、例: "B01005[SR]：江戸川コナン")と価格欄(`.item_price`)が
両方入っている。これを`div.item`単位でまとめてパースする。

検索は「レアリティ単位」で行う。例えば "名探偵コナンTCG SR" で検索すると
江戸川コナンに限らずSRレアリティの全カードが返ってくるため、
カード単位で299回検索するより遥かに少ないリクエスト数(1レアリティあたり数ページ)で済む。

駿河屋のrobots.txtは `Crawl-delay: 30` を指定しているため、
リクエスト間隔は30秒を厳守する。

品切れの商品は価格欄が"price_teika"クラスの実売価格表示ではなく、
"price"クラスのみで中身が「品切れ」というテキストになる。これをチェックせず
記録すると「品切れなのに購入できる値段」を誤って記録してしまう
(実例: B07002 SRが品切れなのにprice:200が埋め込まれていた)。

以前はGoogle Analytics用のデータレイヤー(`item_name`/`price`)から名前と価格を、
見た目側のHTML(`.item_price`)から品切れ判定だけを別々に取り、両者の出現順序が
1対1で対応するという前提で突き合わせていた。しかし実際にはページによって
データレイヤー側の件数と見た目側の件数が食い違うことがあり(実例: 2026-08-16に
SR一覧22ページ目で22件 vs 24件のずれが発生し、B06067[SR]中森銀三が品切れなのに
別の在庫ありの商品の価格と誤って対応付けられてしまった)、インデックス対応は
信頼できないと判明した。そのため現在は`div.item`単位で商品名・価格・品切れ状態を
まとめて1か所から取り、この種のずれが原理的に起こらないようにしている。
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

SEARCH_URL = "https://www.suruga-ya.jp/search"
TOP_URL = "https://www.suruga-ya.jp/"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
}

# 以前はC(コモン)/CP/R/RPを対象外にしていたが、駿河屋での該当ページ数を実測したところ
# 4レアリティ合計22ページ(約11分)程度で許容範囲だったため全レアリティを対象にした。
# 除外リストの形は残し、対象レアリティはDBの実際の値からその都度算出する
# (新レアリティが増えても自動で対象に入る)。
EXCLUDED_RARITIES = []

REQUEST_TIMEOUT = 15
REQUEST_DELAY_SEC = 30  # 駿河屋のCrawl-delay:30を厳守
MAX_PAGES_PER_RARITY = 60  # 安全のための上限(実際の最終ページはparse_last_pageで判定)

NAME_PATTERN = re.compile(r"^([^\[]+)\[([^\]]+)\](?:[:：](.*))?$")
PRICE_PATTERN = re.compile(r"[\d,]+")
PAGE_LINK_PATTERN = re.compile(r"[?&]page=(\d+)")

logger = logging.getLogger(__name__)


def make_session() -> requests.Session:
    """トップページに先にアクセスしてCookieを取得したセッションを返す。

    検索URLへ直接アクセスすると403 Forbiddenになることがある
    (2026-07-28頃からGitHub Actions実行環境で発生)。トップページ経由の
    通常のブラウザ挙動に近づけることで回避を試みる。
    """
    session = requests.Session()
    session.headers.update(HEADERS)
    resp = session.get(TOP_URL, timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    return session


def fetch_search_page(session: requests.Session, rarity: str, page: int) -> str:
    query = f"名探偵コナンTCG {rarity}"
    params = {"category": "", "search_word": query, "page": page}
    resp = session.get(
        SEARCH_URL, params=params, timeout=REQUEST_TIMEOUT,
        headers={"Referer": TOP_URL},
    )
    resp.raise_for_status()
    return resp.text


def parse_items(html: str) -> list[tuple[str, str, int | None]]:
    """(card_num, rarity, price) のリストを返す。品切れの場合はpriceがNoneになる
    (呼び出し側で「今回は品切れと確認できた」の判定に使う)。

    商品名・価格・品切れ状態を`div.item`単位でまとめて取るため、ページ内の
    件数が食い違って対応がずれる心配が無い(モジュールdocstring参照)。
    """
    soup = BeautifulSoup(html, "html.parser")
    results = []
    for item in soup.select("div.item"):
        name_el = item.select_one(".product-name")
        if not name_el:
            continue
        m = NAME_PATTERN.match(name_el.get_text(strip=True))
        if not m:
            continue
        card_num, rarity = m.group(1), m.group(2)

        price_el = item.select_one(".item_price")
        if not price_el:
            continue

        if "品切れ" in price_el.get_text():
            results.append((card_num, rarity, None))
            continue

        teika_el = price_el.select_one(".price_teika")
        if not teika_el:
            continue
        price_m = PRICE_PATTERN.search(teika_el.get_text())
        if not price_m:
            continue
        results.append((card_num, rarity, int(price_m.group(0).replace(",", ""))))
    return results


def parse_last_page(html: str) -> int:
    """ページネーションのリンクから最終ページ番号を取得する。

    「取得件数が24件未満なら最終ページ」という判定は、駿河屋側のページごとの
    件数が必ずしも一定でないため、途中のページを最終ページと誤判定して
    残りのページを読み飛ばしてしまうことがある(実際にB01006などで発生した)。
    ページネーションリンクに現れる最大のpage番号を見るほうが確実。
    """
    numbers = [int(n) for n in PAGE_LINK_PATTERN.findall(html)]
    return max(numbers) if numbers else 1


def sync_prices(conn=None, delay: float = REQUEST_DELAY_SEC, progress_callback=None) -> dict:
    """高レアリティカードの価格を駿河屋から取得し price_history に保存する。

    progress_callback(rarity, page, matched_count) が指定されていれば
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
    first_request = True

    try:
        try:
            session = make_session()
        except requests.RequestException as exc:
            logger.warning("駿河屋のトップページ取得に失敗: %s", exc)
            session = requests.Session()
            session.headers.update(HEADERS)

        for rarity in target_rarities:
            page = 1
            last_page = 1
            while page <= min(last_page, MAX_PAGES_PER_RARITY):
                if not first_request:
                    time.sleep(delay)
                first_request = False

                try:
                    html = fetch_search_page(session, rarity, page)
                except requests.RequestException as exc:
                    logger.warning("駿河屋の取得に失敗 (rarity=%s page=%d): %s", rarity, page, exc)
                    break

                if page == 1:
                    last_page = parse_last_page(html)

                items = parse_items(html)
                for card_num, item_rarity, price in items:
                    if card_num not in target_by_num or price is None:
                        continue
                    all_prices[card_num].append(price)

                if progress_callback:
                    progress_callback(rarity, page, len(all_prices))

                page += 1

        # sample_count には出品件数(在庫の枚数分)を記録する。
        # 同じ実行内では同じ時刻にしないと、グラフ上で同じ日時なのに別の点として
        # ずれて表示されてしまうため、この回の実行全体で1つのタイムスタンプに揃える。
        run_recorded_at = datetime.now(timezone.utc).isoformat()
        for card_num, prices in all_prices.items():
            card_id = target_by_num[card_num]
            count = len(prices)
            min_price = min(prices)
            db.insert_price(conn, card_id, "駿河屋", min_price, recorded_at=run_recorded_at, sample_count=count)

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

    def _print_progress(rarity, page, matched_count):
        logger.info("レアリティ %s ページ%d取得完了 (累計マッチ %d件)", rarity, page, matched_count)

    sync_prices(progress_callback=_print_progress)
