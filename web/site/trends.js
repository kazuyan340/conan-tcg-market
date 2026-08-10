// 「価格の動き」「値上がり」「値下がり」の3ビューを1ページにまとめ、
// ヘッダーのボタンを押すたびに 値上がり → 値下がり → 価格の動き → (繰り返し) と切り替える。
// さらに上部のサイトタブ(全体/駿河屋/カードラボ/竜のしっぽ/メルカード/フルアヘッド)で、どのサイト基準の
// 値動きを見るかを選べる(「全体」は各サイト最安値を単純平均した「相場」の日次推移が基準)。
const VIEWS = [
  { id: "view-trends", title: "📊 価格の動き", nextLabel: "🔺 値上がりを見る" },
  { id: "view-up", title: "🔺 値上がりしたカード", nextLabel: "🔻 値下がりを見る" },
  { id: "view-down", title: "🔻 値下がりしたカード", nextLabel: "📊 価格の動きを見る" },
];
const SITES = ["全体", "駿河屋", "カードラボ", "竜のしっぽ", "メルカード", "フルアヘッド"];
let currentView = 0;
let selectedSite = SITES[0];

let trendsRes = {};
let moversRes = {};
let cardById = new Map();

// URLの ?view=up|down|trends で直接そのビューを開けるようにする(一覧画面からのワンクリック導線用)。
function viewIndexFromUrl() {
  const requested = new URLSearchParams(location.search).get("view");
  const index = VIEWS.findIndex((v) => v.id === `view-${requested}`);
  return index === -1 ? 0 : index;
}

function showView(index) {
  for (const v of VIEWS) {
    document.getElementById(v.id).classList.add("hidden");
  }
  document.getElementById(VIEWS[index].id).classList.remove("hidden");
  document.getElementById("page-title").textContent = VIEWS[index].title;
  document.getElementById("cycle-btn").textContent = VIEWS[index].nextLabel;
  currentView = index;
  window.scrollTo({ top: 0 });
}

function renderSiteTabs() {
  const container = document.getElementById("site-tabs");
  container.innerHTML = "";
  for (const site of SITES) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "site-tab" + (site === selectedSite ? " active" : "");
    btn.textContent = site;
    btn.addEventListener("click", () => {
      selectedSite = site;
      renderSiteTabs();
      renderAll();
    });
    container.appendChild(btn);
  }
}

async function init() {
  const [allCards, trendsData, moversData] = await Promise.all([
    loadCardData(),
    fetch("data/trends.json").then((r) => r.json()),
    fetch("data/movers.json").then((r) => r.json()),
  ]);
  cardById = new Map(allCards.map((c) => [c.id, c]));
  trendsRes = trendsData;
  moversRes = moversData;

  bindModalEvents();
  bindNavMenuToggle();

  document.getElementById("cycle-btn").addEventListener("click", () => {
    showView((currentView + 1) % VIEWS.length);
  });
  showView(viewIndexFromUrl());
  renderSiteTabs();
  renderAll();
  renderLastUpdated();
}

function bySite(items, site) {
  return (items || []).filter((item) => item.site === site);
}

function trendBadgeLines(item) {
  const sign = item.change_pct > 0 ? "+" : "";
  return [`${sign}${item.change_pct}%`, `${item.previous_price}円 → ${item.latest_price}円`];
}

function renderAll() {
  renderTrendGrid("recent-up-grid", "recent-up-empty", bySite(trendsRes.recent_up, selectedSite), trendBadgeLines, "up");
  renderTrendGrid("trend-up-grid", "trend-up-empty", bySite(trendsRes.trend_up, selectedSite), trendBadgeLines, "up");
  renderTrendGrid("recent-down-grid", "recent-down-empty", bySite(trendsRes.recent_down, selectedSite), trendBadgeLines, "down");
  renderTrendGrid("trend-down-grid", "trend-down-empty", bySite(trendsRes.trend_down, selectedSite), trendBadgeLines, "down");

  renderMoverGrid("mover-grid-up", "mover-empty-up", bySite(moversRes.up, selectedSite), "up");
  renderMoverGrid("mover-grid-down", "mover-empty-down", bySite(moversRes.down, selectedSite), "down");
}

function appendCardTile(grid, item, card, badgeLinesFn, badgeClass) {
  const badgeHtml = badgeLinesFn(item).map((line) => escapeHtml(line)).join("<br>");

  const tile = document.createElement("div");
  tile.className = "card-tile";
  tile.innerHTML = `
    <div class="trend-badge ${badgeClass}">${badgeHtml}</div>
    <img src="${card.image_url || ""}" alt="${escapeHtml(card.name)}" loading="lazy">
    <div class="name">${escapeHtml(card.name)}</div>
    <div class="sub">${escapeHtml(card.rarity || "")} / ${escapeHtml(card.color || "")}</div>
  `;
  tile.addEventListener("click", () => openModal(card));
  grid.appendChild(tile);
}

function renderTrendGrid(gridId, emptyId, items, badgeLinesFn, badgeClass = "") {
  const grid = document.getElementById(gridId);
  const emptyMessage = document.getElementById(emptyId);
  grid.innerHTML = "";

  if (!items || items.length === 0) {
    emptyMessage.classList.remove("hidden");
    return;
  }
  emptyMessage.classList.add("hidden");

  for (const item of items) {
    const card = cardById.get(item.card_id);
    if (!card) continue;
    appendCardTile(grid, item, card, badgeLinesFn, badgeClass);
  }
}

function renderMoverGrid(gridId, emptyId, items, direction) {
  const grid = document.getElementById(gridId);
  const emptyMessage = document.getElementById(emptyId);
  grid.innerHTML = "";

  if (!items || items.length === 0) {
    emptyMessage.classList.remove("hidden");
    return;
  }
  emptyMessage.classList.add("hidden");

  const badgeLinesFn = (item) => [
    `${item.change_pct > 0 ? "+" : ""}${item.change_pct}%`,
    `${item.previous_price}円 → ${item.latest_price}円`,
  ];

  for (const item of items) {
    const card = cardById.get(item.card_id);
    if (!card) continue;
    appendCardTile(grid, item, card, badgeLinesFn, direction);
  }
}

init();
