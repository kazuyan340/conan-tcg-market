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

画像は公式のSPパラレル版そのものが存在しないため、トレカバースの商品詳細ページに
載っている実際の商品写真(オリジナル解像度のもの)を使う。一覧ページのサムネイルは
85x120程度と小さいため、商品ごとに詳細ページを1回追加取得して大きい画像のURLを
取り出す。取得に失敗した場合だけ、複製元カードのimage_urlを仮流用する
(実際のパラレル絵とは異なる=正確ではないが、無しよりはまし)。

card_idが既存カードに1件も無い(=完全新規カードで複製元が無い)場合は、商品写真の
解像度がゲームデータをOCRで読み取れるほど高くないため、誤ったデータを作るより
記録しない方が安全と判断してスキップする。ただし、ユーザーが実物のカードを見て
種別・ゲームデータを確認済みのものはMANUAL_CARD_DATAに登録し、複製元の代わりに使う
(2026年8月時点でcard_id=1159「コナン界のかっ飛び女大集合！」が該当。事件カードで
レベル/AP/LP/能力テキストはいずれも印刷が無いことをユーザーが確認済み。実物のカード
写真ではタイトル末尾にカッコ書きの文字が小さく見えるが、画像の解像度が低く判読でき
なかったため、ショップの商品ページ表記に合わせてカッコ書きは含めていない)。

対象カテゴリはトレカバースの「コナンカード:エグゼクティブコレクション」配下の
サブカテゴリ(141=[01] Flashback of 2025, 142=[02]Highway in 2026)。未開封の
ボックス商品自体(商品名に「未開封」を含む)は除外する。将来[03]以降が追加されたら
EXEC_CATEGORIESに手動で追記する必要がある(通常のブースターパック追加と同様)。

将来、公式サイトのカード一覧に同じ(card_id, rarity)のカードが正式に追加された
場合は逆輸入した方が重複になるため、cleanup_superseded()で自動的に削除する
(ワークフローでは毎回 scraper_cards.py の後にこのモジュールを実行しているため、
公式側に追加された当日中に検出・削除できる)。
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

# 複製元(同じcard_idの既存カード)が存在しないカードのうち、ユーザーが実物のカードを
# 見てゲームデータを確認済みのもの。card_id -> cardsテーブルの列値(明記の無い列はNone)。
MANUAL_CARD_DATA: dict[str, dict] = {
    "1159": {
        "name": "コナン界のかっ飛び女大集合！",
        "card_type": "事件",
        "color": "黄",
    },
}

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


def parse_items(html: str) -> list[tuple[str, str, str | None]]:
    """(カード名, card_id, 商品詳細ページのURL) のリストを返す。
    未開封のボックス商品自体は除外する。
    """
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
        link_el = li.select_one("a.item_data_link")
        detail_url = link_el.get("href") if link_el else None
        results.append((m.group(1), m.group(2), detail_url))
    return results


def fetch_detail_image_url(detail_url: str) -> str | None:
    """商品詳細ページから、一覧ページのサムネイルより大きいオリジナル画像のURLを取り出す。
    見つからなければNoneを返す(呼び出し側で複製元の画像にフォールバックする)。
    """
    try:
        resp = requests.get(detail_url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
    except requests.RequestException as exc:
        logger.warning("トレカバースの商品詳細ページ取得に失敗 (%s): %s", detail_url, exc)
        return None

    soup = BeautifulSoup(resp.text, "html.parser")
    link_el = soup.select_one(".main_photo_slide a.gallery_link")
    if not link_el:
        return None
    return link_el.get("href")


def cleanup_superseded(conn) -> list[str]:
    """公式サイトのカード一覧に、こちらが逆輸入した(card_id, rarity)と同じ組み合わせの
    正式なカード(data_source IS NULL)が後から追加された場合、逆輸入した方は重複に
    なるため削除する。ワークフローでは毎回 scraper_cards.py (公式同期) の後にこの
    モジュールを実行しているため、公式側に追加された当日中に検出できる。

    price_historyには外部キー制約があり、参照している行が残っていると
    cardsの削除が失敗するため、先にそのカードのprice_historyを削除してから
    cardsを削除する。削除したcard_numのリストを返す。
    """
    removed = []
    rows = conn.execute(
        "SELECT id, card_id, rarity, card_num FROM cards WHERE data_source IS NOT NULL"
    ).fetchall()
    for row in rows:
        official = conn.execute(
            "SELECT id FROM cards WHERE card_id = ? AND rarity = ? AND data_source IS NULL LIMIT 1",
            (row["card_id"], row["rarity"]),
        ).fetchone()
        if official:
            conn.execute("DELETE FROM price_history WHERE card_id = ?", (row["id"],))
            conn.execute("DELETE FROM cards WHERE id = ?", (row["id"],))
            removed.append(row["card_num"])
    if removed:
        conn.commit()
        logger.info("公式サイトに追加されたため逆輸入カードを削除: %s", removed)
    return removed


def sync_executive_collection(conn=None, delay: float = REQUEST_DELAY_SEC) -> dict:
    """トレカバースからエグゼクティブコレクションのカードを取得し、
    既存カードから複製する形でcardsテーブルに追加する。
    """
    owns_conn = conn is None
    if owns_conn:
        conn = db.get_connection()
        db.init_db(conn)

    removed_superseded = cleanup_superseded(conn)

    added = []
    skipped_no_source = []
    skipped_existing = []
    skipped_superseded = []
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

            for name, card_id, detail_url in parse_items(html):
                new_card_num = f"{num_prefix}-{card_id}"

                existing = conn.execute(
                    "SELECT id FROM cards WHERE card_num = ?", (new_card_num,)
                ).fetchone()
                if existing:
                    skipped_existing.append(new_card_num)
                    continue

                # 公式サイトに既に(card_id, "SP")の正式なカードが追加されていれば、
                # ここで逆輸入版を新たに作ると重複になるため作らない。
                official = conn.execute(
                    "SELECT id FROM cards WHERE card_id = ? AND rarity = 'SP' AND data_source IS NULL LIMIT 1",
                    (card_id,),
                ).fetchone()
                if official:
                    skipped_superseded.append(new_card_num)
                    continue

                source = conn.execute(
                    "SELECT * FROM cards WHERE card_id = ? LIMIT 1", (card_id,)
                ).fetchone()
                if not source:
                    manual = MANUAL_CARD_DATA.get(card_id)
                    if manual is None:
                        skipped_no_source.append((name, card_id))
                        continue
                    source = {
                        "card_id": card_id, "name": None, "card_type": None, "color": None,
                        "category": None, "level": None, "ap": None, "lp": None,
                        "ability_text": None, "hirameki": None, "cut_in": None, "henso": None,
                        "difficulty_first": None, "difficulty_second": None, "flavor_text": None,
                        "illustrator": None, "image_url": None, "sub_image_url": None, "q_a": None,
                        **manual,
                    }

                image_url = source["image_url"]
                if detail_url:
                    time.sleep(delay)
                    fetched_image = fetch_detail_image_url(detail_url)
                    if fetched_image:
                        image_url = fetched_image

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
                        source["flavor_text"], source["illustrator"], image_url,
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
            "skipped_superseded": skipped_superseded,
            "removed_superseded": removed_superseded,
        }
        logger.info(
            "完了: %d件追加、複製元なしで%d件スキップ、%d件は登録済み、"
            "公式追加により%d件スキップ・%d件削除",
            len(added), len(skipped_no_source), len(skipped_existing),
            len(skipped_superseded), len(removed_superseded),
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
