// 公式サイトのカード一覧APIに載っていないカード(ショップの商品一覧から逆輸入した
// もの)だけを一覧表示する管理用ページ。data/unofficial-cards.json (通常のcards.json
// とは別出力、data_source列を含むフル情報)を読み込む。

async function init() {
  const [cardsRes, pricesRes] = await Promise.all([
    fetchFresh("data/unofficial-cards.json"),
    fetchFresh("data/prices.json"),
  ]);
  const cards = await cardsRes.json();
  commonPrices = await pricesRes.json();
  siteLatestDay = computeSiteLatestDay(commonPrices);

  bindModalEvents();
  renderLastUpdated();
  render(cards);
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

init();
