const PAGE_SIZE = 50;
const FILTER_FIELDS = {
  color: { listId: "filter-color-list", groupId: "filter-color-group" },
  card_type: { listId: "filter-type-list", groupId: "filter-type-group" },
  rarity: { listId: "filter-rarity-list", groupId: "filter-rarity-group" },
  level: { listId: "filter-level-list", groupId: "filter-level-group" },
  pack: { listId: "filter-pack-list", groupId: "filter-pack-group" },
};

let allCards = [];
let filteredCards = [];
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
  applyFilters();
  renderLastUpdated();
}

// 複数値をとりうるフィールドを個々の値に分解する。単一値のフィールドでもそのまま動く。
// 「色」はAPI側がカンマ区切りではなく "青黄" のように1文字ずつ連結して返すため、
// 1文字ずつに分解する(この game の色は青/赤/黄/白/黒/緑の単漢字のみ)。
function valuesForField(card, field) {
  const raw = card[field];
  if (raw === null || raw === undefined || raw === "") return [];
  if (field === "color") {
    // データ内に "青黄" のような連結表記と "青,黄" のようなカンマ区切り表記が混在しているため、
    // 1文字ずつに分解したうえでカンマ自体は値として扱わない。
    return [...String(raw)].filter((ch) => ch !== ",");
  }
  return String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function populateFilterOptions() {
  for (const [field, { listId }] of Object.entries(FILTER_FIELDS)) {
    const listEl = document.getElementById(listId);
    const values = [...new Set(allCards.flatMap((c) => valuesForField(c, field)))];
    if (field === "level") {
      values.sort((a, b) => Number(a) - Number(b));
    } else {
      values.sort((a, b) => a.localeCompare(b, "ja"));
    }

    for (const v of values) {
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = v;
      checkbox.dataset.field = field;
      checkbox.addEventListener("change", () => {
        updateCountBadge(field);
        applyFilters();
      });
      label.appendChild(checkbox);
      label.append(` ${v}`);
      listEl.appendChild(label);
    }
  }
}

function getChecked(field) {
  const { listId } = FILTER_FIELDS[field];
  return [...document.querySelectorAll(`#${listId} input:checked`)].map((el) => el.value);
}

function updateCountBadge(field) {
  const { groupId } = FILTER_FIELDS[field];
  const badge = document.querySelector(`#${groupId} .count-badge`);
  const n = getChecked(field).length;
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
      checkbox.checked = false;
    }
    for (const field of Object.keys(FILTER_FIELDS)) {
      updateCountBadge(field);
    }
    applyFilters();
  });

  // 開いている絞り込みの外側をクリックしたら閉じる
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

function applyFilters() {
  const keyword = keywordInput.value.trim().toLowerCase();
  const selected = {};
  for (const field of Object.keys(FILTER_FIELDS)) {
    selected[field] = getChecked(field);
  }

  filteredCards = allCards.filter((c) => {
    if (keyword) {
      const haystack = `${c.name || ""} ${c.ability_text || ""} ${c.category || ""}`.toLowerCase();
      if (!haystack.includes(keyword)) return false;
    }
    for (const field of Object.keys(FILTER_FIELDS)) {
      if (selected[field].length === 0) continue;
      const cardValues = valuesForField(c, field);
      if (!selected[field].some((v) => cardValues.includes(v))) return false;
    }
    return true;
  });

  currentPage = 0;
  resultCount.textContent = `${filteredCards.length} 件ヒット`;
  renderPage();
}

function totalPages() {
  return Math.max(1, Math.ceil(filteredCards.length / PAGE_SIZE));
}

function renderPage() {
  grid.innerHTML = "";
  const start = currentPage * PAGE_SIZE;
  const pageCards = filteredCards.slice(start, start + PAGE_SIZE);

  for (const card of pageCards) {
    grid.appendChild(createCardTile(card));
  }

  pageLabel.textContent = `ページ ${currentPage + 1} / ${totalPages()}`;
  document.getElementById("prev-page").disabled = currentPage === 0;
  document.getElementById("next-page").disabled = currentPage >= totalPages() - 1;
  window.scrollTo({ top: 0 });
}

init();
