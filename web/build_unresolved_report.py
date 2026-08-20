"""各価格スクレイパーが sync_prices() の実行中に書き出した
web/site/data/unresolved_raw/{site}.json (unresolved_report.write_unresolved参照)を
まとめて、管理ページ(admin-unofficial-cards.html)が読み込む
web/site/data/unresolved-shop-items.json を作る。

各エントリを2種類に振り分ける。
- ambiguous: (card_id, レアリティ)からDBの候補カードまでは絞れたが1枚に特定
  できなかったもの。候補カードの画像を出せる。
- missing: 該当するcard_idがDBに1件も無いもの(表記ゆれの可能性もあるが、
  現状はそのまま「見当たらない」として扱う)。画像は出せない。

新たにサイトへアクセスすることはなく、既に書き出し済みの生データとDBだけで完結する。
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import db
from unresolved_report import UNRESOLVED_DIR

OUT_PATH = Path(__file__).parent / "site" / "data" / "unresolved-shop-items.json"


def candidates_for(conn, raw_key: str, rarity: str | None) -> list[dict]:
    """card_idの表記ゆれ(先頭ゼロの有無)を吸収するため、生の値そのものでの一致と、
    数値としての一致(先頭ゼロ違い)の両方を試す。サイトによってlookupキーの
    正規化方法が異なる(先頭ゼロを落とすサイト/落とさないサイトが混在する)ため。
    候補カードの一覧は「どのカード同士で区別が付いていないか」をテキストで
    示すためのものなので、card_num/nameだけ返す(画像は出さない方針のため不要)。
    """
    raw_key = raw_key.strip()
    is_num = raw_key.isdigit()
    condition = "card_id=? OR (? = 1 AND card_id GLOB '[0-9]*' AND CAST(card_id AS INTEGER)=CAST(? AS INTEGER))"
    params = [raw_key, 1 if is_num else 0, raw_key if is_num else "0"]
    if rarity:
        rows = conn.execute(
            f"SELECT id, card_num, name, rarity, pack FROM cards WHERE ({condition}) AND rarity=?",
            (*params, rarity),
        ).fetchall()
    else:
        rows = conn.execute(
            f"SELECT id, card_num, name, rarity, pack FROM cards WHERE ({condition})",
            params,
        ).fetchall()
    return [dict(r) for r in rows]


def dedupe(rows: list[dict]) -> list[dict]:
    """同じ(site, raw_key, rarity)の複数出品/複数価格は1件にまとめ、価格リストと
    件数を集約する。
    """
    grouped: dict[tuple, dict] = {}
    for r in rows:
        key = (r["site"], r["raw_key"], r["rarity"])
        if key not in grouped:
            grouped[key] = {**r, "listing_count": 1, "prices": [r["price"]] if r["price"] is not None else []}
        else:
            grouped[key]["listing_count"] += 1
            if r["price"] is not None:
                grouped[key]["prices"].append(r["price"])
    return list(grouped.values())


def build_report(conn) -> dict:
    ambiguous: list[dict] = []
    missing: list[dict] = []

    if not UNRESOLVED_DIR.exists():
        return {"ambiguous": [], "missing": []}

    for path in sorted(UNRESOLVED_DIR.glob("*.json")):
        site = path.stem
        entries = json.loads(path.read_text(encoding="utf-8"))
        for e in entries:
            cands = candidates_for(conn, e["raw_key"], e.get("rarity"))
            row = {
                "site": site, "raw_key": e["raw_key"], "rarity": e.get("rarity"),
                "price": e.get("price"), "hint": e.get("hint", ""),
                "product_name": e.get("product_name") or "",
                "image_url": e.get("image_url"),
            }
            if cands:
                ambiguous.append({**row, "candidates": cands})
            else:
                missing.append(row)

    return {"ambiguous": dedupe(ambiguous), "missing": dedupe(missing)}


def main():
    conn = db.get_connection()
    db.init_db(conn)
    report = build_report(conn)
    OUT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"unresolved-shop-items.json: ambiguous={len(report['ambiguous'])}件 missing={len(report['missing'])}件")
    conn.close()


if __name__ == "__main__":
    main()
