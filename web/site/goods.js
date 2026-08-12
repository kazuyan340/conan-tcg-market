// グッズページ: 拡張パック/構築済みデッキ/その他グッズを goods.json から読み込み、
// カテゴリごとに3セクションへ振り分けて表示する。各商品にタカラトミーモール/
// Amazon/楽天市場の検索リンクを添える(検索URLはexport_static.pyで組み立て済み)。
const CATEGORY_TO_GRID = {
  pack: "goods-grid-pack",
  deck: "goods-grid-deck",
};

function goodsTileHtml(item) {
  const metaParts = [];
  if (item.price_text) metaParts.push(item.price_text);
  if (item.release_date) metaParts.push(`発売日: ${item.release_date}`);

  return `
    <div class="goods-tile">
      <img src="${item.image_url || ""}" alt="${escapeHtml(item.title)}" loading="lazy">
      <div class="goods-title">${escapeHtml(item.title)}</div>
      <div class="goods-meta">${escapeHtml(metaParts.join(" ・ "))}</div>
      <div class="goods-links">
        <a href="${item.ttmall_url}" target="_blank" rel="nofollow noopener sponsored" class="goods-link ttmall">タカラトミーモールで探す</a>
        <a href="${item.amazon_url}" target="_blank" rel="nofollow noopener sponsored" class="goods-link amazon">Amazonで探す <span class="pr-label">PR</span></a>
        <a href="${item.rakuten_url}" target="_blank" rel="nofollow noopener sponsored" class="goods-link rakuten">楽天市場で探す <span class="pr-label">PR</span></a>
      </div>
    </div>
  `;
}

function renderGoodsGrid(gridId, emptyId, items) {
  const grid = document.getElementById(gridId);
  const emptyMessage = document.getElementById(emptyId);
  if (!items || items.length === 0) {
    grid.innerHTML = "";
    emptyMessage.classList.remove("hidden");
    return;
  }
  emptyMessage.classList.add("hidden");
  grid.innerHTML = items.map(goodsTileHtml).join("");
}

async function init() {
  const goods = await fetchFresh("data/goods.json").then((r) => r.json());

  const byGrid = { "goods-grid-pack": [], "goods-grid-deck": [], "goods-grid-other": [] };
  for (const item of goods) {
    const gridId = CATEGORY_TO_GRID[item.category] || "goods-grid-other";
    byGrid[gridId].push(item);
  }

  renderGoodsGrid("goods-grid-pack", "goods-empty-pack", byGrid["goods-grid-pack"]);
  renderGoodsGrid("goods-grid-deck", "goods-empty-deck", byGrid["goods-grid-deck"]);
  renderGoodsGrid("goods-grid-other", "goods-empty-other", byGrid["goods-grid-other"]);

  renderLastUpdated();
  bindNavMenuToggle();
}

init();
