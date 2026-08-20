"""各価格スクレイパーが「出品はあり価格も付いているのに、DBのカード1枚に
特定できなかった商品」を data/unresolved_raw/{site}.json に書き出すための
共通ヘルパー。通常の価格取得(sync_prices)の副産物として書き出すので、
このためだけに追加でサイトへアクセスすることはない。

build_unresolved_report.py がこれら各サイトの生データをまとめて、DB照会で
候補カードの画像等を補完した上で、管理ページ(admin-unofficial-cards.html)が
読み込む web/site/data/unresolved-shop-items.json を作る。
"""
import json
from pathlib import Path

UNRESOLVED_DIR = Path(__file__).parent / "site" / "data" / "unresolved_raw"


def write_unresolved(site: str, entries: list[dict]) -> None:
    """entriesの各要素は {"raw_key": str, "rarity": str|None, "price": int, "hint": str} 。"""
    UNRESOLVED_DIR.mkdir(parents=True, exist_ok=True)
    path = UNRESOLVED_DIR / f"{site}.json"
    path.write_text(json.dumps(entries, ensure_ascii=False, indent=1), encoding="utf-8")
