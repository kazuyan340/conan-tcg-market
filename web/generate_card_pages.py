"""カード1枚ごとに固有のURL(web/site/card/{id}.html)を持つ静的ページを生成する。

これまで全カードがindex.html上のJavaScriptモーダルとしてしか閲覧できず、
検索エンジンから見て「このカード名の情報を載せている固有ページ」が存在
しなかった(index.html 1枚だけがヒットするので、個別カード名+「相場」等の
検索に強く出せなかった)。カードごとに専用のtitle/meta description/OGP/
構造化データを持つ静的HTMLを生成することで、個別カードの検索に直接
ヒットできるようにする。

現在の相場(相場推移セクション)は、common.jsのlatestPriceBySite/
pooledAveragePriceと同じロジックをPythonで再実装し(compute_current_prices)、
ビルド時点の値をHTMLに直接埋め込む(JavaScript実行に依存せず検索エンジンが
読み取れるようにするため)。ページ読み込み後はcard-detail.jsが同じ内容を
common.jsのrenderPriceSection()で上書きし、期間切り替えタブ付きの
インタラクティブなグラフに差し替える(値そのものは一致する)。

サイト内の他ページ(一覧のカードタイル等)は従来どおりクリックでモーダルを
開く挙動のままにし、モーダル内に「詳細ページを見る」リンクを追加して
このページへ内部リンクを張る(検索エンジンのクロール発見・共有用リンクの両方に使う)。
"""
import html
import json
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import db

SITE_BASE_URL = "https://kazuyan340.github.io/conan-tcg-market"
CARD_PAGE_DIR = Path(__file__).parent / "site" / "card"
SITE_DIR = Path(__file__).parent / "site"

ASSET_VERSION = "40"

NAV_LINKS = [
    ("index.html", "📋 一覧"),
    ("trends.html", "📊 価格の動きを見る"),
    ("movers-up.html", "🔺 値上がりを見る"),
    ("movers-down.html", "🔻 値下がりを見る"),
    ("ranking.html", "💰 相場ランキング"),
    ("compare.html", "★ お気に入り"),
    ("deck.html", "🃏 デッキ作成"),
    ("goods.html", "🛍️ グッズ"),
]

STATIC_PAGES = [
    "index.html", "trends.html", "movers-up.html", "movers-down.html",
    "ranking.html", "compare.html", "deck.html", "goods.html",
    "about.html", "privacy.html",
]

CLARITY_SNIPPET = """<!-- Microsoft Clarity -->
<script type="text/javascript">
    (function(c,l,a,r,i,t,y){
        c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
        t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
        y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
    })(window, document, "clarity", "script", "y2m2613qg8");
</script>"""


def _e(value) -> str:
    """None/数値も含めて安全にHTMLエスケープする。"""
    if value is None:
        return ""
    return html.escape(str(value), quote=True)


def _base_site_name(site: str) -> str:
    suffix = "(平均)"
    return site[: -len(suffix)] if site.endswith(suffix) else site


def _site_latest_day(conn) -> dict[str, str]:
    """サイトごとの直近取得日(YYYY-MM-DD)。common.jsのcomputeSiteLatestDayに対応する。"""
    rows = conn.execute(
        "SELECT site, recorded_at FROM price_history WHERE site NOT LIKE '%(平均)'"
    ).fetchall()
    latest: dict[str, str] = {}
    for row in rows:
        site = _base_site_name(row["site"])
        day = row["recorded_at"][:10]
        if site not in latest or day > latest[site]:
            latest[site] = day
    return latest


def compute_current_prices(conn) -> dict[int, dict]:
    """card_id -> {"pooled_avg": int|None, "by_site": {site: {"price", "recorded_at"}}}

    common.jsのlatestPriceBySite()・pooledAveragePrice()と同じロジック
    (そのサイト自身の直近取得日に記録が無ければ、売り切れ等で対象から除外する)。
    """
    site_latest_day = _site_latest_day(conn)
    rows = conn.execute(
        "SELECT card_id, site, price, recorded_at FROM price_history "
        "WHERE site NOT LIKE '%(平均)' ORDER BY card_id, recorded_at"
    ).fetchall()

    latest_by_card_site: dict[int, dict[str, dict]] = defaultdict(dict)
    for row in rows:
        site = _base_site_name(row["site"])
        existing = latest_by_card_site[row["card_id"]].get(site)
        if not existing or row["recorded_at"] > existing["recorded_at"]:
            latest_by_card_site[row["card_id"]][site] = {
                "price": row["price"], "recorded_at": row["recorded_at"],
            }

    result: dict[int, dict] = {}
    for card_id, by_site in latest_by_card_site.items():
        kept = {
            site: v for site, v in by_site.items()
            if site_latest_day.get(site) and v["recorded_at"][:10] == site_latest_day[site]
        }
        prices = [v["price"] for v in kept.values()]
        pooled_avg = round(sum(prices) / len(prices)) if prices else None
        result[card_id] = {"pooled_avg": pooled_avg, "by_site": kept}
    return result


def _nav_links_html() -> str:
    # <base href="../">を使ってサイトルート基準に統一しているため、ここでは
    # "../"を付けずサイトルートからの相対パスのままでよい。
    items = []
    for href, label in NAV_LINKS:
        items.append(f'<a href="{href}" class="reset-btn nav-btn">{label}</a>')
    return "\n      ".join(items)


def _difficulty_text(card: dict) -> str:
    parts = []
    if card["difficulty_first"] is not None:
        parts.append(f"先攻{card['difficulty_first']}")
    if card["difficulty_second"] is not None:
        parts.append(f"後攻{card['difficulty_second']}")
    return " ".join(parts)


def _static_price_stats_html(current: dict) -> str:
    avg = current["pooled_avg"]
    if avg is None:
        return ""
    prices = [v["price"] for v in current["by_site"].values()]
    range_html = ""
    if len(prices) > 1:
        range_html = f'<span class="price-avg-range">(最安 {min(prices)}円 〜 {max(prices)}円)</span>'
    return f'<div class="price-avg-highlight">相場 <span class="price-avg-value">{avg}円</span>{range_html}</div>'


def _static_price_table_html(current: dict) -> str:
    by_site = current["by_site"]
    if not by_site:
        return ""
    entries = sorted(by_site.items(), key=lambda kv: kv[1]["price"])
    rows = []
    for i, (site, v) in enumerate(entries):
        crown = "🏆" if i == 0 else ""
        rows.append(f"<tr><td>{_e(site)}{crown}</td><td>{v['price']}円</td></tr>")
    return (
        '<table class="price-site-table"><thead><tr><th>サイト</th><th>最安値</th></tr></thead>'
        f"<tbody>{''.join(rows)}</tbody></table>"
    )


def _meta_description(card: dict, current: dict) -> str:
    parts = [f"{card['name']}"]
    if card.get("rarity"):
        parts.append(f"({card['rarity']})")
    parts.append("の相場・価格情報。")
    if current["pooled_avg"] is not None:
        parts.append(f"現在の相場は{current['pooled_avg']}円です。")
    parts.append("駿河屋・カードラボ・竜のしっぽ等、複数の販売サイトの価格をまとめて比較できます。")
    return "".join(parts)


def _card_page_html(card: dict, current: dict) -> str:
    title = f"{card['name']}({card['rarity'] or '?'}) 相場・価格情報 | 名探偵コナンTCG カード図鑑"
    description = _meta_description(card, current)
    page_url = f"{SITE_BASE_URL}/card/{card['id']}.html"
    image_url = card.get("image_url") or ""

    fields = [
        ("カードID", card.get("card_id")),
        ("カード番号", card.get("card_num")),
        ("種類", card.get("card_type")),
        ("色", card.get("color")),
        ("レアリティ", card.get("rarity")),
        ("特徴", card.get("category")),
        ("レベル", card.get("level")),
        ("AP", card.get("ap")),
        ("LP", card.get("lp")),
        ("事件レベル", _difficulty_text(card)),
        ("収録パック", card.get("pack")),
        ("イラストレーター", card.get("illustrator")),
    ]
    fields_html = "\n".join(
        f'<div class="field"><span class="label">{_e(label)}:</span><span>{_e(value)}</span></div>'
        for label, value in fields
        if value not in (None, "", 0) or (label in ("レベル", "AP", "LP") and value == 0)
    )

    ability_parts = [card.get(k) for k in ("ability_text", "hirameki", "cut_in", "henso") if card.get(k)]
    ability_html = _e("\n\n".join(ability_parts)) if ability_parts else "(なし)"

    flavor_html = ""
    if card.get("flavor_text"):
        flavor_html = f'<div class="field" style="margin-top:6px"><span>{_e(card["flavor_text"])}</span></div>'

    price_stats_static = _static_price_stats_html(current)
    price_table_static = _static_price_table_html(current)
    price_empty_hidden = "hidden" if current["pooled_avg"] is not None else ""

    ld_json = {
        "@context": "https://schema.org",
        "@type": "Product",
        "name": card["name"],
        "image": image_url,
        "description": description,
        "url": page_url,
    }
    if current["pooled_avg"] is not None:
        ld_json["offers"] = {
            "@type": "AggregateOffer",
            "priceCurrency": "JPY",
            "lowPrice": min(v["price"] for v in current["by_site"].values()),
            "highPrice": max(v["price"] for v in current["by_site"].values()),
            "offerCount": len(current["by_site"]),
        }

    return f"""<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<!-- card/配下のページはサイトルート基準の相対パス(data/cards.json等)をそのまま
     使えるよう<base>でルートを指定する(トップレベルの他ページと同じ書き方の
     まま、このディレクトリの1つ下からでも正しく解決される)。 -->
<base href="../">
{CLARITY_SNIPPET}
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="description" content="{_e(description)}">
<link rel="canonical" href="{page_url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="名探偵コナンTCG カード図鑑">
<meta property="og:locale" content="ja_JP">
<meta property="og:url" content="{page_url}">
<meta property="og:title" content="{_e(title)}">
<meta property="og:description" content="{_e(description)}">
<meta property="og:image" content="{_e(image_url)}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="{_e(title)}">
<meta name="twitter:description" content="{_e(description)}">
<meta name="twitter:image" content="{_e(image_url)}">
<title>{_e(title)}</title>
<link rel="stylesheet" href="style.css?v={ASSET_VERSION}">
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-9080305842487680" crossorigin="anonymous"></script>
<script type="application/ld+json">{json.dumps(ld_json, ensure_ascii=False)}</script>
</head>
<body>
<header class="toolbar">
  <div class="title-row">
    <div class="title-block">
      <h1>{_e(card['name'])}</h1>
      <p id="last-updated" class="last-updated"></p>
    </div>
    <div class="nav-links">
      {_nav_links_html()}
    </div>
    <button type="button" class="nav-menu-toggle" aria-label="メニュー" aria-expanded="false">☰</button>
  </div>
</header>

<main class="card-detail-page">
  <div class="modal-card card-detail-card">
    <div class="modal-body">
      <div class="modal-image">
        <img src="{_e(image_url)}" alt="{_e(card['name'])}">
      </div>
      <div class="modal-info">
        {fields_html}
        <div class="ability">{ability_html}</div>
        {flavor_html}
      </div>
    </div>

    <div class="modal-price-section">
      <h3>相場推移</h3>
      <div id="modal-price-stats" class="price-stats">{price_stats_static}</div>
      <div class="price-detail-row">
        <div id="modal-price-table" class="price-table-col">{price_table_static}</div>
        <div class="price-chart-col">
          <div class="period-tabs hidden" id="period-tabs">
            <button type="button" class="period-tab" data-days="0">全期間</button>
            <button type="button" class="period-tab active" data-days="7">7日</button>
            <button type="button" class="period-tab" data-days="30">30日</button>
          </div>
          <canvas id="price-chart" width="420" height="260" class="hidden"></canvas>
        </div>
      </div>
      <p id="price-empty" class="price-empty {price_empty_hidden}">価格データがありません。</p>
    </div>
  </div>

  <p class="card-detail-back"><a href="index.html">← カード一覧へ戻る</a></p>
</main>

<footer class="site-disclaimer">
  <p>価格情報は当サイト調べです。実際の価格・在庫状況と差異が生じる場合があります。掲載しているカード画像は名探偵コナンTCG公式サイトの画像を参照しています。</p>
  <p><a href="about.html">運営者情報</a>　<a href="privacy.html">プライバシーポリシー・お問い合わせ</a></p>
</footer>

<script>window.CARD_DETAIL_ID = {card['id']};</script>
<script src="common.js?v={ASSET_VERSION}"></script>
<script src="card-detail.js?v={ASSET_VERSION}"></script>
</body>
</html>
"""


def generate_card_pages(conn, cards: list[dict]) -> int:
    CARD_PAGE_DIR.mkdir(parents=True, exist_ok=True)
    current_prices = compute_current_prices(conn)
    for card in cards:
        current = current_prices.get(card["id"], {"pooled_avg": None, "by_site": {}})
        html_text = _card_page_html(card, current)
        (CARD_PAGE_DIR / f"{card['id']}.html").write_text(html_text, encoding="utf-8")
    return len(cards)


def generate_sitemap(cards: list[dict]) -> None:
    urls = [f"{SITE_BASE_URL}/{page}" for page in STATIC_PAGES]
    urls += [f"{SITE_BASE_URL}/card/{card['id']}.html" for card in cards]
    body = "\n".join(f"  <url><loc>{u}</loc></url>" for u in urls)
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        f"{body}\n"
        "</urlset>\n"
    )
    (SITE_DIR / "sitemap.xml").write_text(xml, encoding="utf-8")


def main():
    conn = db.get_connection()
    db.init_db(conn)
    cards = [dict(row) for row in db.search_cards(conn)]
    count = generate_card_pages(conn, cards)
    generate_sitemap(cards)
    print(f"card pages: {count}件 -> {CARD_PAGE_DIR}")
    print(f"sitemap.xml: {len(STATIC_PAGES) + len(cards)}件のURL")
    conn.close()


if __name__ == "__main__":
    main()
