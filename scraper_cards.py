"""名探偵コナンTCG 公式サイトのカード一覧APIからカード情報を取得するモジュール。

公式サイト (https://www.takaratomy.co.jp/products/conan-cardgame/cardlist) は
一覧表示に専用のJSON APIを内部で利用している (cardlist.js 内の $.getJSON 呼び出しから判明)。
   GET https://www.takaratomy.co.jp/products/conan-cardgame/cardlist/cards?page=N
   -> {"data": [...], "page": N, "lastPage": 45, "total": 2240}
そのためPlaywright等によるブラウザ操作は不要で、requestsのみで全件取得できる。
"""
import time
import logging
from datetime import datetime, timezone

import requests

import db

API_URL = "https://www.takaratomy.co.jp/products/conan-cardgame/cardlist/cards"
REFERER = "https://www.takaratomy.co.jp/products/conan-cardgame/cardlist"
STORAGE_URL = "https://www.takaratomy.co.jp/products/conan-cardgame/storage/card/"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Referer": REFERER,
    "Accept": "application/json, text/plain, */*",
}

REQUEST_TIMEOUT = 15
REQUEST_DELAY_SEC = 0.5  # サーバー負荷軽減のためページ取得間隔を空ける

logger = logging.getLogger(__name__)


def _to_int(value):
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (ValueError, TypeError):
        return None


def _image_url(path: str | None) -> str | None:
    return f"{STORAGE_URL}{path}" if path else None


def parse_card(raw: dict) -> dict:
    """APIのカード1件分のJSONを db.cards のカラムに変換する。"""
    categories = [raw.get(f"category{i}") for i in (1, 2, 3)]
    category = ",".join(c for c in categories if c)

    return {
        "id": raw["id"],
        "card_id": raw.get("card_id"),
        "card_num": raw.get("card_num"),
        "name": raw.get("title") or "",
        "card_type": raw.get("type"),
        "rarity": raw.get("rarity"),
        "color": raw.get("color"),
        "category": category or None,
        "level": _to_int(raw.get("cost")),
        "ap": _to_int(raw.get("ap")),
        "lp": _to_int(raw.get("lp")),
        "pack": raw.get("contain") or raw.get("package"),
        "ability_text": raw.get("feature"),
        "hirameki": raw.get("hirameki"),
        "cut_in": raw.get("cut_in"),
        "henso": raw.get("henso"),
        "difficulty_first": _to_int(raw.get("difficulty_first")),
        "difficulty_second": _to_int(raw.get("difficulty_second")),
        "flavor_text": raw.get("flavor_txt"),
        "illustrator": raw.get("illustrator"),
        "image_url": _image_url(raw.get("main_path")),
        "sub_image_url": _image_url(raw.get("sub_path")),
        "q_a": raw.get("q_a"),
        "release_date": raw.get("release_date"),
        "source_updated_at": raw.get("updated_at"),
    }


def fetch_page(page: int) -> dict:
    resp = requests.get(API_URL, params={"page": page}, headers=HEADERS, timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    return resp.json()


def sync_all_cards(conn=None, delay: float = REQUEST_DELAY_SEC, progress_callback=None) -> dict:
    """全カードを取得してDBにupsertする。差分更新にも使える(変更がないカードは書き込みをスキップ)。

    progress_callback(page, last_page, total_fetched) が指定されていれば
    ページ取得のたびに呼び出す(GUIの進捗表示用)。
    """
    owns_conn = conn is None
    if owns_conn:
        conn = db.get_connection()
        db.init_db(conn)

    summary = {"new": 0, "updated": 0, "total": 0}
    try:
        page = 1
        last_page = 1
        while page <= last_page:
            data = fetch_page(page)
            last_page = data["lastPage"]
            cards = [parse_card(raw) for raw in data["data"]]
            result = db.upsert_cards(conn, cards)
            summary["new"] += result["new"]
            summary["updated"] += result["updated"]
            summary["total"] += result["total"]

            if progress_callback:
                progress_callback(page, last_page, summary["total"])

            page += 1
            if page <= last_page:
                time.sleep(delay)
    finally:
        if owns_conn:
            conn.close()

    return summary


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")

    def _print_progress(page, last_page, total):
        logger.info("ページ %d/%d 取得完了 (累計 %d 件)", page, last_page, total)

    result = sync_all_cards(progress_callback=_print_progress)
    logger.info("完了: 新規 %d件 / 更新 %d件 / 合計 %d件", result["new"], result["updated"], result["total"])
