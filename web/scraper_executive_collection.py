"""公式サイトのカード一覧API(scraper_cards.py)には掲載されていない「エグゼクティブ
コレクション」(既存キャラの新規パラレル違い、レアリティ「SP」)を、トレカバースの
商品一覧から逆輸入してcardsテーブルに追加するモジュール。

公式サイトのカード一覧ページ・商品一覧ページのどちらにもエグゼクティブコレクション
自体の掲載が無く、他の入手経路が無いことを確認済み(2026年8月時点)。ただし収録カードは
基本的に既存キャラの再録パラレルで、同じcard_id(レアリティ違いをまとめる業務キー)の
既存カードとレベル/AP/LP/能力テキスト等のゲームデータが完全に一致することを複数例で
確認済み(例: 萩原研二 D11009/D11010、伊達航 B10066/B10066P/B10066P2)。そのため
同じcard_idの既存カードからゲームデータを複製し、rarity="SP"・card_num・packだけ
新規に採番して登録する。

画像は公式のSPパラレル版そのものが存在しないため、複製元カードのimage_urlを
そのまま流用する(実際のパラレル絵とは異なる=正確ではないが、無しよりはまし)。

card_idが既存カードに1件も無い(=完全新規カードで複製元が無い)場合は、商品写真の
解像度がゲームデータをOCRで読み取れるほど高くないため、誤ったデータを作るより
記録しない方が安全と判断してスキップする(2026年8月時点で[02]の「コナン界の
かっ飛び女大集合！」card_id=1159が該当)。

対象カテゴリはトレカバースの「コナンカード:エグゼクティブコレクション」配下の
サブカテゴリ(141=[01] Flashback of 2025, 142=[02]Highway in 2026)。未開封の
ボックス商品自体(商品名に「未開封」を含む)は除外する。将来[03]以降が追加されたら
EXEC_CATEGORIESに手動で追記する必要がある(通常のブースターパック追加と同様)。
"""
import logging
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import db

BASE_URL = "https://www.torecabirth.jp/product-list/{category}"
PAGE_SIZE = 60

# カテゴリID -> (card_num接頭辞, pack列に書く表記)
EXEC_CATEGORIES = {
    141: ("EXC01", "EXC01 エグゼクティブコレクション [01] Flashback of 2025"),
    142: ("EXC02", "EXC02 エグゼクティブコレクション [02]Highway in 2026"),
}

# cards.idは公式サイトAPIの数値idをそのまま主キーに使っており(1〜3000程度、今後も
# 新カード追加のたびに緩やかに増え続ける)、ここで新規追加する行にAUTOINCREMENTの
# 採番を任せると、いずれ公式側の新しいidと衝突する(実際に2823番台を自動採番して
# しまい、公式側がそこまで増えたら壊れるところだった)。そのため、公式側が
# 絶対に到達しない大きな範囲を専用に割り当てて、その中で採番する。
EXEC_ID_BASE = 900_000_000

# データの出どころを示すタグ。cards.data_source列に入れる。
DATA_SOURCE = "shop:torecabirth"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

REQUEST_TIMEOUT = 15
REQUEST_DELAY_SEC = 30

NAME_PATTERN = re.compile(r"^(.+?)【SP】.*?\[型番\s*([A-Za-z0-9]+)\]")

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


def parse_items(html: str) -> list[tuple[str, str]]:
    """(カード名, card_id) のリストを返す。未開封のボックス商品自体は除外する。"""
    soup = BeautifulSoup(html, "html.parser")
    results = []
    for li in soup.select("li.list_item_cell"):
        name_el = li.select_one(".goods_name")
        if not name_el:
            continue
        name_text = name_el.get_text()
        if "未開封" in name_text:
            continue
        m = NAME_PATTERN.match(name_text)
        if not m:
            continue
        results.append((m.group(1), m.group(2)))
    return results


def sync_executive_collection(conn=None, delay: float = REQUEST_DELAY_SEC) -> dict:
    """トレカバースからエグゼクティブコレクションのカードを取得し、
    既存カードから複製する形でcardsテーブルに追加する。
    """
    owns_conn = conn is None
    if owns_conn:
        conn = db.get_connection()
        db.init_db(conn)

    added = []
    skipped_no_source = []
    skipped_existing = []
    first_request = True

    next_id_row = conn.execute(
        "SELECT MAX(id) FROM cards WHERE id >= ?", (EXEC_ID_BASE,)
    ).fetchone()
    next_id = (next_id_row[0] + 1) if next_id_row[0] else EXEC_ID_BASE + 1

    try:
        for category, (num_prefix, pack_text) in EXEC_CATEGORIES.items():
            if not first_request:
                time.sleep(delay)
            first_request = False

            try:
                html = fetch_page(category, 1)
            except requests.RequestException as exc:
                logger.warning("トレカバースの取得に失敗 (category=%d): %s", category, exc)
                continue

            for name, card_id in parse_items(html):
                new_card_num = f"{num_prefix}-{card_id}"

                existing = conn.execute(
                    "SELECT id FROM cards WHERE card_num = ?", (new_card_num,)
                ).fetchone()
                if existing:
                    skipped_existing.append(new_card_num)
                    continue

                source = conn.execute(
                    "SELECT * FROM cards WHERE card_id = ? LIMIT 1", (card_id,)
                ).fetchone()
                if not source:
                    skipped_no_source.append((name, card_id))
                    continue

                now = datetime.now(timezone.utc).isoformat()
                conn.execute(
                    """
                    INSERT INTO cards (
                        id, card_id, card_num, name, card_type, rarity, color, category,
                        level, ap, lp, pack, ability_text, hirameki, cut_in, henso,
                        difficulty_first, difficulty_second, flavor_text, illustrator,
                        image_url, sub_image_url, q_a, release_date,
                        source_updated_at, fetched_at, data_source
                    ) VALUES (?, ?, ?, ?, ?, 'SP', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        next_id, source["card_id"], new_card_num, source["name"] or name,
                        source["card_type"], source["color"], source["category"],
                        source["level"], source["ap"], source["lp"], pack_text,
                        source["ability_text"], source["hirameki"], source["cut_in"],
                        source["henso"], source["difficulty_first"], source["difficulty_second"],
                        source["flavor_text"], source["illustrator"], source["image_url"],
                        source["sub_image_url"], source["q_a"], None, None, now, DATA_SOURCE,
                    ),
                )
                added.append(new_card_num)
                next_id += 1

        conn.commit()
        summary = {
            "added": added,
            "skipped_no_source": skipped_no_source,
            "skipped_existing": skipped_existing,
        }
        logger.info(
            "完了: %d件追加、複製元なしで%d件スキップ、%d件は登録済み",
            len(added), len(skipped_no_source), len(skipped_existing),
        )
        return summary
    finally:
        if owns_conn:
            conn.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    result = sync_executive_collection()
    if result["skipped_no_source"]:
        logger.info("複製元が無くスキップ: %s", result["skipped_no_source"])
