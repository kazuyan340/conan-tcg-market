// デッキ作成ツール。左側にデッキ全体(パートナー・事件・メインデッキ40枚)を常に表示し、
// 右側の検索パネルでカードをクリックするとそのままデッキに追加される。
// デッキの空き枠をクリックすると、右側の絞り込みがその枠に合った種類に切り替わる。
const MAIN_DECK_SIZE = 40;
const MAX_COPIES = 3;
const DECK_LIST_KEY = "conanTcgDeckBuilderList";
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

// 複数デッキを保存できるようにする。deckListの各要素が1デッキ分で、
// deck変数はdeckList内の該当要素への参照(同じオブジェクトなので、deck.main[...]の
// ようにdeckを直接書き換えれば、そのままdeckList側にも反映される)。
// deck = { id, name, partner: cardId|null, case: cardId|null, main: { cardId: count } }
let deckList = [];
let currentDeckId = null;
let deck = { id: null, name: "", partner: null, case: null, main: {} };
let openedSharedDeckFromUrl = false;
const INCLUDE_PARTNER_CASE_KEY = "conanTcgDeckIncludePartnerCase";
let includePartnerCaseInTotal = localStorage.getItem(INCLUDE_PARTNER_CASE_KEY) !== "false";

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
  bindFilterDropdownPositioning();
  loadDeckFromUrlOrStorage();
  applyFilters();
  renderDeckList();
  renderDeckPanel();
  renderLastUpdated();
  // URL経由で共有デッキを開いた場合は、選択画面を経由せずそのまま参照画面を開く。
  if (openedSharedDeckFromUrl) {
    showDeckView();
  } else {
    showDeckSelect();
  }
}

// デッキ選択画面⇔参照画面⇔編集画面の切り替え。
function showDeckSelect() {
  document.getElementById("view-deck-select").classList.remove("hidden");
  document.getElementById("view-deck-view").classList.add("hidden");
  document.getElementById("view-deck-edit").classList.add("hidden");
  renderDeckList();
}

// デッキ一覧から開いた直後の閲覧専用画面。ここから「編集する」で編集画面に進む。
function showDeckView() {
  document.getElementById("view-deck-select").classList.add("hidden");
  document.getElementById("view-deck-view").classList.remove("hidden");
  document.getElementById("view-deck-edit").classList.add("hidden");
  document.getElementById("deck-view-title").textContent = deck.name || "";
  renderDeckViewPanel();
}

function showDeckEdit() {
  document.getElementById("view-deck-select").classList.add("hidden");
  document.getElementById("view-deck-view").classList.add("hidden");
  document.getElementById("view-deck-edit").classList.remove("hidden");
  document.getElementById("deck-edit-title").textContent = deck.name || "";
  renderDeckPanel();
}

// .checkbox-listはposition:absoluteで浮かせているが、検索パネル自体が
// overflow-y:autoでスクロールする箱になっているため、そのままだと箱の外に出る分が
// 切れて表示され、下の方のチェックが押せなくなる。開いた瞬間にposition:fixedへ
// 切り替えて、実際の画面上の座標を計算し直すことでこれを回避する。
function bindFilterDropdownPositioning() {
  for (const details of document.querySelectorAll(".deck-search-panel .filter-group")) {
    details.addEventListener("toggle", () => {
      const list = details.querySelector(".checkbox-list");
      if (!list) return;
      if (details.open) {
        const rect = details.getBoundingClientRect();
        list.style.position = "fixed";
        list.style.top = `${rect.bottom + 4}px`;
        list.style.left = `${rect.left}px`;
      }
    });
  }
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
// 色/レアリティ/レベル/収録パックのチェックを全部外し、キーワードもクリアする。
// パートナー⇔事件⇔メインデッキと切り替えたときに、前の絞り込み条件(例: レアリティSEC)が
// 残ったまま新しい種類には該当カードが無く「0件」になってしまう問題を防ぐため。
function resetCheckboxFilters() {
  keywordInput.value = "";
  for (const checkbox of document.querySelectorAll(".checkbox-list input")) {
    resetTriStateCheckbox(checkbox);
  }
  for (const field of Object.keys(FILTER_FIELDS)) {
    updateCountBadge(field);
  }
}

function focusPickerOn(type) {
  selectedTypes = new Set([type]);
  syncTypeToggleButtons();
  resetCheckboxFilters();
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

  const includeCheckbox = document.getElementById("include-partner-case");
  includeCheckbox.checked = includePartnerCaseInTotal;
  includeCheckbox.addEventListener("change", () => {
    includePartnerCaseInTotal = includeCheckbox.checked;
    localStorage.setItem(INCLUDE_PARTNER_CASE_KEY, String(includePartnerCaseInTotal));
    renderDeckPanel();
    renderDeckList();
  });

  document.getElementById("clear-deck").addEventListener("click", () => {
    if (!confirm("このデッキの内容をすべてクリアします。よろしいですか?")) return;
    deck.partner = null;
    deck.case = null;
    deck.main = {};
    saveDeck();
    renderDeckPanel();
  });

  document.getElementById("share-deck").addEventListener("click", shareDeckUrl);
  document.getElementById("max-rarity-deck").addEventListener("click", () => swapDeckToExtremeRarity(true));
  document.getElementById("min-rarity-deck").addEventListener("click", () => swapDeckToExtremeRarity(false));
  document.getElementById("back-to-deck-select").addEventListener("click", showDeckSelect);
  document.getElementById("back-to-deck-select-from-view").addEventListener("click", showDeckSelect);
  document.getElementById("edit-deck-btn").addEventListener("click", showDeckEdit);
  document.getElementById("rename-deck-btn").addEventListener("click", renameDeck);

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

// deckListとcurrentDeckIdをまとめてlocalStorageに保存する。deckはdeckList内の
// 要素への参照なので、deck.main[...]などの変更はdeckList側にもすでに反映済み。
function saveDeck() {
  try {
    localStorage.setItem(DECK_LIST_KEY, JSON.stringify({ decks: deckList, currentDeckId }));
  } catch {
    // localStorageが使えない環境では保存をあきらめる(致命的ではない)
  }
}

function makeEmptyDeck(name) {
  return { id: `deck-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name, partner: null, case: null, main: {} };
}

// 新しいデッキを作って切り替える。
function createNewDeck() {
  const name = prompt("デッキ名を入力してください", `デッキ${deckList.length + 1}`);
  if (name === null) return;
  const fresh = makeEmptyDeck(name || `デッキ${deckList.length + 1}`);
  deckList.push(fresh);
  currentDeckId = fresh.id;
  deck = fresh;
  saveDeck();
  showDeckEdit();
}

// 編集画面のタイトル横「✏️ 名前を変更」ボタン用。現在編集中のデッキ名を変更する。
function renameDeck() {
  const name = prompt("デッキ名を入力してください", deck.name || "");
  if (name === null || name.trim() === "") return;
  deck.name = name.trim();
  saveDeck();
  document.getElementById("deck-edit-title").textContent = deck.name;
  renderDeckList();
}

function switchToDeck(id) {
  const found = deckList.find((d) => d.id === id);
  if (!found) return;
  currentDeckId = id;
  deck = found;
  saveDeck();
  showDeckView();
}

function deleteDeck(id) {
  if (!confirm("このデッキを削除します。よろしいですか?")) return;
  deckList = deckList.filter((d) => d.id !== id);
  if (currentDeckId === id) {
    if (deckList.length > 0) {
      currentDeckId = deckList[0].id;
      deck = deckList[0];
    } else {
      // デッキが0個になった場合は選択中のデッキも無しにする(0個で問題ない)。
      currentDeckId = null;
      deck = { id: null, name: "", partner: null, case: null, main: {} };
    }
  }
  saveDeck();
  renderDeckList();
}

function loadDeckFromUrlOrStorage() {
  // DECK_LIST_KEY自体が存在するかどうかで、「一度も使ったことが無い(初回)」と
  // 「使った結果、自分で全デッキを削除して0件にした」を区別する。後者の場合は
  // 0件のまま尊重し、勝手に「デッキ1」を作り直さない。
  let hasExistingListKey = false;
  try {
    const raw = localStorage.getItem(DECK_LIST_KEY);
    if (raw !== null) {
      hasExistingListKey = true;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.decks)) {
        deckList = parsed.decks;
        if (deckList.length > 0) {
          currentDeckId = deckList.some((d) => d.id === parsed.currentDeckId) ? parsed.currentDeckId : deckList[0].id;
          deck = deckList.find((d) => d.id === currentDeckId);
        } else {
          currentDeckId = null;
          deck = { id: null, name: "", partner: null, case: null, main: {} };
        }
      }
    }
  } catch {
    // 壊れたデータは無視して初期状態のまま
  }

  // 複数デッキ対応前の古いデータ(単一デッキ)が残っていれば、「デッキ1」として引き継ぐ。
  if (!hasExistingListKey && deckList.length === 0) {
    let migrated = null;
    try {
      const old = localStorage.getItem("conanTcgDeckBuilder");
      if (old) {
        const parsedOld = JSON.parse(old);
        if (parsedOld && (parsedOld.partner || parsedOld.case || Object.keys(parsedOld.main || {}).length > 0)) {
          migrated = makeEmptyDeck("デッキ1");
          migrated.partner = parsedOld.partner ?? null;
          migrated.case = parsedOld.case ?? null;
          migrated.main = parsedOld.main || {};
        }
      }
    } catch {
      // 古いデータが壊れている場合は無視する
    }
    const fresh = migrated || makeEmptyDeck("デッキ1");
    deckList = [fresh];
    currentDeckId = fresh.id;
    deck = fresh;
  }

  // URLに共有デッキが埋め込まれている場合は、確認してから既存のデッキを上書きせず
  // 新しいデッキとして追加する。保存しない場合は何もせず通常通りの一覧を表示する。
  const fromUrl = new URLSearchParams(location.search).get("deck");
  if (fromUrl) {
    try {
      const decoded = JSON.parse(decodeURIComponent(escape(atob(fromUrl))));
      if (decoded && typeof decoded === "object") {
        if (confirm("共有されたデッキを保存しますか?(自分のデッキ一覧に新しく追加されます)")) {
          const shared = makeEmptyDeck("共有されたデッキ");
          shared.partner = decoded.partner ?? null;
          shared.case = decoded.case ?? null;
          shared.main = decoded.main || {};
          deckList.push(shared);
          currentDeckId = shared.id;
          deck = shared;
          saveDeck();
          openedSharedDeckFromUrl = true;
        }
        // URLにデッキデータを残したままだと、再読み込みのたびにまた確認が出てしまうため、
        // 保存の有無に関わらずURLからは消しておく。
        history.replaceState(null, "", location.pathname);
      }
    } catch {
      // URLのデッキデータが壊れている場合は無視する
    }
  }

  saveDeck();
}

// デッキ一覧バー(保存済みデッキをカードで並べ、クリックで切り替え・削除できる)を描画する。
// 指定したデッキ(deckList中の1件)の合計金額を計算する。現在編集中でないデッキも含めて
// 一覧に金額を出すための共通ヘルパー(ページを開くたびに最新のprices.jsonから計算するので、
// 毎晩の自動更新結果がそのまま反映される)。
function computeDeckTotal(d) {
  let total = 0;
  if (includePartnerCaseInTotal) {
    const partnerCard = d.partner ? cardById.get(d.partner) : null;
    const caseCard = d.case ? cardById.get(d.case) : null;
    for (const c of [partnerCard, caseCard]) {
      if (!c) continue;
      const p = cardPrice(c);
      if (p !== null) total += p;
    }
  }
  for (const [idStr, count] of Object.entries(d.main || {})) {
    const card = cardById.get(Number(idStr));
    if (!card) continue;
    const p = cardPrice(card);
    if (p !== null) total += p * count;
  }
  return total;
}

function renderDeckList() {
  const bar = document.getElementById("deck-list-bar");
  bar.innerHTML = "";

  for (const d of deckList) {
    const tile = document.createElement("div");
    tile.className = "deck-list-tile" + (d.id === currentDeckId ? " active" : "");

    const partnerCard = d.partner ? cardById.get(d.partner) : null;
    const caseCard = d.case ? cardById.get(d.case) : null;
    const mainCount = Object.values(d.main || {}).reduce((sum, n) => sum + n, 0);
    const total = computeDeckTotal(d);

    tile.innerHTML = `
      <div class="deck-list-thumbs">
        <div class="deck-list-thumb${partnerCard ? "" : " empty"}">${partnerCard ? `<img src="${partnerCard.image_url || ""}" alt="">` : ""}</div>
        <div class="deck-list-thumb deck-list-thumb-case${caseCard ? "" : " empty"}">${caseCard ? `<img src="${caseCard.image_url || ""}" alt="">` : ""}</div>
      </div>
      <div class="deck-list-info">
        <div class="deck-list-name">${escapeHtml(d.name || "無題のデッキ")}</div>
        <div class="deck-list-count">${mainCount}/${MAIN_DECK_SIZE}枚</div>
        <div class="deck-list-price">${total.toLocaleString()}円</div>
      </div>
      <button type="button" class="deck-list-delete" title="このデッキを削除">&times;</button>
    `;
    tile.addEventListener("click", () => switchToDeck(d.id));
    tile.querySelector(".deck-list-delete").addEventListener("click", (e) => {
      e.stopPropagation();
      deleteDeck(d.id);
    });
    bar.appendChild(tile);
  }

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "deck-list-add";
  addBtn.textContent = "+ 新しいデッキ";
  addBtn.addEventListener("click", createNewDeck);
  bar.appendChild(addBtn);
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

// デッキ内の各カードを、同じカード(copyGroupKey基準、レアリティ違い/再録含む)の中で
// 相場が一番高い/安いバリアントに一括で入れ替える。価格データが無いカードや、
// バリアントが1種類しか無いカードはそのまま(変えようが無い)。
function bestVariantId(cardId, wantMax) {
  const currentCard = cardById.get(cardId);
  if (!currentCard) return cardId;
  const key = copyGroupKey(currentCard);
  const priced = allCards
    .filter((c) => copyGroupKey(c) === key)
    .map((c) => ({ id: c.id, price: cardPrice(c) }))
    .filter((v) => v.price !== null);
  if (priced.length === 0) return cardId;
  const best = priced.reduce((acc, cur) => {
    if (wantMax) return cur.price > acc.price ? cur : acc;
    return cur.price < acc.price ? cur : acc;
  });
  return best.id;
}

function swapDeckToExtremeRarity(wantMax) {
  const newMain = {};
  for (const [idStr, count] of Object.entries(deck.main)) {
    const newId = bestVariantId(Number(idStr), wantMax);
    newMain[newId] = (newMain[newId] || 0) + count;
  }
  deck.main = newMain;

  if (deck.partner) deck.partner = bestVariantId(deck.partner, wantMax);
  if (deck.case) deck.case = bestVariantId(deck.case, wantMax);

  saveDeck();
  renderDeckPanel();
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
  for (const [field, { listId }] of Object.entries(FILTER_FIELDS)) {
    selected[field] = getFilterSelection(listId);
  }

  filteredCards = allCards.filter((c) => {
    if (selectedTypes.size > 0 && !selectedTypes.has(c.card_type)) return false;
    if (keyword && !String(c.name || "").toLowerCase().includes(keyword)) return false;
    for (const field of Object.keys(FILTER_FIELDS)) {
      const cardValues = valuesForField(c, field);
      if (!matchesFilterSelection(cardValues, selected[field])) return false;
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

  const total = computeDeckTotal(deck);

  let slotsFilled = 0;
  for (const { card, count } of entries) {
    for (let i = 0; i < count; i++) {
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

// 参照画面のパートナー/事件の枠。編集画面のrenderSlotBoxと違い、クリックしても
// 絞り込みは開かず、カードが入っていればモーダルを開くだけ(閲覧専用)。
function renderViewSlotBox(elId, cardId) {
  const el = document.getElementById(elId);
  el.classList.toggle("empty", !cardId || !cardById.has(cardId));

  if (!cardId || !cardById.has(cardId)) {
    el.innerHTML = "";
    el.onclick = null;
    return;
  }
  const card = cardById.get(cardId);
  el.innerHTML = `<img src="${card.image_url || ""}" alt="${escapeHtml(card.name)}">`;
  el.onclick = () => openModal(card);
}

// 参照画面の描画。編集画面のrenderDeckPanelと違い、カードクリックは全部モーダルを
// 開くだけで、追加/削除や絞り込みは行わない。
function renderDeckViewPanel() {
  renderViewSlotBox("deck-view-partner", deck.partner);
  renderViewSlotBox("deck-view-case", deck.case);

  const mainGrid = document.getElementById("deck-view-main-grid");
  mainGrid.innerHTML = "";

  const entries = Object.entries(deck.main)
    .map(([id, count]) => ({ card: cardById.get(Number(id)), count }))
    .filter((e) => e.card)
    .sort((a, b) => a.card.name.localeCompare(b.card.name, "ja"));

  for (const { card, count } of entries) {
    for (let i = 0; i < count; i++) {
      const slot = document.createElement("div");
      slot.className = "deck-slot-box";
      slot.title = card.name;
      slot.innerHTML = `<img src="${card.image_url || ""}" alt="${escapeHtml(card.name)}">`;
      slot.addEventListener("click", () => openModal(card));
      mainGrid.appendChild(slot);
    }
  }

  const count = mainDeckCount();
  document.getElementById("deck-view-count").textContent = `メインデッキ ${count}/${MAIN_DECK_SIZE}枚`;
  const total = computeDeckTotal(deck);
  document.getElementById("deck-view-total").textContent = `合計 ${total.toLocaleString()}円`;
}

// メインデッキの空き枠クリック用: キャラ+イベント両方に絞り込む(1種類固定のfocusPickerOnとは別扱い)。
function focusPickerOnMain() {
  selectedTypes = new Set(["キャラ", "イベント"]);
  syncTypeToggleButtons();
  resetCheckboxFilters();
  applyFilters();
  document.querySelector(".deck-search-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  keywordInput.focus();
}

init();
