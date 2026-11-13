const partnerOf = col => CARD_DATA.find(c => c.card_type === 'パートナー' && c.color === col && /^P/.test(String(c.card_id))).card_id;
await scen('Lv9/8が手札になくても、Lv4(元太・光彦)だけでLv8とLv5を処理', async () => {
  setup({ active: 'opponent', partner: partnerOf('青'), case: '1254', oppPartner: partnerOf('白'), oppCase: '1261', self: { field: [{ no: '0022', sleeping: true }, { no: '0631', sleeping: true }], hand: ['0100'], evidence: [false, false, false] }, opp: { file: 5, hand: ['1176', '1177', '1175'], field: ['0092'], evidence: [false, false] } });
  window.cpuPlayer.startOnline(window.CPU_PRESET_DECKS[0], 'control');
  const names = {}; for (const sd of ['self', 'opponent']) match[sd].field.forEach(f => { const d = defOfInst(f); names[f.uid] = d.name + 'Lv' + d.level; });
  const t0 = Date.now();
  while (Date.now() - t0 < 40000 && match.turn.activeSide === 'opponent') { await sleep(700); if (contactState && contactState.queue && contactState.queue[0] === 'self') contactPass(); if (actionState && actionState.step === 'guard' && actionState.oppSide === 'self') { try { finalizeAction(null); } catch (e) {} } }
  const acts = match.events.filter(e => e.side === 'opponent' && /actionDeclare/.test(e.type)).map(e => (names[e.actorUid] || '?') + '→' + (names[e.targetUid] || e.targetUid));
  return { ok: match.self.field.length === 0, note: 'foeLeft=' + match.self.field.map(c => names[c.uid]).join(',') + ' acts=' + acts.join(',') };
});
