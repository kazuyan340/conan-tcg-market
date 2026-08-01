// 「価格の動き」「値上がり」「値下がり」の3ビューを1ページにまとめ、
// ヘッダーのボタンを押すたびに 値上がり → 値下がり → 価格の動き → (繰り返し) と切り替える。
const VIEWS = [
  { id: "view-trends", title: "📊 価格の動き", nextLabel: "🔺 値上がりを見る" },
  { id: "view-up", title: "🔺 値上がりしたカード", nextLabel: "🔻 値下がりを見る" },
  { id: "view-down", title: "🔻 値下がりしたカード", nextLabel: "📊 価格の動きを見る" },
];
let currentView = 0;

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

async function init() {
  const [allCards, trendsRes, moversRes] = await Promise.all([
    loadCardData(),
    fetch("data/trends.json").then((r) => r.json()),
    fetch("data/movers.json").then((r) => r.json()),
  ]);
  const cardById = new Map(allCards.map((c) => [c.id, c]));

  bindModalEvents();

  document.getElementById("cycle-btn").addEventListener("click", () => {
    showView((currentView + 1) % VIEWS.length);
  });
  showView(viewIndexFromUrl());
  renderLastUpdated();

  renderTrendGrid("spike-grid", "spike-empty", trendsRes.spike, cardById, (item) => [
    `+${item.change_pct}%`,
    `${item.previous_price}円 → ${item.latest_price}円`,
  ], "up");
  renderTrendGrid("gradual-grid", "gradual-empty", trendsRes.gradual, cardById, (item) => [
    `+${item.change_pct}%`,
    `${item.first_price}円 → ${item.latest_price}円 (${item.points}回分)`,
  ], "up");
  renderTrendGrid("crash-grid", "crash-empty", trendsRes.crash, cardById, (item) => [
    `${item.change_pct}%`,
    `${item.previous_price}円 → ${item.latest_price}円`,
  ], "down");
  renderTrendGrid("gradual-down-grid", "gradual-down-empty", trendsRes.gradual_down, cardById, (item) => [
    `${item.change_pct}%`,
    `${item.first_price}円 → ${item.latest_price}円 (${item.points}回分)`,
  ], "down");

  renderMoverGrid("mover-grid-up", "mover-empty-up", moversRes.up, cardById, "up");
  renderMoverGrid("mover-grid-down", "mover-empty-down", moversRes.down, cardById, "down");
}

// サイトをまたいだ価格差を混同しないよう判定自体はサイト単位で行っているため(export_static.py参照)、
// 表示側も見やすいようサイトごとに小見出しを立てて分ける。
function groupBySite(items) {
  const groups = new Map();
  for (const item of items) {
    const site = item.site || "";
    if (!groups.has(site)) groups.set(site, []);
    groups.get(site).push(item);
  }
  return groups;
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

function renderTrendGrid(gridId, emptyId, items, cardById, badgeLinesFn, badgeClass = "") {
  const grid = document.getElementById(gridId);
  const emptyMessage = document.getElementById(emptyId);
  grid.innerHTML = "";

  if (!items || items.length === 0) {
    emptyMessage.classList.remove("hidden");
    return;
  }
  emptyMessage.classList.add("hidden");

  for (const [site, siteItems] of groupBySite(items)) {
    const heading = document.createElement("h4");
    heading.className = "site-heading";
    heading.textContent = site;
    grid.appendChild(heading);

    for (const item of siteItems) {
      const card = cardById.get(item.card_id);
      if (!card) continue;
      appendCardTile(grid, item, card, badgeLinesFn, badgeClass);
    }
  }
}

function renderMoverGrid(gridId, emptyId, items, cardById, direction) {
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
    `平均${item.average_price}円 → ${item.latest_price}円`,
  ];

  for (const [site, siteItems] of groupBySite(items)) {
    const heading = document.createElement("h4");
    heading.className = "site-heading";
    heading.textContent = site;
    grid.appendChild(heading);

    for (const item of siteItems) {
      const card = cardById.get(item.card_id);
      if (!card) continue;
      appendCardTile(grid, item, card, badgeLinesFn, direction);
    }
  }
}

init();
