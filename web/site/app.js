const FILTER_FIELDS = {
  color: { listId: "filter-color-list", groupId: "filter-color-group" },
  card_type: { listId: "filter-type-list", groupId: "filter-type-group" },
  rarity: { listId: "filter-rarity-list", groupId: "filter-rarity-group" },
  level: { listId: "filter-level-list", groupId: "filter-level-group" },
  pack: { listId: "filter-pack-list", groupId: "filter-pack-group" },
};

let allCards = [];
let filteredCards = [];

const grid = document.getElementById("card-grid");
const resultCount = document.getElementById("result-count");
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
  for (const [field, { listId }] of Object.entries(FILTER_FIELDS)) {
    selected[field] = getFilterSelection(listId);
  }

  filteredCards = allCards.filter((c) => {
    if (keyword) {
      const haystack = `${c.name || ""} ${c.ability_text || ""} ${c.category || ""}`.toLowerCase();
      if (!haystack.includes(keyword)) return false;
    }
    for (const field of Object.keys(FILTER_FIELDS)) {
      const cardValues = valuesForField(c, field);
      if (!matchesFilterSelection(cardValues, selected[field])) return false;
    }
    return true;
  });

  resultCount.textContent = `${filteredCards.length} 件ヒット`;
  renderResults();
}

function renderResults() {
  grid.innerHTML = "";
  for (const card of filteredCards) {
    grid.appendChild(createCardTile(card));
  }
}

init();
