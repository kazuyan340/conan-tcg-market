const partnerOf = col => CARD_DATA.find(c => c.card_type === 'パートナー' && c.color === col && /^P/.test(String(c.card_id))).card_id;
const runOrder = async (foeField) => {
  setup({ active: 'opponent', partner: partnerOf('青'), case: '1254', oppPartner: partnerOf('白'), oppCase: '1261', self: { field: foeField, hand: ['0100'], evidence: [false, false, false] }, opp: { file: 9, hand: ['0547', '0264'], remove: ['0092', '1176', '1177', '1175'], field: [], evidence: [false, false] } });
  window.cpuPlayer.startOnline(window.CPU_PRESET_DECKS[0], 'control');
  const t0 = Date.now();
  while (Date.now() - t0 < 40000 && match.turn.activeSide === 'opponent') { await sleep(700); if (contactState && contactState.queue && contactState.queue[0] === 'self') contactPass(); if (actionState && actionState.step === 'guard' && actionState.oppSide === 'self') { try { finalizeAction(null); } catch (e) {} } }
  return 'foeLeft=' + match.self.field.map(c => (CARD_BY_ID.get(c.cardId) || {}).name + (c.sleeping ? '(s)' : '')).join(',') + ' / ev=' + match.events.filter(e => e.side === 'opponent').map(e => e.type).join(',');
};
await scen('相手の9がアクティブ・8がスリープ → 9をリムーブして8にアクション', async () => {
  const r = await runOrder([{ no: '0547' }, { no: '0022', sleeping: true }]);
  return { ok: match.self.field.length === 0, note: r };
});
await scen('相手の9がスリープ・8がアクティブ → 8をリムーブして9にアクション', async () => {
  const r = await runOrder([{ no: '0547', sleeping: true }, { no: '0022' }]);
  return { ok: match.self.field.length === 0, note: r };
});
