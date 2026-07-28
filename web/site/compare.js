let checkedCards = [];

async function init() {
  const allCards = await loadCardData();
  const ids = loadFavorites();
  checkedCards = allCards.filter((c) => ids.has(c.id));

  document.getElementById("clear-compare").addEventListener("click", () => {
    for (const card of [...checkedCards]) {
      toggleFavorite(card.id);
    }
    checkedCards = [];
    render();
  });

  bindModalEvents();
  render();
  renderLastUpdated();
}

function removeCard(cardId) {
  toggleFavorite(cardId);
  checkedCards = checkedCards.filter((c) => c.id !== cardId);
  render();
}

function priceStatsHtml(cardId) {
  const history = commonPrices[String(cardId)] || [];
  if (history.length === 0) return "価格データがありません";
  return buildPriceStatsHtml(history);
}

function render() {
  const grid = document.getElementById("price-check-grid");
  const emptyMessage = document.getElementById("empty-message");
  grid.innerHTML = "";

  if (checkedCards.length === 0) {
    emptyMessage.classList.remove("hidden");
    return;
  }
  emptyMessage.classList.add("hidden");

  for (const card of checkedCards) {
    const box = document.createElement("div");
    box.className = "price-check-card";

    const header = document.createElement("div");
    header.className = "price-check-header";

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "compare-remove";
    removeBtn.textContent = "✕";
    removeBtn.title = "外す";
    removeBtn.addEventListener("click", () => removeCard(card.id));

    const img = document.createElement("img");
    img.src = card.image_url || "";
    img.alt = card.name;
    img.addEventListener("click", () => openModal(card));

    const info = document.createElement("div");
    info.className = "price-check-info";
    info.innerHTML = `
      <div class="name">${escapeHtml(card.name)}</div>
      <div class="sub">${escapeHtml(card.rarity || "")} / ${escapeHtml(card.color || "")} / ${escapeHtml(card.card_num || "")}</div>
    `;
    info.querySelector(".name").addEventListener("click", () => openModal(card));

    header.append(removeBtn, img, info);

    const stats = document.createElement("div");
    stats.className = "price-stats";
    stats.innerHTML = priceStatsHtml(card.id);

    const canvas = document.createElement("canvas");
    canvas.width = 560;
    canvas.height = 180;
    canvas.className = "price-check-canvas";

    const history = commonPrices[String(card.id)] || [];
    if (history.length > 0) {
      drawPriceChart(canvas, history);
    }

    box.append(header, stats, canvas);
    grid.appendChild(box);
  }
}

init();
