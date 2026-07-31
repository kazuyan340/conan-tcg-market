// デッキ作成ツール。左側にデッキ全体(パートナー・事件・メインデッキ40枚)を常に表示し、
// 右側の検索パネルでカードをクリックするとそのままデッキに追加される。
// デッキの空き枠をクリックすると、右側の絞り込みがその枠に合った種類に切り替わる。
const MAIN_DECK_SIZE = 40;
const MAX_COPIES = 3;
const DECK_STORAGE_KEY = "conanTcgDeckBuilder";
const CARD_TYPES = ["キャラ", "イベント", "パートナー", "事件"];

const FILTER_FIELDS = {
  color: { listId: "filter-color-list", groupId: "filter-color-group" },
  rarity: { listId: "filter-rarity-list", groupId: "filter-rarity-group" },
  level: { listId: "filter-level-list", groupId: "filter-level-group" },
  pack: { listId: "filter-pack-list", groupId: "filter-pack-group" },
};

let allCards = [];
let cardById = new Map();
let filteredCards = [];
let selectedTypes = new Set(["キャラ", "イベント"]);

// deck = { partner: cardId|null, case: cardId|null, main: { cardId: count } }
let deck = { partner: null, case: null, main: {} };

const grid = document.getElementById("card-grid");
const resultCount = document.getElementById("result-count");
const keywordInput = document.getElementById("keyword");

async function init() {
  allCards = await loadCardData();
  cardById = new Map(allCards.map((c) => [c.id, c]));
  renderTypeToggles();
  populateFilterOptions();
  bindEvents();
  bindModalEvents();
  loadDeckFromUrlOrStorage();
  applyFilters();
  renderDeckPanel();
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

// カード種類のトグルボタン(複数選択可)。デッキの枠をクリックしたときは
// setTypeFilterOnly()で強制的に1種類だけに絞り込む。
function renderTypeToggles() {
  const container = document.getElementById("filter-type-list");
  container.innerHTML = "";
  for (const type of CARD_TYPES) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "type-toggle";
    btn.dataset.type = type;
    btn.classList.toggle("active", selectedTypes.has(type));
    btn.textContent = type;
    btn.addEventListener("click", () => {
      if (selectedTypes.has(type)) selectedTypes.delete(type);
      else selectedTypes.add(type);
      applyFilters();
    });
    container.appendChild(btn);
  }
}

function syncTypeToggleButtons() {
  for (const btn of document.querySelectorAll(".type-toggle")) {
    btn.classList.toggle("active", selectedTypes.has(btn.dataset.type));
  }
}

// デッキの枠(パートナー/事件/メインデッキ)をクリックしたときに呼ぶ。右側の絞り込みを
// その種類だけにして、検索パネルにスクロールする。
function focusPickerOn(type) {
  selectedTypes = new Set([type]);
  syncTypeToggleButtons();
  applyFilters();
  document.querySelector(".deck-search-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  keywordInput.focus();
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

  document.getElementById("clear-deck").addEventListener("click", () => {
    if (!confirm("デッキの内容をすべてクリアします。よろしいですか?")) return;
    deck = { partner: null, case: null, main: {} };
    saveDeck();
    renderDeckPanel();
  });

  document.getElementById("share-deck").addEventListener("click", shareDeckUrl);

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

function saveDeck() {
  try {
    localStorage.setItem(DECK_STORAGE_KEY, JSON.stringify(deck));
  } catch {
    // localStorageが使えない環境では保存をあきらめる(致命的ではない)
  }
}

function loadDeckFromUrlOrStorage() {
  const fromUrl = new URLSearchParams(location.search).get("deck");
  if (fromUrl) {
    try {
      const decoded = JSON.parse(decodeURIComponent(escape(atob(fromUrl))));
      if (decoded && typeof decoded === "object") {
        deck = { partner: decoded.partner ?? null, case: decoded.case ?? null, main: decoded.main || {} };
        saveDeck();
        return;
      }
    } catch {
      // URLのデッキデータが壊れている場合は無視してlocalStorageにフォールバック
    }
  }

  try {
    const raw = localStorage.getItem(DECK_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      deck = { partner: parsed.partner ?? null, case: parsed.case ?? null, main: parsed.main || {} };
    }
  } catch {
    // 壊れたデータは無視して初期状態のまま
  }
}

function shareDeckUrl() {
  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(deck))));
  const url = `${location.origin}${location.pathname}?deck=${encoded}`;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(
      () => alert("デッキのURLをコピーしました。"),
      () => prompt("このURLをコピーしてください:", url)
    );
  } else {
    prompt("このURLをコピーしてください:", url);
  }
}

function cardPrice(card) {
  return pooledAveragePrice(commonPrices[String(card.id)] || []);
}

function mainDeckCount() {
  return Object.values(deck.main).reduce((sum, n) => sum + n, 0);
}

// カードをクリックしたときの挙動。パートナー/事件は1枚選択の置き換え、
// キャラ/イベントはメインデッキへの加算(3枚上限・40枚上限を守る)。
function addCard(card) {
  if (card.card_type === "パートナー") {
    deck.partner = card.id;
    saveDeck();
    renderDeckPanel();
    return;
  }
  if (card.card_type === "事件") {
    deck.case = card.id;
    saveDeck();
    renderDeckPanel();
    return;
  }
  if (copiesInGroup(card) >= MAX_COPIES) {
    alert(`同じカード(レアリティ違いを含む)は最大${MAX_COPIES}枚までです。`);
    return;
  }
  if (mainDeckCount() >= MAIN_DECK_SIZE) {
    alert(`メインデッキは${MAIN_DECK_SIZE}枚までです。`);
    return;
  }
  deck.main[card.id] = (deck.main[card.id] || 0) + 1;
  saveDeck();
  renderDeckPanel();
}

// 「同じカード」判定キー。card_idはレアリティ違い(C/CP・R/RP・SR/SRP)やPRの
// 再録でも共通の値になっているため、これで同一カードとして3枚制限をまとめて数えられる。
function copyGroupKey(card) {
  return card.card_id;
}

// 現在デッキに入っている、同じカード(レアリティ違い含む)の合計枚数。
function copiesInGroup(card) {
  const key = copyGroupKey(card);
  let total = 0;
  for (const [idStr, count] of Object.entries(deck.main)) {
    const other = cardById.get(Number(idStr));
    if (other && copyGroupKey(other) === key) total += count;
  }
  return total;
}

function removeOneFromMainDeck(cardId) {
  const current = deck.main[cardId] || 0;
  if (current <= 1) {
    delete deck.main[cardId];
  } else {
    deck.main[cardId] = current - 1;
  }
  saveDeck();
  renderDeckPanel();
}

// 検索結果のカード1枚分のタイルを作る。タイルをクリックするとそのままデッキに追加される。
// 画像上の🔍アイコンをクリックすると、相場詳細のモーダルを開く(誤クリック防止のためstopPropagation)。
function createSearchTile(card) {
  const tile = document.createElement("div");
  tile.className = "card-tile";
  tile.title = card.name;
  const price = cardPrice(card);
  const priceText = price !== null ? `${price.toLocaleString()}円` : "-";

  tile.innerHTML = `
    <div class="trend-badge">${escapeHtml(priceText)}</div>
    <div class="deck-tile-img-wrap">
      <img src="${card.image_url || ""}" alt="${escapeHtml(card.name)}" loading="lazy">
      <button type="button" class="deck-info-btn" title="詳細を見る">🔍</button>
    </div>
  `;

  tile.addEventListener("click", () => addCard(card));
  tile.querySelector(".deck-info-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    openModal(card);
  });

  return tile;
}

function applyFilters() {
  const keyword = keywordInput.value.trim().toLowerCase();
  const selected = {};
  for (const field of Object.keys(FILTER_FIELDS)) {
    selected[field] = getChecked(field);
  }

  filteredCards = allCards.filter((c) => {
    if (selectedTypes.size > 0 && !selectedTypes.has(c.card_type)) return false;
    if (keyword && !String(c.name || "").toLowerCase().includes(keyword)) return false;
    for (const field of Object.keys(FILTER_FIELDS)) {
      if (selected[field].length === 0) continue;
      const cardValues = valuesForField(c, field);
      if (!selected[field].some((v) => cardValues.includes(v))) return false;
    }
    return true;
  });

  resultCount.textContent = `${filteredCards.length} 件`;
  renderResults();
}

function renderResults() {
  grid.innerHTML = "";
  filteredCards.forEach((card) => grid.appendChild(createSearchTile(card)));
}

// パートナー/事件の枠(カード形の箱)を描画する。空なら「クリックして絞り込む」空枠、
// 選択済みならカード画像+解除ボタン。
function renderSlotBox(elId, cardId, focusType, onClear) {
  const el = document.getElementById(elId);
  el.classList.toggle("empty", !cardId);
  // 空き枠はもちろん、選択済みでもクリックすれば選び直せるように、常に絞り込みを開く。
  // (×ボタンだけは解除の役割なのでstopPropagationで区別する)
  el.onclick = () => focusPickerOn(focusType);

  if (!cardId || !cardById.has(cardId)) {
    el.innerHTML = "";
    return;
  }
  const card = cardById.get(cardId);
  el.innerHTML = `
    <img src="${card.image_url || ""}" alt="${escapeHtml(card.name)}">
    <button type="button" class="deck-slot-clear" title="解除">&times;</button>
  `;
  el.querySelector(".deck-slot-clear").addEventListener("click", (e) => {
    e.stopPropagation();
    onClear();
  });
}

function renderDeckPanel() {
  renderSlotBox("deck-partner", deck.partner, "パートナー", () => {
    deck.partner = null;
    saveDeck();
    renderDeckPanel();
  });
  renderSlotBox("deck-case", deck.case, "事件", () => {
    deck.case = null;
    saveDeck();
    renderDeckPanel();
  });

  // メインデッキ40枚を、カードごとの枚数を個々の枠に展開して描画する
  // (非公式デッキメーカーを参考に、1枠=1枚の見た目にしている)。
  const mainGrid = document.getElementById("deck-main-grid");
  mainGrid.innerHTML = "";

  const entries = Object.entries(deck.main)
    .map(([id, count]) => ({ card: cardById.get(Number(id)), count }))
    .filter((e) => e.card)
    .sort((a, b) => a.card.name.localeCompare(b.card.name, "ja"));

  let total = 0;
  const partnerCard = deck.partner ? cardById.get(deck.partner) : null;
  const caseCard = deck.case ? cardById.get(deck.case) : null;
  for (const c of [partnerCard, caseCard]) {
    if (!c) continue;
    const p = cardPrice(c);
    if (p !== null) total += p;
  }

  let slotsFilled = 0;
  for (const { card, count } of entries) {
    const price = cardPrice(card);
    for (let i = 0; i < count; i++) {
      if (price !== null) total += price;
      const slot = document.createElement("div");
      slot.className = "deck-slot-box";
      slot.title = `${card.name}(クリックで1枚減らす)`;
      slot.innerHTML = `<img src="${card.image_url || ""}" alt="${escapeHtml(card.name)}">`;
      slot.addEventListener("click", () => removeOneFromMainDeck(card.id));
      mainGrid.appendChild(slot);
      slotsFilled++;
    }
  }
  for (let i = slotsFilled; i < MAIN_DECK_SIZE; i++) {
    const slot = document.createElement("div");
    slot.className = "deck-slot-box empty";
    slot.addEventListener("click", () => focusPickerOnMain());
    mainGrid.appendChild(slot);
  }

  const count = mainDeckCount();
  const countEl = document.getElementById("deck-count");
  countEl.textContent = `メインデッキ ${count}/${MAIN_DECK_SIZE}枚`;
  countEl.classList.toggle("deck-count-ok", count === MAIN_DECK_SIZE);

  document.getElementById("deck-total").textContent = `合計 ${total.toLocaleString()}円`;
}

// メインデッキの空き枠クリック用: キャラ+イベント両方に絞り込む(1種類固定のfocusPickerOnとは別扱い)。
function focusPickerOnMain() {
  selectedTypes = new Set(["キャラ", "イベント"]);
  syncTypeToggleButtons();
  applyFilters();
  document.querySelector(".deck-search-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  keywordInput.focus();
}

init();
