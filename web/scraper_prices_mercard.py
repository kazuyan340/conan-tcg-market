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
相場として誤登録された)。そのため(card_id, rarity)が1枚に一意に絞れる場合のみ
記録し、複数候補がある場合は諦めて記録しない(誤った値段を出すより欠測の方が安全)。

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

# 名前部分の末尾、レアリティ・色・内部ID(半角[]/全角[]どちらもあり得る)を取り出す。
# 収録パックの表記(末尾の【...】)が無い商品(一部のPRカード等)もあるため任意にする。
# 内部IDの中に「SEC版」等の接頭辞が付くケース(例: ［SEC版P079]）もあるため、
# 一旦カッコの中身を丸ごと拾ってから、末尾の英数字部分だけをIDとして取り出す。
NAME_PATTERN = re.compile(
    "【([^】]+)】《[^》]+》[［\\[]([^\\]］]+)[\\]］](?:【[^】]+】)?\\s*$"
)
ID_TAIL_PATTERN = re.compile(r"[A-Za-z0-9]+$")

logger = logging.getLogger(__name__)


def normalize_id(value: str) -> str:
    """card_idと内部IDの表記ゆれ(先頭ゼロの有無・余分な接頭辞)を吸収して比較できる形にする。"""
    value = value.strip()
    m = ID_TAIL_PATTERN.search(value)
    if m:
        value = m.group(0)
    return str(int(value)) if value.isdigit() else value.upper()


def fetch_page(category: str, page: int) -> str:
    params = {"num": PAGE_SIZE, "page": page}
    resp = requests.get(f"{BASE_URL}/{category}", params=params, headers=HEADERS, timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    return resp.text


def parse_items(html: str) -> list[tuple[str, str, int]]:
    """(内部ID, レアリティ, 価格) のリストを返す(在庫切れ商品・未開封の非単品商品は除外)。"""
    soup = BeautifulSoup(html, "html.parser")
    results = []
    for li in soup.select("li.list_item_cell"):
        if "list_item_soldout" in (li.get("class") or []):
            continue
        name_el = li.select_one(".goods_name")
        price_el = li.select_one(".price .figure")
        if not name_el or not price_el:
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
        rarity, model_number = m.group(1), m.group(2)

        price_text = price_el.get_text().split("円")[0].replace(",", "").strip()
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


def build_lookup(conn) -> dict[tuple[str, str], list[int]]:
    """(正規化card_id, レアリティ) -> 該当するcards.idのリスト、の対応表を作る。"""
    lookup: dict[tuple[str, str], list[int]] = defaultdict(list)
    for row in db.search_cards(conn):
        key = (normalize_id(row["card_id"]), row["rarity"])
        lookup[key].append(row["id"])
    return lookup


def sync_prices(conn=None, delay: float = REQUEST_DELAY_SEC, progress_callback=None) -> dict:
    """メルカードからカード価格を取得し price_history に保存する。

    progress_callback(category, page, matched_count) が指定されていれば
    ページ取得のたびに呼び出す。
    """
    owns_conn = conn is None
    if owns_conn:
        conn = db.get_connection()
        db.init_db(conn)

    lookup = build_lookup(conn)
    logger.info("価格取得対象: %d件(card_id x レアリティの組み合わせ)", len(lookup))

    all_prices: dict[int, list[int]] = defaultdict(list)
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

                for model_number, rarity, price in parse_items(html):
                    key = (normalize_id(model_number), rarity)
                    candidates = lookup.get(key, [])
                    # 候補が2件以上ある場合は1枚に絞り込めない(例: PRカードの
                    # 絵違いが多数ある等)。誤った値段を割り当てるより、
                    # 記録しない方が安全なためスキップする。
                    if len(candidates) == 1:
                        all_prices[candidates[0]].append(price)

                if progress_callback:
                    progress_callback(category, page, len(all_prices))

                page += 1

        run_recorded_at = datetime.now(timezone.utc).isoformat()
        for card_pk, prices in all_prices.items():
            count = len(prices)
            min_price = min(prices)
            db.insert_price(conn, card_pk, "メルカード", min_price, recorded_at=run_recorded_at, sample_count=count)

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
