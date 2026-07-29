"""SQLite データベースアクセス層。

カードの主キーには公式サイトAPIの `id` (数値・一意) を採用している。
サイト側の `card_id` (例: P001, 0001) は再録などで重複しうるため主キーには使わない。
"""
import sqlite3
from pathlib import Path
from datetime import datetime, timezone

DB_PATH = Path(__file__).parent / "data" / "conan_tcg.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS cards (
    id INTEGER PRIMARY KEY,
    card_id TEXT,
    card_num TEXT UNIQUE,
    name TEXT NOT NULL,
    card_type TEXT,
    rarity TEXT,
    color TEXT,
    category TEXT,
    level INTEGER,
    ap INTEGER,
    lp INTEGER,
    pack TEXT,
    ability_text TEXT,
    hirameki TEXT,
    cut_in TEXT,
    henso TEXT,
    difficulty_first INTEGER,
    difficulty_second INTEGER,
    flavor_text TEXT,
    illustrator TEXT,
    image_url TEXT,
    sub_image_url TEXT,
    q_a TEXT,
    release_date TEXT,
    source_updated_at TEXT,
    fetched_at TEXT
);

CREATE TABLE IF NOT EXISTS price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id INTEGER NOT NULL,
    site TEXT NOT NULL,
    price INTEGER NOT NULL,
    recorded_at TEXT NOT NULL,
    sample_count INTEGER,
    FOREIGN KEY (card_id) REFERENCES cards(id)
);

CREATE INDEX IF NOT EXISTS idx_cards_name ON cards(name);
CREATE INDEX IF NOT EXISTS idx_price_card ON price_history(card_id);
"""

CARD_COLUMNS = [
    "id", "card_id", "card_num", "name", "card_type", "rarity", "color",
    "category", "level", "ap", "lp", "pack", "ability_text", "hirameki",
    "cut_in", "henso", "difficulty_first", "difficulty_second", "flavor_text",
    "illustrator", "image_url", "sub_image_url", "q_a", "release_date",
    "source_updated_at", "fetched_at",
]


def get_connection(db_path: Path = DB_PATH) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)
    columns = [row["name"] for row in conn.execute("PRAGMA table_info(price_history)")]
    if "sample_count" not in columns:
        conn.execute("ALTER TABLE price_history ADD COLUMN sample_count INTEGER")
    conn.commit()


def upsert_cards(conn: sqlite3.Connection, cards: list[dict]) -> dict:
    """カードを一括 upsert する。新規/更新件数を返す。"""
    new_count = 0
    updated_count = 0
    now = datetime.now(timezone.utc).isoformat()

    placeholders = ", ".join(f":{c}" for c in CARD_COLUMNS)
    assignments = ", ".join(f"{c}=excluded.{c}" for c in CARD_COLUMNS if c not in ("id", "fetched_at"))

    sql = f"""
        INSERT INTO cards ({", ".join(CARD_COLUMNS)})
        VALUES ({placeholders})
        ON CONFLICT(id) DO UPDATE SET {assignments}
        WHERE excluded.source_updated_at IS NOT cards.source_updated_at
    """

    for card in cards:
        existing = conn.execute("SELECT source_updated_at FROM cards WHERE id = ?", (card["id"],)).fetchone()
        row = {**card, "fetched_at": now}
        conn.execute(sql, row)
        if existing is None:
            new_count += 1
        elif existing["source_updated_at"] != card["source_updated_at"]:
            updated_count += 1

    conn.commit()
    return {"new": new_count, "updated": updated_count, "total": len(cards)}


def search_cards(conn: sqlite3.Connection, keyword: str = "", colors=None, types=None,
                  rarities=None, levels=None) -> list[sqlite3.Row]:
    query = "SELECT * FROM cards WHERE 1=1"
    params: list = []

    if keyword:
        query += " AND (name LIKE ? OR ability_text LIKE ? OR category LIKE ?)"
        like = f"%{keyword}%"
        params += [like, like, like]

    def add_in_filter(column: str, values):
        nonlocal query
        if values:
            placeholders = ", ".join("?" for _ in values)
            query_part = f" AND {column} IN ({placeholders})"
            return query_part, list(values)
        return "", []

    for column, values in (("color", colors), ("card_type", types), ("rarity", rarities), ("level", levels)):
        part, vals = add_in_filter(column, values)
        query += part
        params += vals

    query += " ORDER BY card_num"
    return conn.execute(query, params).fetchall()


def get_card(conn: sqlite3.Connection, card_pk: int) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM cards WHERE id = ?", (card_pk,)).fetchone()


def get_distinct_values(conn: sqlite3.Connection, column: str) -> list[str]:
    rows = conn.execute(f"SELECT DISTINCT {column} FROM cards WHERE {column} IS NOT NULL ORDER BY {column}").fetchall()
    return [r[0] for r in rows]


def count_cards(conn: sqlite3.Connection) -> int:
    return conn.execute("SELECT COUNT(*) FROM cards").fetchone()[0]


def insert_price(
    conn: sqlite3.Connection,
    card_pk: int,
    site: str,
    price: int,
    recorded_at: str | None = None,
    sample_count: int | None = None,
) -> None:
    recorded_at = recorded_at or datetime.now(timezone.utc).isoformat()
    conn.execute(
        "INSERT INTO price_history (card_id, site, price, recorded_at, sample_count) VALUES (?, ?, ?, ?, ?)",
        (card_pk, site, price, recorded_at, sample_count),
    )
    conn.commit()


def get_price_history(conn: sqlite3.Connection, card_pk: int) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT * FROM price_history WHERE card_id = ? ORDER BY recorded_at", (card_pk,)
    ).fetchall()
