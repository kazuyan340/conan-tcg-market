const partnerOf = col => CARD_DATA.find(c => c.card_type === 'パートナー' && c.color === col && /^P/.test(String(c.card_id))).card_id;
const runOrder = async (foeField, hand) => {
  setup({ active: 'opponent', partner: partnerOf('青'), case: '1254', oppPartner: partnerOf('白'), oppCase: '1261', self: { field: foeField, hand: ['0100'], evidence: [false, false, false] }, opp: { file: 9, hand, remove: ['0092', '1176', '1177', '1175'], field: [], evidence: [false, false] } });
  window.cpuPlayer.startOnline(window.CPU_PRESET_DECKS[0], 'control');
  const t0 = Date.now();
  while (Date.now() - t0 < 40000 && match.turn.activeSide === 'opponent') { await sleep(700); if (contactState && contactState.queue && contactState.queue[0] === 'self') contactPass(); if (actionState && actionState.step === 'guard' && actionState.oppSide === 'self') { try { finalizeAction(null); } catch (e) {} } }
  return 'foeLeft=' + match.self.field.map(c => (CARD_BY_ID.get(c.cardId) || {}).name + (c.sleeping ? '(s)' : '')).join(',') + ' / plays=' + match.events.filter(e => e.side === 'opponent' && /^play$|actionDeclare/.test(e.type)).map(e => e.type + ':' + ((CARD_BY_ID.get(uidToCardId(e.uid || e.actorUid)) || {}).name || '')).join(',');
};
await scen('9000の9がアクティブ・8がスリープ(0547,0036,結成)', async () => {
  const r = await runOrder([{ no: '0871' }, { no: '0022', sleeping: true }], ['0547', '0036', '0264']);
  return { ok: match.self.field.length === 0, note: r };
});
await scen('9000の9がスリープ・8がアクティブ(0547,0036,結成)', async () => {
  const r = await runOrder([{ no: '0871', sleeping: true }, { no: '0022' }], ['0547', '0036', '0264']);
  return { ok: match.self.field.length === 0, note: r };
});
await scen('9000の9がアクティブ・8がアクティブ(0547,0036,結成)', async () => {
  const r = await runOrder([{ no: '0871' }, { no: '0022' }], ['0547', '0036', '0264']);
  return { ok: match.self.field.length === 0, note: r };
});
