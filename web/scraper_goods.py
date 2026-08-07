"""公式サイトの商品情報一覧ページから、拡張パック/構築済みデッキ/周辺グッズの一覧を取得するモジュール。

https://www.takaratomy.co.jp/products/conan-cardgame/products/ は scraper_cards.py が使う
cardlist と違い専用のJSON APIが無く、サーバーサイドレンダリングされたHTMLをそのまま返す。
ページ内の `ul.all.newsList > li` を1件ずつBeautifulSoupでパースする。ページングは
`?page=N`(Laravel標準のページネーション)で、末尾ページはページ内のページネーションリンクから
毎回動的に検出する(商品数が増えてページが増えても追従できるように)。
"""
import re
import sys
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import db

BASE_URL = "https://www.takaratomy.co.jp"
LIST_URL = f"{BASE_URL}/products/conan-cardgame/products/"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
}
REQUEST_TIMEOUT = 15
REQUEST_DELAY_SEC = 1.0  # ページ取得間隔

CATEGORY_LABELS = {
    "pack": "拡張パック",
    "deck": "構築済みデッキ",
    "prd_goods": "周辺グッズ",
}

DATE_PATTERN = re.compile(r"(\d{4})年(\d{1,2})月(\d{1,2})日")
PRICE_PATTERN = re.compile(r"([\d,]+)円")
PAGE_LINK_PATTERN = re.compile(r"page=(\d+)")


def _parse_release_date(text: str) -> str | None:
    m = DATE_PATTERN.search(text or "")
    if not m:
        return None
    y, mo, d = m.groups()
    return f"{int(y):04d}-{int(mo):02d}-{int(d):02d}"


def _parse_price_yen(text: str) -> int | None:
    m = PRICE_PATTERN.search(text or "")
    if not m:
        return None
    return int(m.group(1).replace(",", ""))


def parse_items(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    items = []
    for li in soup.select("ul.all.newsList > li"):
        title_el = li.select_one(".title")
        if not title_el:
            continue

        category_class = "prd_goods"
        category_el = li.select_one(".category")
        if category_el:
            for c in category_el.get("class", []):
                if c in CATEGORY_LABELS:
                    category_class = c
                    break

        day_el = li.select_one(".day")
        price_el = li.select_one(".price")
        img_el = li.select_one(".icon.pc img")
        link_el = li.select_one(".text a[href]")

        detail_url = None
        if link_el and link_el.get("href"):
            href = link_el["href"]
            detail_url = href if href.startswith("http") else f"{BASE_URL}{href}"

        price_text = price_el.get_text(strip=True) if price_el else None
        items.append({
            "title": title_el.get_text(strip=True),
            "category": category_class,
            "category_label": CATEGORY_LABELS.get(category_class, "周辺グッズ"),
            "release_date": _parse_release_date(day_el.get_text(strip=True) if day_el else ""),
            "price_text": price_text,
            "price_yen": _parse_price_yen(price_text),
            "image_url": img_el["src"] if img_el and img_el.get("src") else None,
            "detail_url": detail_url,
        })
    return items


def fetch_page(page: int) -> str:
    url = LIST_URL if page == 1 else f"{LIST_URL}?page={page}"
    resp = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    return resp.text


def _last_page(html: str) -> int:
    soup = BeautifulSoup(html, "html.parser")
    last = 1
    for a in soup.select('a[href*="products?page="]'):
        m = PAGE_LINK_PATTERN.search(a["href"])
        if m:
            last = max(last, int(m.group(1)))
    return last


def sync_all_goods(conn=None) -> dict:
    own_conn = conn is None
    if own_conn:
        conn = db.get_connection()
        db.init_db(conn)

    html = fetch_page(1)
    last_page = _last_page(html)
    all_items = parse_items(html)
    for page in range(2, last_page + 1):
        time.sleep(REQUEST_DELAY_SEC)
        all_items.extend(parse_items(fetch_page(page)))

    result = db.upsert_goods(conn, all_items)

    if own_conn:
        conn.close()
    return result


if __name__ == "__main__":
    stats = sync_all_goods()
    print(f"goods: new={stats['new']} updated={stats['updated']} total={stats['total']}")
