const partnerOf = col => CARD_DATA.find(c => c.card_type === 'パートナー' && c.color === col && /^P/.test(String(c.card_id))).card_id;
await scen('歩美の変装: AP3000以下のスリープ+別のスリープLv7以下 → 光彦でAP3000を、歩美の変装でもう1体', async () => {
  setup({ active: 'opponent', partner: partnerOf('青'), case: '1254', oppPartner: partnerOf('白'), oppCase: '1261', self: { field: [{ no: '0183', sleeping: true }, { no: '0549', sleeping: true }], hand: ['0100'], evidence: [false, false, false] }, opp: { file: 6, hand: ['1175'], field: ['0092', '1177', '1176'], evidence: [false, false] } });
  window.cpuPlayer.startOnline(window.CPU_PRESET_DECKS[0], 'control');
  const t0 = Date.now();
  while (Date.now() - t0 < 40000 && match.turn.activeSide === 'opponent') { await sleep(700); if (contactState && contactState.queue && contactState.queue[0] === 'self') contactPass(); if (actionState && actionState.step === 'guard' && actionState.oppSide === 'self') { try { finalizeAction(null); } catch (e) {} } }
  return { ok: match.self.field.length === 0, note: 'foeLeft=' + match.self.field.map(c => defOfInst(c).name + defOfInst(c).level + 'AP' + defOfInst(c).ap).join(',') + ' evs=' + match.events.filter(e => e.side === 'opponent').map(e => e.type).join(',') };
});
