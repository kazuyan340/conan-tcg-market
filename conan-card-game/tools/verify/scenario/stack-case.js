const partnerOf = col => CARD_DATA.find(c => c.card_type === 'パートナー' && c.color === col && /^P/.test(String(c.card_id))).card_id;
const one = async (hand, remove) => {
  setup({ oppResolved: true, active: 'opponent', partner: partnerOf('青'), case: '1254', oppPartner: partnerOf('白'), oppCase: '1261', self: { field: [{ no: '0631', sleeping: true }], hand: ['0100'], evidence: [false, false, false] }, opp: { file: 8, hand, remove, field: [], evidence: [false, false] } });
  window.cpuPlayer.startOnline(window.CPU_PRESET_DECKS[0], 'control');
  const t0 = Date.now();
  while (Date.now() - t0 < 60000 && match.turn.activeSide === 'opponent') { await sleep(700); if (contactState && contactState.queue && contactState.queue[0] === 'self') contactPass(); if (actionState && actionState.step === 'guard' && actionState.oppSide === 'self') { try { finalizeAction(null); } catch (e) {} } }
  const k = match.opponent.field.find(f => (CARD_BY_ID.get(f.cardId) || {}).card_id === '0264');
  window.__dbg = (window.__dbg || '') + '[' + match.opponent.field.map(f => defOfInst(f).name).join('/') + '|' + match.opponent.hand.map(h => defOfInst(h).name).join('/') + '|' + match.events.filter(e => e.side === 'opponent').map(e => e.type).join(',') + ']';
  return k ? (k.under || []).length : -1;
};
await scen('結成の重ね枚数は1・3・5のどれか', async () => {
  const c = await one(['0264'], ['0092', '1176']);   // 2名 → 1枚
  const a = await one(['0264'], ['0092', '1176', '1177', '1175']);   // 4名 → 3枚
  const b = await one(['0264', '1185'], ['0092', '1176', '1177', '1175']);   // 五人囃子あり → 1枚
  return { ok: [a, b, c].every(n => [1, 3, 5].includes(n)) && a === 3 && c === 1, note: 'a=' + a + ' b=' + b + ' c=' + c };
});
