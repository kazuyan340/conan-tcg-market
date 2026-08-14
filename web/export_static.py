"""SQLite (cards / price_history) を静的サイト用のJSONに書き出すスクリプト。

web/site/data/cards.json  … カード一覧全件
web/site/data/prices.json … card_id をキーにした価格履歴(データがあるカードのみ)
web/site/data/trends.json … 価格が直近上昇/上昇傾向しているカードのランキング
web/site/data/goods.json  … 拡張パック/構築済みデッキ/周辺グッズの商品一覧

画像はタカラトミーの image_url をそのまま参照する(自前ホストしない=ホットリンク)。
"""
import json
import re
import sys
import urllib.parse
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import db

TREND_LIMIT = 50
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


# 公式サイトのカード一覧APIに載っていない(=ショップの商品一覧から逆輸入した)カードを
# 運営者だけが確認できる管理ページ用に別出力する。data_sourceは通常のcards.jsonには
# 含めない(利用者から見て公式カードと区別が付かなくて良いという前提のため)ので、
# ここだけ別途フル出力する。
def export_unofficial_cards(conn) -> list[dict]:
    rows = conn.execute("SELECT * FROM cards WHERE data_source IS NOT NULL ORDER BY id").fetchall()
    return [{field: row[field] for field in [*CARD_FIELDS, "data_source", "fetched_at"]} for row in rows]


GOODS_FIELDS = [
    "title", "category", "category_label", "price_text", "price_yen",
    "release_date", "image_url", "detail_url",
]

# Amazonアソシエイト/楽天アフィリエイトのトラッキングID。登録が済んでIDが分かったら
# ここに入れる。未設定の間は素の検索リンク(アフィリエイトなし)になる。
AMAZON_ASSOCIATE_TAG = "conantcgmarke-22"
RAKUTEN_AFFILIATE_ID = "567cd45a.2625f6eb.567cd45b.7e49c506"

# 「拡張パック CT-P10「追憶の盟友」」のように型番や"拡張パック"などの語が付いた
# フルタイトルのままだと、タカラトミーモールの検索で該当なしになることがある。
# パック/デッキは「」(または半角｢｣)の中の名前部分だけの方がヒットしやすいので、
# それを検索キーワードに使う(見つからないタイトルはそのままフルタイトルを使う)。
GOODS_BRACKET_NAME_PATTERN = re.compile(r"[「｢]([^」｢]+)[」｣]")


def _goods_search_keyword(category: str, title: str) -> str:
    if category == "pack":
        m = GOODS_BRACKET_NAME_PATTERN.search(title)
        if m:
            return m.group(1)
    return title


# 拡張パックはバラ売りではなくBOX単位で売られていることが多いため、Amazon・楽天では
# 名前+"BOX"で検索する(例: "探偵たちの切札 BOX")方が実物の商品に辿り着きやすい。
# 型番(CT-P01等)や「」は付けない。
def _box_search_keyword(category: str, title: str) -> str:
    if category == "pack":
        name_match = GOODS_BRACKET_NAME_PATTERN.search(title)
        if name_match:
            return f"{name_match.group(1)} BOX"
    return _goods_search_keyword(category, title)


def _takaratomy_mall_search_url(keyword: str) -> str:
    """タカラトミーモールの検索URL。ASP.NET製のこのサイトは検索キーワードを
    UTF-8ではなくShift-JIS(cp932)でパーセントエンコードする。実際にブラウザで
    検索して確認した形式(例: 「コナン」で検索 -> keyword=%83R%83i%83%93)。
    """
    encoded = urllib.parse.quote(keyword.encode("cp932", errors="ignore"))
    return f"https://takaratomymall.jp/shop/goods/search.aspx?search=x&keyword={encoded}&wovn=ja"


def _amazon_search_url(keyword: str) -> str:
    url = f"https://www.amazon.co.jp/s?k={urllib.parse.quote(keyword)}"
    if AMAZON_ASSOCIATE_TAG:
        url += f"&tag={AMAZON_ASSOCIATE_TAG}"
    return url


def _rakuten_search_url(keyword: str) -> str:
    target = f"https://search.rakuten.co.jp/search/mall/{urllib.parse.quote(keyword)}/"
    if RAKUTEN_AFFILIATE_ID:
        return f"https://hb.afl.rakuten.co.jp/hgc/{RAKUTEN_AFFILIATE_ID}/?pc={urllib.parse.quote(target, safe='')}"
    return target


def export_goods(conn) -> list[dict]:
    rows = conn.execute("SELECT * FROM goods ORDER BY release_date ASC, id ASC").fetchall()
    result = []
    for row in rows:
        item = {field: row[field] for field in GOODS_FIELDS}
        ttmall_keyword = _goods_search_keyword(row["category"], row["title"])
        box_keyword = _box_search_keyword(row["category"], row["title"])
        item["ttmall_url"] = _takaratomy_mall_search_url(ttmall_keyword)
        item["amazon_url"] = _amazon_search_url(box_keyword)
        item["rakuten_url"] = _rakuten_search_url(box_keyword)
        result.append(item)
    return result


def export_prices(conn) -> dict[str, list[dict]]:
    # "(平均)"系列は過去の名残でDBに残っている場合があるが、現在のスクレイパーは
    # もう書き込まないし、フロントエンドも表示に使わないため出力からも除外する。
    rows = conn.execute(
        "SELECT card_id, site, price, recorded_at, sample_count FROM price_history "
        "WHERE site NOT LIKE '%(平均)' ORDER BY recorded_at"
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


def _price_points_by_card_site(conn) -> dict[tuple[int, str], list[tuple[str, int]]]:
    """(card_id, site) -> [(recorded_at, price), ...] (日時順、各サイトの最安値系列)。

    サイトごとに独立した時系列として扱う。駿河屋とカードラボのように仕入れ元が
    違えば価格帯そのものが異なるため、サイトをまたいで1本の時系列にすると
    「サイトが入れ替わっただけ」を値上がり/値下がりと誤検出してしまう
    (実際に複数サイト導入時にこれで急上昇/急下降が大量に誤検出された)。
    "(平均)"系列(過去の名残でDBに残っている可能性がある)は対象外にする。
    """
    rows = conn.execute(
        "SELECT card_id, site, price, recorded_at FROM price_history "
        "WHERE site NOT LIKE '%(平均)' ORDER BY card_id, site, recorded_at"
    ).fetchall()

    # 同じ日に手動再実行などで複数回記録された場合、同じ日の重複ポイントが
    # 「直近2時点の変化」に紛れ込んで実際には値動きしていないのに急上昇/急下降と
    # 誤検出することがあるため、(card_id, site, 日付)ごとにその日の最新値だけ残す。
    # rowsはrecorded_at昇順なので、同じ日は後から出てくるものが最新値として上書きされる。
    latest_by_day: dict[tuple[int, str], dict[str, tuple[str, int]]] = defaultdict(dict)
    for row in rows:
        key = (row["card_id"], row["site"])
        day = row["recorded_at"][:10]
        latest_by_day[key][day] = (row["recorded_at"], row["price"])

    by_card_site: dict[tuple[int, str], list[tuple[str, int]]] = {
        key: [days[day] for day in sorted(days)] for key, days in latest_by_day.items()
    }
    return by_card_site


POOLED_SITE_LABEL = "全体"


def _pooled_points_by_card(
    by_card_site: dict[tuple[int, str], list[tuple[str, int]]],
) -> dict[int, list[tuple[str, int]]]:
    """(card_id) -> [(日付, 全サイト単純平均価格), ...]。

    common.jsのpooledAverageSeries()と同じ考え方: 各サイトの最安値系列を日ごとに
    1点にまとめた上で、その日に値がある全サイトを単純平均する(サイトの重み付けはしない)。
    サイト単位ではなく「全体」という1つの仮想サイトとして扱い、trends/moversの
    判定・表示ロジックにそのまま乗せられるようにする。

    新規サイトの参入(または取り扱い終了)でその日の集計対象サイトの顔ぶれが
    変わると、どのサイトの実売価格も動いていないのに平均値だけ動いてしまう
    (例: 元々1サイトだけが扱っていたカードに別サイトが安値で新規参入し、
    平均が急落したように誤検出される)。これを避けるため、最新日のサイト
    構成と一致する連続区間(末尾から遡って同じ顔ぶれが続く範囲)だけを対象にし、
    構成が変わった境目より前の日は切り捨てる。
    """
    by_card_day: dict[int, dict[str, list[int]]] = defaultdict(lambda: defaultdict(list))
    site_set_by_card_day: dict[int, dict[str, set]] = defaultdict(lambda: defaultdict(set))
    for (card_id, site), points in by_card_site.items():
        for recorded_at, price in points:
            day = recorded_at[:10]
            by_card_day[card_id][day].append(price)
            site_set_by_card_day[card_id][day].add(site)

    result: dict[int, list[tuple[str, int]]] = {}
    for card_id, days in by_card_day.items():
        sorted_days = sorted(days)
        latest_set = frozenset(site_set_by_card_day[card_id][sorted_days[-1]])
        cutoff = len(sorted_days) - 1
        for i in range(len(sorted_days) - 2, -1, -1):
            if frozenset(site_set_by_card_day[card_id][sorted_days[i]]) != latest_set:
                break
            cutoff = i
        stable_days = sorted_days[cutoff:]
        result[card_id] = [
            (day, round(sum(days[day]) / len(days[day]))) for day in stable_days
        ]
    return result


def _all_price_series(conn) -> dict[tuple[int, str], list[tuple[str, int]]]:
    """サイトごとの最安値系列に、「全体」(相場・全サイト単純平均)の系列を加えたもの。"""
    by_card_site = _price_points_by_card_site(conn)
    pooled = _pooled_points_by_card(by_card_site)
    combined = dict(by_card_site)
    for card_id, points in pooled.items():
        combined[(card_id, POOLED_SITE_LABEL)] = points
    return combined


def _previous_day_moves(
    by_card_site: dict[tuple[int, str], list[tuple[str, int]]],
) -> tuple[list[dict], list[dict]]:
    """(card_id, site)ごとに、前回の記録と比べて値上がり/値下がりしたものを返す(閾値なし)。

    compute_movers・compute_trends の両方から使う共通ロジック。変化が無い(0%)
    カードはどちらにも含めない。「-」の日(記録が無い日)はそもそも points に
    存在しないので、比較には実際に記録がある直近2点が自動的に使われる。
    """
    up = []
    down = []
    for (card_id, site), points in by_card_site.items():
        if len(points) < 2:
            continue
        prev_date, prev_price = points[-2]
        last_date, last_price = points[-1]
        if prev_price <= 0 or prev_price == last_price:
            continue

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
        if pct > 0:
            up.append(item)
        else:
            down.append(item)
    return up, down


def compute_trends(by_card_site: dict[tuple[int, str], list[tuple[str, int]]]) -> dict[str, list[dict]]:
    """価格が直近上昇/上昇傾向/直近下降/下降傾向にあるカードを判定する。

    - 直近上昇/直近下降: 前回の記録と比べて上がった/下がった(閾値なし)。
      compute_movers の値上がり/値下がりと同じ条件。
    - 上昇傾向/下降傾向: 直近2回の変化が両方とも同じ向き(二連続上昇/二連続下降)の
      もの。変化率の大小は問わない。直近上昇/直近下降と重複しても構わない(除外しない)。

    サイトをまたいだ価格差を値動きと誤認しないよう、サイトごとに独立して判定する
    (詳細は _price_points_by_card_site のdocstring参照)。「全体」(相場)も1つの
    仮想サイトとして同じ扱いで含まれる。

    by_card_site は _all_price_series() の結果を渡す。
    """
    recent_up, recent_down = _previous_day_moves(by_card_site)

    trend_up = []
    trend_down = []
    for (card_id, site), points in by_card_site.items():
        if len(points) < 3:
            continue
        mid_date, mid_price = points[-2]
        last_date, last_price = points[-1]
        prev_price = points[-3][1]
        if prev_price <= 0 or mid_price <= 0:
            continue
        item = {
            "card_id": card_id,
            "site": site,
            "change_pct": round((last_price - mid_price) / mid_price * 100, 1),
            "previous_price": mid_price,
            "previous_date": mid_date,
            "latest_price": last_price,
            "latest_date": last_date,
        }
        if mid_price > prev_price and last_price > mid_price:
            trend_up.append(item)
        elif mid_price < prev_price and last_price < mid_price:
            trend_down.append(item)

    return {
        "recent_up": _sort_limit_per_site(recent_up, TREND_LIMIT, reverse=True),
        "trend_up": _sort_limit_per_site(trend_up, TREND_LIMIT, reverse=True),
        "recent_down": _sort_limit_per_site(recent_down, TREND_LIMIT, reverse=False),
        "trend_down": _sort_limit_per_site(trend_down, TREND_LIMIT, reverse=False),
    }


def _sort_limit_per_site(items: list[dict], limit: int, reverse: bool) -> list[dict]:
    """サイト(「全体」含む)ごとに変化率順でソートし、上位limit件だけ残す。
    全サイトまとめて1つの上位N件にすると、値動きの大きいサイトだけで埋まってしまい、
    タブで切り替えたときに他のサイトがほぼ空になってしまうため、サイトごとに独立して絞り込む。
    """
    by_site: dict[str, list[dict]] = defaultdict(list)
    for item in items:
        by_site[item["site"]].append(item)

    result = []
    for site_items in by_site.values():
        site_items.sort(key=lambda x: x["change_pct"], reverse=reverse)
        result.extend(site_items[:limit])
    return result


def compute_movers(by_card_site: dict[tuple[int, str], list[tuple[str, int]]]) -> dict[str, list[dict]]:
    """前日と比べて、値上がりしたカード/値下がりしたカードを(閾値なしで)全て挙げる。

    サイトをまたいだ価格差を値動きと誤認しないよう、サイトごとに独立して判定する。
    by_card_site は _all_price_series() の結果を渡す(「全体」含む)。
    """
    up, down = _previous_day_moves(by_card_site)
    return {
        "up": _sort_limit_per_site(up, MOVERS_LIMIT, reverse=True),
        "down": _sort_limit_per_site(down, MOVERS_LIMIT, reverse=False),
    }


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

    all_series = _all_price_series(conn)

    trends = compute_trends(all_series)
    with open(OUTPUT_DIR / "trends.json", "w", encoding="utf-8") as f:
        json.dump(trends, f, ensure_ascii=False, separators=(",", ":"))

    movers = compute_movers(all_series)
    with open(OUTPUT_DIR / "movers.json", "w", encoding="utf-8") as f:
        json.dump(movers, f, ensure_ascii=False, separators=(",", ":"))

    goods = export_goods(conn)
    with open(OUTPUT_DIR / "goods.json", "w", encoding="utf-8") as f:
        json.dump(goods, f, ensure_ascii=False, separators=(",", ":"))

    unofficial_cards = export_unofficial_cards(conn)
    with open(OUTPUT_DIR / "unofficial-cards.json", "w", encoding="utf-8") as f:
        json.dump(unofficial_cards, f, ensure_ascii=False, separators=(",", ":"))

    meta = {"generated_at": datetime.now(timezone.utc).isoformat()}
    with open(OUTPUT_DIR / "meta.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, separators=(",", ":"))

    print(f"cards.json: {len(cards)}件")
    print(f"prices.json: {len(prices)}カード分の価格履歴")
    print(
        f"trends.json: 直近上昇{len(trends['recent_up'])}件 / 上昇傾向{len(trends['trend_up'])}件 / "
        f"直近下降{len(trends['recent_down'])}件 / 下降傾向{len(trends['trend_down'])}件"
    )
    print(f"movers.json: 値上がり{len(movers['up'])}件/値下がり{len(movers['down'])}件")
    print(f"goods.json: {len(goods)}件")
    print(f"unofficial-cards.json: {len(unofficial_cards)}件")
    print(f"meta.json: generated_at={meta['generated_at']}")

    conn.close()


if __name__ == "__main__":
    main()
