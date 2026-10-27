"""data/conan_tcg.db からカードを絞り込んでJSON書き出し用のdictに変換する。"""
from __future__ import annotations

import sqlite3
from pathlib import Path

import db as pricesite_db  # 価格集計サイト側のDBアクセス層をそのまま再利用する

# アプリ側(デッキ構築・盤面表示)が実際に使うフィールドのみを抜き出す。
# image_url / sub_image_url はこの後 download_images() でローカルパスに差し替えられる。
APP_CARD_FIELDS = [
    "id", "card_id", "card_num", "name", "card_type", "rarity", "color",
    "category", "level", "ap", "lp", "pack", "ability_text",
    "image_url", "sub_image_url",
    # 事件カードの事件レベル(先攻/後攻で異なる、事件解決に必要な証拠枚数)。
    # 対戦アプリの勝利判定に必要
    "difficulty_first", "difficulty_second",
]

# ability_text を組み立てる際に参照する、cards テーブルの能力系カラム(この順で連結する)。
# 公式サイトAPIでは「登場時」等の通常能力(feature)と、ヒラメキ/カットイン/変装が
# 別カラムに分かれて入っており、カードによってはfeatureが空でこれらのカラムにしか
# テキストが無いことがある(例: id=1323 はfeatureがnullでcut_inのみ)。
# この並び順は web/generate_card_pages.py (実サイトのカード詳細ページ)が採用している
# 表示順に合わせてある。
ABILITY_TEXT_SOURCE_COLUMNS = ["ability_text", "hirameki", "cut_in", "henso"]


def _combined_ability_text(row: sqlite3.Row) -> str | None:
    # 公式サイト側のデータに末尾の空行が混ざっていることがあるため、各パーツを
    # trimしてから結合する(例: id=166は feature が「…する。\n\n」のように
    # 余分な改行付きで返ってくる)
    parts = [row[col].strip() for col in ABILITY_TEXT_SOURCE_COLUMNS if row[col] and row[col].strip()]
    return "\n".join(parts) if parts else None


class CardExportError(RuntimeError):
    pass


def export_cards(
    db_path: Path | None = None,
    pack_prefixes: list[str] | None = None,
    limit: int | None = None,
) -> list[dict]:
    """指定した pack (拡張パック/構築済みデッキ)に属するカードをdictのリストで返す。

    pack_prefixes を省略すると全カードを対象にする(2000枚超になるので通常はスターター
    デッキ等に絞って呼び出す想定)。

    data_source IS NOT NULL のカード(公式サイトのカード一覧に載っておらず、ショップの
    商品一覧から逆輸入したカード。例: エグゼクティブコレクションのSPパラレル)は、
    アプリ(デッキ構築・対戦)側では常に除外する。
    """
    conn = pricesite_db.get_connection(db_path) if db_path else pricesite_db.get_connection()
    conn.row_factory = sqlite3.Row
    try:
        if pack_prefixes:
            clauses = " OR ".join("pack LIKE ?" for _ in pack_prefixes)
            params = [f"{p}%" for p in pack_prefixes]
            rows = conn.execute(
                f"SELECT * FROM cards WHERE data_source IS NULL AND ({clauses}) ORDER BY card_num", params
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM cards WHERE data_source IS NULL ORDER BY card_num"
            ).fetchall()

        if not rows:
            raise CardExportError(
                f"指定した条件に一致するカードが見つかりませんでした (pack_prefixes={pack_prefixes})。"
                " scraper_cards.py を実行してDBを最新化してください。"
            )

        cards = []
        for row in rows:
            card = {field: row[field] for field in APP_CARD_FIELDS}
            card["ability_text"] = _combined_ability_text(row)
            cards.append(card)
    finally:
        conn.close()

    if limit:
        cards = cards[:limit]
    return cards
