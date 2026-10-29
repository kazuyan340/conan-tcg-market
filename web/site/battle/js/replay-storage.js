// 対戦リプレイの保存/読み込み(localStorage)。battle.html と replays.html の両方から使う共通処理。
const REPLAY_STORAGE_KEY = 'conanTcgReplays';

function loadSavedReplays() {
  try {
    const raw = localStorage.getItem(REPLAY_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('リプレイ一覧の読み込みに失敗しました', e);
    return [];
  }
}

function saveReplays(replays) {
  localStorage.setItem(REPLAY_STORAGE_KEY, JSON.stringify(replays));
}

// selfConfig/opponentConfig: match.config.self / match.config.opponent と同じ形
// (deckNameを含む)。firstPlayer/eventsはmatch.firstPlayer / match.events をそのまま渡す。
// 保存したリプレイのidを返す。
function saveReplay(selfConfig, opponentConfig, firstPlayer, events) {
  const replays = loadSavedReplays();
  const entry = {
    id: `replay_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    self: selfConfig,
    opponent: opponentConfig,
    firstPlayer,
    events,
    savedAt: new Date().toISOString(),
  };
  replays.push(entry);
  saveReplays(replays);
  return entry.id;
}

function deleteReplay(id) {
  saveReplays(loadSavedReplays().filter(r => r.id !== id));
}
