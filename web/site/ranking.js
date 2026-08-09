// 相場ランキング(収録パック/レアリティ等で絞り込みつつ、相場(全サイト加重平均)が高い順に並べるページ)。
// フィルタ周りはapp.js(一覧画面)と同じ仕組みを踏襲している。
const PAGE_SIZE = 50;
const FILTER_FIELDS = {
  color: { listId: "filter-color-list", groupId: "filter-color-group" },
  card_type: { listId: "filter-type-list", groupId: "filter-type-group" },
  rarity: { listId: "filter-rarity-list", groupId: "filter-rarity-group" },
  level: { listId: "filter-level-list", groupId: "filter-level-group" },
  pack: { listId: "filter-pack-list", groupId: "filter-pack-group" },
};

let allCards = [];
let filteredEntries = [];
let currentPage = 0;

const grid = document.getElementById("card-grid");
const resultCount = document.getElementById("result-count");
const pageLabel = document.getElementById("page-label");
const keywordInput = document.getElementById("keyword");

async function init() {
  allCards = await loadCardData();
  populateFilterOptions();
  bindEvents();
  bindModalEvents();
  bindFiltersToggle();
  applyFilters();
  renderLastUpdated();
}

function valuesForField(card, field) {
  const raw = card[field];
  if (raw === null || raw === undefined || raw === "") return [];
  if (field === "color") {
    return [...String(raw)].filter((ch) => ch !== ",");
  }
  return String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// 色・種類・レアリティフィルタは五十音順だと並びがバラバラで見づらいため、固定の表示順にする。
const COLOR_ORDER = ["青", "緑", "白", "赤", "黄", "黒"];
const CARD_TYPE_ORDER = ["パートナー", "キャラ", "イベント", "事件"];
const RARITY_ORDER = [
  "C", "CP", "CP2", "R", "RP", "SR", "SRP", "SRCP", "MR", "MRP", "MRCP", "D", "PR", "SEC",
];

function populateFilterOptions() {
  for (const [field, { listId }] of Object.entries(FILTER_FIELDS)) {
    const listEl = document.getElementById(listId);
    const values = [...new Set(allCards.flatMap((c) => valuesForField(c, field)))];
    if (field === "level") {
      values.sort((a, b) => Number(a) - Number(b));
    } else if (field === "color") {
      values.sort((a, b) => COLOR_ORDER.indexOf(a) - COLOR_ORDER.indexOf(b));
    } else if (field === "card_type") {
      values.sort((a, b) => CARD_TYPE_ORDER.indexOf(a) - CARD_TYPE_ORDER.indexOf(b));
    } else if (field === "rarity") {
      values.sort((a, b) => RARITY_ORDER.indexOf(a) - RARITY_ORDER.indexOf(b));
    } else if (field === "pack") {
      sortPackValues(values);
    } else {
      values.sort((a, b) => a.localeCompare(b, "ja"));
    }

    let lastPackGroup = null;
    for (const v of values) {
      if (field === "pack") {
        const g = packGroupFor(v);
        if (g !== lastPackGroup) {
          const heading = document.createElement("div");
          heading.className = "checkbox-list-heading";
          heading.textContent = PACK_GROUP_LABELS[g];
          listEl.appendChild(heading);
          lastPackGroup = g;
        }
      }
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = v;
      checkbox.dataset.field = field;
      bindTriStateFilterCheckbox(checkbox, () => {
        updateCountBadge(field);
        applyFilters();
      });
      label.appendChild(checkbox);
      label.append(` ${v}`);
      listEl.appendChild(label);
    }
  }
}

function updateCountBadge(field) {
  const { listId, groupId } = FILTER_FIELDS[field];
  const badge = document.querySelector(`#${groupId} .count-badge`);
  const n = filterSelectionCount(listId);
  badge.textContent = n ? ` (${n})` : "";
  badge.classList.toggle("hidden", n === 0);
}

function bindEvents() {
  keywordInput.addEventListener("input", debounce(applyFilters, 200));

  document.getElementById("prev-page").addEventListener("click", () => {
    if (currentPage > 0) {
      currentPage--;
      renderPage();
    }
  });
  document.getElementById("next-page").addEventListener("click", () => {
    if (currentPage < totalPages() - 1) {
      currentPage++;
      renderPage();
    }
  });

  document.getElementById("reset-filters").addEventListener("click", () => {
    keywordInput.value = "";
    for (const checkbox of document.querySelectorAll(".checkbox-list input")) {
      resetTriStateCheckbox(checkbox);
    }
    for (const field of Object.keys(FILTER_FIELDS)) {
      updateCountBadge(field);
    }
    applyFilters();
  });

  document.addEventListener("click", (e) => {
    for (const details of document.querySelectorAll(".filter-group[open]")) {
      if (!details.contains(e.target)) {
        details.removeAttribute("open");
      }
    }
  });

}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// ランキング用のカード代表価格(各サイト最安値の単純平均)。データが無ければnull。
function cardPrice(card) {
  return pooledAveragePrice(commonPrices[String(card.id)] || []);
}

function applyFilters() {
  const keyword = keywordInput.value.trim().toLowerCase();
  const selected = {};
  for (const [field, { listId }] of Object.entries(FILTER_FIELDS)) {
    selected[field] = getFilterSelection(listId);
  }

  filteredEntries = allCards
    .filter((c) => {
      if (keyword) {
        const haystack = `${c.name || ""} ${c.ability_text || ""} ${c.category || ""}`.toLowerCase();
        if (!haystack.includes(keyword)) return false;
      }
      for (const field of Object.keys(FILTER_FIELDS)) {
        const cardValues = valuesForField(c, field);
        if (!matchesFilterSelection(cardValues, selected[field])) return false;
      }
      return true;
    })
    .map((card) => ({ card, price: cardPrice(card) }))
    .filter((entry) => entry.price !== null)
    .sort((a, b) => b.price - a.price);

  currentPage = 0;
  resultCount.textContent = `${filteredEntries.length} 件(価格データがあるカードのみ、高い順)`;
  renderPage();
}

function totalPages() {
  return Math.max(1, Math.ceil(filteredEntries.length / PAGE_SIZE));
}

function createRankingTile(card, rank, price) {
  const tile = document.createElement("div");
  tile.className = "card-tile";
  tile.innerHTML = `
    <div class="trend-badge">#${rank}　${price.toLocaleString()}円</div>
    <img src="${card.image_url || ""}" alt="${escapeHtml(card.name)}" loading="lazy">
    <div class="name">${escapeHtml(card.name)}</div>
    <div class="sub">${escapeHtml(card.rarity || "")} / ${escapeHtml(card.color || "")}</div>
  `;
  tile.addEventListener("click", () => openModal(card));
  return tile;
}

function renderPage() {
  grid.innerHTML = "";
  const start = currentPage * PAGE_SIZE;
  const pageEntries = filteredEntries.slice(start, start + PAGE_SIZE);

  pageEntries.forEach(({ card, price }, i) => {
    grid.appendChild(createRankingTile(card, start + i + 1, price));
  });

  pageLabel.textContent = `ページ ${currentPage + 1} / ${totalPages()}`;
  document.getElementById("prev-page").disabled = currentPage === 0;
  document.getElementById("next-page").disabled = currentPage >= totalPages() - 1;
  window.scrollTo({ top: 0 });
}

init();
