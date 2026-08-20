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

// ①候補は絞れたが1枚に特定できないカード: サイトごとに見出しを分け、その下に
// ショップの出品情報(手がかり)を見出しにして、DB上の候補カードをcreateCardTileで
// そのまま並べる(クリックで通常の価格モーダルが開ける)。
function renderAmbiguousList(items) {
  const container = document.getElementById("ambiguous-list");
  container.innerHTML = "";
  document.getElementById("ambiguous-count").textContent = `${items.length}件`;

  for (const [site, siteItems] of groupBySite(items)) {
    const siteHeading = document.createElement("h4");
    siteHeading.className = "unresolved-site-heading";
    siteHeading.textContent = `${site}(${siteItems.length}件)`;
    container.appendChild(siteHeading);

    for (const item of siteItems) {
      const group = document.createElement("div");
      group.className = "unresolved-group";

      const header = document.createElement("div");
      header.className = "unresolved-group-header";
      const listingNote = item.listing_count > 1 ? `(${item.listing_count}件の出品)` : "";
      header.innerHTML = `手がかり: <code>${escapeHtml(item.raw_key)}</code>${item.rarity ? ` / ${escapeHtml(item.rarity)}` : ""}
        / ${escapeHtml(formatPriceRange(item.prices))}${listingNote}
        ${item.hint ? `<span class="unresolved-hint">${escapeHtml(item.hint)}</span>` : ""}`;
      group.appendChild(header);

      const candidateGrid = document.createElement("div");
      candidateGrid.className = "card-grid unresolved-candidate-grid";
      for (const card of item.candidates) {
        candidateGrid.appendChild(createCardTile(card));
      }
      group.appendChild(candidateGrid);

      container.appendChild(group);
    }
  }
}

// ②自分のカードDBに全く見当たらないカード: サイトごとに表を分ける(画像が無いので表形式)。
function renderMissingList(items) {
  const container = document.getElementById("missing-list");
  document.getElementById("missing-count").textContent = `${items.length}件`;
  container.innerHTML = "";

  for (const [site, siteItems] of groupBySite(items)) {
    const siteHeading = document.createElement("h4");
    siteHeading.className = "unresolved-site-heading";
    siteHeading.textContent = `${site}(${siteItems.length}件)`;
    container.appendChild(siteHeading);

    const rows = siteItems
      .map((item) => {
        const listingNote = item.listing_count > 1 ? `(${item.listing_count}件の出品)` : "";
        return `<tr>
          <td><code>${escapeHtml(item.raw_key)}</code></td>
          <td>${escapeHtml(item.rarity || "")}</td>
          <td>${escapeHtml(formatPriceRange(item.prices))}${listingNote}</td>
          <td class="unresolved-hint">${escapeHtml(item.hint || "")}</td>
        </tr>`;
      })
      .join("");

    const table = document.createElement("table");
    table.className = "unresolved-missing-table";
    table.innerHTML = `<thead><tr><th>手がかり</th><th>レアリティ</th><th>価格</th><th>備考</th></tr></thead>
      <tbody>${rows}</tbody>`;
    container.appendChild(table);
  }
}

function renderUnresolved(data) {
  renderAmbiguousList(data.ambiguous || []);
  renderMissingList(data.missing || []);
}

init();
