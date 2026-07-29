"""SQLite (cards / price_history) を静的サイト用のJSONに書き出すスクリプト。

web/site/data/cards.json  … カード一覧全件
web/site/data/prices.json … card_id をキーにした価格履歴(データがあるカードのみ)
web/site/data/trends.json … 価格が急上昇/じわじわ上昇しているカードのランキング

画像はタカラトミーの image_url をそのまま参照する(自前ホストしない=ホットリンク)。
"""
import json
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import db

SPIKE_MIN_PCT = 5     # 急上昇/急下降とみなす最小変化率(直近2時点間、絶対値)
GRADUAL_MIN_PCT = 3   # じわじわ上昇/下降とみなす最小変化率(最初と最新の間、絶対値)
SPIKE_LIMIT = 50
GRADUAL_LIMIT = 50
MOVERS_LIMIT = 100

OUTPUT_DIR = Path(__file__).parent / "site" / "data"

CARD_FIELDS = [
    "id", "card_id", "card_num", "name", "card_type", "rarity", "color",
    "category", "level", "ap", "lp", "pack", "ability_text", "hirameki",
    "cut_in", "henso", "difficulty_first", "difficulty_second", "flavor_text",
    "illustrator", "image_url", "sub_image_url",
]


def export_cards(conn) -> list[dict]:
    rows = db.search_cards(conn)
    cards = [{field: row[field] for field in CARD_FIELDS} for row in rows]
    return cards


def export_prices(conn) -> dict[str, list[dict]]:
    rows = conn.execute(
        "SELECT card_id, site, price, recorded_at, sample_count FROM price_history ORDER BY recorded_at"
    ).fetchall()
    prices: dict[str, list[dict]] = {}
    for row in rows:
        key = str(row["card_id"])
        prices.setdefault(key, []).append({
            "site": row["site"],
            "price": row["price"],
            "recorded_at": row["recorded_at"],
            "sample_count": row["sample_count"],
        })
    return prices


def _price_points_by_card_site(conn, series: str = "min") -> dict[tuple[int, str], list[tuple[str, int]]]:
    """(card_id, site) -> [(recorded_at, price), ...] (日時順)。

    series="min": 各サイトの最安値系列(site が "(平均)" で終わらないもの)
    series="avg": 各サイトの平均値系列(site が "(平均)" で終わるもの、キーのsiteは"(平均)"を除いた名前)

    サイトごとに独立した時系列として扱う。駿河屋とカードラボのように仕入れ元が
    違えば価格帯そのものが異なるため、サイトをまたいで1本の時系列にすると
    「サイトが入れ替わっただけ」を値上がり/値下がりと誤検出してしまう
    (実際に複数サイト導入時にこれで急上昇/急下降が大量に誤検出された)。
    最安値と平均値は同じ日時に別の値として並存するため、混ぜずに系列ごとに扱う。
    """
    site_condition = "site LIKE '%(平均)'" if series == "avg" else "site NOT LIKE '%(平均)'"
    rows = conn.execute(
        f"SELECT card_id, site, price, recorded_at FROM price_history "
        f"WHERE {site_condition} ORDER BY card_id, site, recorded_at"
    ).fetchall()

    by_card_site: dict[tuple[int, str], list[tuple[str, int]]] = defaultdict(list)
    for row in rows:
        site = row["site"][: -len("(平均)")] if series == "avg" else row["site"]
        by_card_site[(row["card_id"], site)].append((row["recorded_at"], row["price"]))
    return by_card_site


def compute_trends(conn) -> dict[str, list[dict]]:
    """価格が急上昇/じわじわ上昇/急下降/じわじわ下降しているカードを判定する。

    - 急上昇/急下降: 直近2時点の変化率の絶対値が SPIKE_MIN_PCT 以上
    - じわじわ上昇/下降: 3時点以上あり、逆方向への動きがほぼ無く、最初→最新の
      変化率の絶対値が GRADUAL_MIN_PCT 以上。かつ、1回のジャンプだけで説明できる
      変化(=急上昇/急下降と同じもの)は除外する。

    サイトをまたいだ価格差を値動きと誤認しないよう、サイトごとに独立して判定する
    (詳細は _price_points_by_card_site のdocstring参照)。
    """
    by_card_site = _price_points_by_card_site(conn, series="min")

    spikes = []
    crashes = []
    gradual_up = []
    gradual_down = []

    for (card_id, site), points in by_card_site.items():
        if len(points) >= 2:
            prev_date, prev_price = points[-2]
            last_date, last_price = points[-1]
            if prev_price > 0:
                pct = (last_price - prev_price) / prev_price * 100
                item = {
                    "card_id": card_id,
                    "site": site,
                    "change_pct": round(pct, 1),
                    "previous_price": prev_price,
                    "previous_date": prev_date,
                    "latest_price": last_price,
                    "latest_date": last_date,
                }
                if pct >= SPIKE_MIN_PCT:
                    spikes.append(item)
                elif pct <= -SPIKE_MIN_PCT:
                    crashes.append(item)

        if len(points) >= 3:
            step_pcts = []
            valid = True
            for i in range(1, len(points)):
                p0 = points[i - 1][1]
                p1 = points[i][1]
                if p0 <= 0:
                    valid = False
                    break
                step_pcts.append((p1 - p0) / p0 * 100)
            if not valid:
                continue

            first_price = points[0][1]
            last_price = points[-1][1]
            if first_price <= 0:
                continue
            overall_pct = (last_price - first_price) / first_price * 100

            item = {
                "card_id": card_id,
                "site": site,
                "change_pct": round(overall_pct, 1),
                "first_price": first_price,
                "first_date": points[0][0],
                "latest_price": last_price,
                "latest_date": points[-1][0],
                "points": len(points),
            }

            if all(sp > -1 for sp in step_pcts):
                max_step = max(step_pcts)
                if overall_pct >= GRADUAL_MIN_PCT and max_step <= overall_pct * 0.7:
                    gradual_up.append(item)
            elif all(sp < 1 for sp in step_pcts):
                min_step = min(step_pcts)
                if overall_pct <= -GRADUAL_MIN_PCT and min_step >= overall_pct * 0.7:
                    gradual_down.append(item)

    # じわじわ上昇/下降と判定された(カード,サイト)組は、その特徴づけの方が正確なので
    # 急上昇/急下降からは除く
    gradual_up_keys = {(item["card_id"], item["site"]) for item in gradual_up}
    gradual_down_keys = {(item["card_id"], item["site"]) for item in gradual_down}
    spikes = [item for item in spikes if (item["card_id"], item["site"]) not in gradual_up_keys]
    crashes = [item for item in crashes if (item["card_id"], item["site"]) not in gradual_down_keys]

    spikes.sort(key=lambda x: x["change_pct"], reverse=True)
    crashes.sort(key=lambda x: x["change_pct"])
    gradual_up.sort(key=lambda x: x["change_pct"], reverse=True)
    gradual_down.sort(key=lambda x: x["change_pct"])
    return {
        "spike": spikes[:SPIKE_LIMIT],
        "gradual": gradual_up[:GRADUAL_LIMIT],
        "crash": crashes[:SPIKE_LIMIT],
        "gradual_down": gradual_down[:GRADUAL_LIMIT],
    }


def compute_movers(by_card_site: dict[tuple[int, str], list[tuple[str, int]]]) -> dict[str, list[dict]]:
    """これまでの平均価格と比べて、値上がりしたカード/値下がりしたカードを(閾値なしで)全て挙げる。

    直近2時点だけの比較だと「最安値の出品が入れ替わっただけ」のような1点のノイズに
    引っ張られやすいため、最新値点を除いた過去の平均価格を基準にする。
    「急上昇」と違って何%以上という足切りをせず、上がった/下がった を単純に分けるだけ。
    変化が無い(0%)カードはどちらにも含めない。サイトをまたいだ価格差を値動きと
    誤認しないよう、サイトごとに独立して判定する。

    by_card_site は _price_points_by_card_site() の結果をそのまま渡す(min系列/avg系列どちらでも可)。
    """
    up = []
    down = []

    for (card_id, site), points in by_card_site.items():
        if len(points) < 2:
            continue
        prior_prices = [price for _, price in points[:-1]]
        avg_price = sum(prior_prices) / len(prior_prices)
        last_date, last_price = points[-1]
        if avg_price <= 0 or avg_price == last_price:
            continue

        pct = (last_price - avg_price) / avg_price * 100
        item = {
            "card_id": card_id,
            "site": site,
            "change_pct": round(pct, 1),
            "average_price": round(avg_price, 1),
            "points": len(prior_prices),
            "latest_price": last_price,
            "latest_date": last_date,
        }
        if pct > 0:
            up.append(item)
        else:
            down.append(item)

    up.sort(key=lambda x: x["change_pct"], reverse=True)
    down.sort(key=lambda x: x["change_pct"])
    return {"up": up[:MOVERS_LIMIT], "down": down[:MOVERS_LIMIT]}


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    conn = db.get_connection()
    db.init_db(conn)

    cards = export_cards(conn)
    with open(OUTPUT_DIR / "cards.json", "w", encoding="utf-8") as f:
        json.dump(cards, f, ensure_ascii=False, separators=(",", ":"))

    prices = export_prices(conn)
    with open(OUTPUT_DIR / "prices.json", "w", encoding="utf-8") as f:
        json.dump(prices, f, ensure_ascii=False, separators=(",", ":"))

    trends = compute_trends(conn)
    with open(OUTPUT_DIR / "trends.json", "w", encoding="utf-8") as f:
        json.dump(trends, f, ensure_ascii=False, separators=(",", ":"))

    movers = {
        "min": compute_movers(_price_points_by_card_site(conn, series="min")),
        "avg": compute_movers(_price_points_by_card_site(conn, series="avg")),
    }
    with open(OUTPUT_DIR / "movers.json", "w", encoding="utf-8") as f:
        json.dump(movers, f, ensure_ascii=False, separators=(",", ":"))

    meta = {"generated_at": datetime.now(timezone.utc).isoformat()}
    with open(OUTPUT_DIR / "meta.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, separators=(",", ":"))

    print(f"cards.json: {len(cards)}件")
    print(f"prices.json: {len(prices)}カード分の価格履歴")
    print(
        f"trends.json: 急上昇{len(trends['spike'])}件 / じわじわ上昇{len(trends['gradual'])}件 / "
        f"急下降{len(trends['crash'])}件 / じわじわ下降{len(trends['gradual_down'])}件"
    )
    print(
        f"movers.json: [最安値] 値上がり{len(movers['min']['up'])}件/値下がり{len(movers['min']['down'])}件 "
        f"[平均値] 値上がり{len(movers['avg']['up'])}件/値下がり{len(movers['avg']['down'])}件"
    )
    print(f"meta.json: generated_at={meta['generated_at']}")

    conn.close()


if __name__ == "__main__":
    main()
