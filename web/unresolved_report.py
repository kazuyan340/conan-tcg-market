"""各価格スクレイパーが「出品はあり価格も付いているのに、DBのカード1枚に
特定できなかった商品」を data/unresolved_raw/{site}.json に書き出すための
共通ヘルパー。通常の価格取得(sync_prices)の副産物として書き出すので、
このためだけに追加でサイトへアクセスすることはない。

build_unresolved_report.py がこれら各サイトの生データをまとめて、DB照会で
候補カードの画像等を補完した上で、管理ページ(admin-unofficial-cards.html)が
読み込む web/site/data/unresolved-shop-items.json を作る。

管理ページでは、候補が複数あるカードについて商品ページの画像を見てユーザーが
「これは実はこのカード」と手動で選べる(候補ピッカー)。選択結果はブラウザの
localStorageに保存され、エクスポートしたJSONをこのリポジトリの
manual_resolutions.jsonに追記することで、各スクレイパーのresolve_candidate()
が最優先で使う「手動確定リスト」になる。キーは商品ページURL(同じ型番+レアリティ
で複数出品があっても、出品ごとに一意)。
"""
import json
from pathlib import Path

UNRESOLVED_DIR = Path(__file__).parent / "site" / "data" / "unresolved_raw"
MANUAL_RESOLUTIONS_PATH = Path(__file__).parent / "manual_resolutions.json"


def write_unresolved(site: str, entries: list[dict]) -> None:
    """entriesの各要素は {"raw_key": str, "rarity": str|None, "price": int, "hint": str,
    "product_url": str|None, ...} 。
    """
    UNRESOLVED_DIR.mkdir(parents=True, exist_ok=True)
    path = UNRESOLVED_DIR / f"{site}.json"
    path.write_text(json.dumps(entries, ensure_ascii=False, indent=1), encoding="utf-8")


def load_manual_resolutions() -> dict[str, int]:
    """商品ページURL -> cards.id の手動確定マップを読み込む。ファイルが無ければ
    空の辞書を返す(このリポジトリではオプトインの仕組みなので、無くても正常動作する)。
    """
    if not MANUAL_RESOLUTIONS_PATH.exists():
        return {}
    data = json.loads(MANUAL_RESOLUTIONS_PATH.read_text(encoding="utf-8"))
    return {entry["product_url"]: entry["card_id"] for entry in data if entry.get("product_url")}
