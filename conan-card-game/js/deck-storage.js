// デッキの保存/読み込み(localStorage)。deckbuilder.html と battle.html の両方から使う共通処理。
const DECK_STORAGE_KEY = 'conanTcgDecks';

function loadSavedDecks() {
  try {
    const raw = localStorage.getItem(DECK_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('デッキ一覧の読み込みに失敗しました', e);
    return [];
  }
}

function saveDecks(decks) {
  localStorage.setItem(DECK_STORAGE_KEY, JSON.stringify(decks));
}

// deckCounts: { [cardId]: qty }（キャラ・イベントのみ、40枚分）
// partnerCardId / caseCardId: それぞれ1枚ずつ選んだパートナー・事件カードのid
// を新規デッキとして保存する。生成したデッキのidを返す。
function saveDeck(name, deckCounts, partnerCardId, caseCardId) {
  const decks = loadSavedDecks();
  const entry = {
    id: `deck_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name,
    partnerCardId,
    caseCardId,
    cards: Object.entries(deckCounts).map(([id, qty]) => ({ id: Number(id), qty })),
    savedAt: new Date().toISOString(),
  };
  decks.push(entry);
  saveDecks(decks);
  return entry.id;
}

function deleteDeck(id) {
  saveDecks(loadSavedDecks().filter(d => d.id !== id));
}
