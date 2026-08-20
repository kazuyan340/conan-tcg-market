// 公式サイトのカード一覧APIに載っていないカード(ショップの商品一覧から逆輸入した
// もの)だけを一覧表示する管理用ページ。data/unofficial-cards.json (通常のcards.json
// とは別出力、data_source列を含むフル情報)を読み込む。

async function init() {
  const [cardsRes, pricesRes, unresolvedRes] = await Promise.all([
    fetchFresh("data/unofficial-cards.json"),
    fetchFresh("data/prices.json"),
    fetchFresh("data/unresolved-shop-items.json"),
  ]);
  const cards = await cardsRes.json();
  commonPrices = await pricesRes.json();
  siteLatestDay = computeSiteLatestDay(commonPrices);

  bindModalEvents();
  renderLastUpdated();
  render(cards);

  const unresolved = await unresolvedRes.json();
  renderUnresolved(unresolved);
}

function render(cards) {
  const grid = document.getElementById("card-grid");
  grid.innerHTML = "";
  document.getElementById("result-count").textContent = `${cards.length}件`;

  for (const card of cards) {
    const tile = createCardTile(card);

    const badge = document.createElement("div");
    badge.className = "admin-source-badge";
    badge.textContent = card.data_source || "";
    tile.appendChild(badge);

    grid.appendChild(tile);
  }
}

// 価格を「1,234円」または(複数件あれば)「1,234円〜5,678円」の形にする。
function formatPriceRange(prices) {
  if (!prices || prices.length === 0) return "価格不明";
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return min === max ? `${min.toLocaleString()}円` : `${min.toLocaleString()}円〜${max.toLocaleString()}円`;
}

// item.site(出品元)ごとに、data/*.jsonへの書き出し順(=元の監査順)を保った
// まま束ねる。Map挿入順は最初に出てきたサイトの順序で保たれる。
function groupBySite(items) {
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.site)) groups.set(item.site, []);
    groups.get(item.site).push(item);
  }
  return groups;
}

// サイト名 -> そのショップでitemを検索するURLを作る関数。common.jsの
// SITE_LINK_BUILDERSと同じ関数を再利用する(通常の価格比較表のリンクと同じ仕組み)。
// カード名で検索するサイト(トレカバース/わいTV/メルカード)はitem.product_name
// (商品名からレアリティ等より前の部分を機械的に切り出したもの、無ければraw_key)を使う。
const UNRESOLVED_SEARCH_URL_BUILDERS = {
  "トレカバース": (item) => torecabirthSearchUrl(item.product_name || item.raw_key, item.rarity, item.raw_key),
  "わいTV": (item) => waitvSearchUrl(item.product_name || item.raw_key, item.rarity, item.raw_key),
  "メルカード": (item) => mercardSearchUrl(item.product_name || item.raw_key, item.rarity, item.raw_key),
  "カードラボ": (item) => cardLaboSearchUrl(item.raw_key),
  "竜のしっぽ": (item) => ryuunoshippoSearchUrl(item.raw_key),
  "フルアヘッド": (item) => fullaheadSearchUrl(item.raw_key),
  "まんぞく屋": (item) => manzokuyaSearchUrl(item.raw_key),
  "駿河屋": (item) => surugaAffiliateUrl(item.raw_key),
};

function searchUrlFor(item) {
  const builder = UNRESOLVED_SEARCH_URL_BUILDERS[item.site];
  return builder ? builder(item) : null;
}

// 1件分の行を作る。①②共通(候補リストの有無だけが違う)。ショップの実際の商品画像を
// サムネイルにして、画像・タイトルどちらをクリックしてもそのショップの検索結果
// (該当する2枚・3枚が並んだ状態)を新しいタブで開く。card-tileやモーダルは使わない
// (ここは「どれとどれが区別できていないか」を確認するための一覧であって、カード
// 詳細を見るための一覧ではないため)。
function renderUnresolvedRow(item) {
  const url = searchUrlFor(item);
  const row = document.createElement("div");
  row.className = "unresolved-row";

  const thumbLink = document.createElement("a");
  thumbLink.className = "unresolved-thumb";
  if (url) {
    thumbLink.href = url;
    thumbLink.target = "_blank";
    thumbLink.rel = "noopener";
  }
  if (item.image_url) {
    const img = document.createElement("img");
    img.src = item.image_url;
    img.alt = "";
    img.loading = "lazy";
    thumbLink.appendChild(img);
  } else {
    thumbLink.classList.add("unresolved-thumb-empty");
    thumbLink.textContent = "🔍";
  }
  row.appendChild(thumbLink);

  const info = document.createElement("div");
  info.className = "unresolved-row-info";

  const listingNote = item.listing_count > 1 ? `(${item.listing_count}件の出品)` : "";
  const titleText = item.product_name || item.raw_key;
  const titleHtml = url
    ? `<a href="${url}" target="_blank" rel="noopener">${escapeHtml(titleText)}</a>`
    : escapeHtml(titleText);
  info.innerHTML = `<div class="unresolved-row-title">
      ${titleHtml}
      <code>${escapeHtml(item.raw_key)}</code>${item.rarity ? ` <span class="unresolved-rarity">${escapeHtml(item.rarity)}</span>` : ""}
      <span class="unresolved-price">${escapeHtml(formatPriceRange(item.prices))}${listingNote}</span>
    </div>`;

  if (item.candidates && item.candidates.length > 0) {
    const cand = document.createElement("div");
    cand.className = "unresolved-candidates";
    cand.textContent = `区別できていない候補: ${item.candidates.map((c) => `${c.card_num}(${c.name})`).join(" / ")}`;
    info.appendChild(cand);
  }
  if (item.hint) {
    const hint = document.createElement("div");
    hint.className = "unresolved-hint";
    hint.textContent = item.hint;
    info.appendChild(hint);
  }

  row.appendChild(info);
  return row;
}

// ①②共通のサイトごと見出し+行リストを作る。
function renderUnresolvedGroup(containerId, countId, items) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";
  document.getElementById(countId).textContent = `${items.length}件`;

  for (const [site, siteItems] of groupBySite(items)) {
    const siteHeading = document.createElement("h4");
    siteHeading.className = "unresolved-site-heading";
    siteHeading.textContent = `${site}(${siteItems.length}件)`;
    container.appendChild(siteHeading);

    for (const item of siteItems) {
      container.appendChild(renderUnresolvedRow(item));
    }
  }
}

function renderUnresolved(data) {
  renderUnresolvedGroup("ambiguous-list", "ambiguous-count", data.ambiguous || []);
  renderUnresolvedGroup("missing-list", "missing-count", data.missing || []);
}

init();
