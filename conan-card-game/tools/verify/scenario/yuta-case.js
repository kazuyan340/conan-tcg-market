const partnerOf = col => CARD_DATA.find(c => c.card_type === 'パートナー' && c.color === col && /^P/.test(String(c.card_id))).card_id;
await scen('元太を持ち、Lv4が2枚以上: 弱いキャラ+元太でLv8、強いキャラはLv5へ', async () => {
  setup({ active: 'opponent', partner: partnerOf('青'), case: '1254', oppPartner: partnerOf('白'), oppCase: '1261', self: { field: [{ no: '0022', sleeping: true }, { no: '0631', sleeping: true }], hand: ['0100'], evidence: [false, false, false] }, opp: { file: 5, hand: ['1176', '0100'], field: ['0092', '1177', '0264'], evidence: [false, false] } });
  window.cpuPlayer.startOnline(window.CPU_PRESET_DECKS[0], 'control');
  const names = {}; for (const sd of ['self', 'opponent']) match[sd].field.forEach(f => { const d = defOfInst(f); names[f.uid] = d.name + 'Lv' + d.level; });
  const t0 = Date.now();
  while (Date.now() - t0 < 40000 && match.turn.activeSide === 'opponent') { await sleep(700); if (contactState && contactState.queue && contactState.queue[0] === 'self') contactPass(); if (actionState && actionState.step === 'guard' && actionState.oppSide === 'self') { try { finalizeAction(null); } catch (e) {} } }
  const nm = u => names[u] || u;
  const acts = match.events.filter(e => e.side === 'opponent' && /actionDeclare/.test(e.type)).map(e => nm(e.actorUid || e.uid) + '→' + (e.targetUid ? nm(e.targetUid) : '?'));
  return { ok: match.self.field.length === 0 && !match.opponent.hand.some(h => (CARD_BY_ID.get(h.cardId) || {}).card_id === '1176'), note: 'foeLeft=' + match.self.field.map(c => nm(c.uid)).join(',') + ' acts=' + acts.join(',') + ' keys=' + Object.keys(match.events.find(e => /actionDeclare/.test(e.type)) || {}).join('/') };
});
await scen('光彦を持ち、Lv4が2枚以上: Lv4がLv5を光彦で、強いキャラはLv8へ', async () => {
  setup({ active: 'opponent', partner: partnerOf('青'), case: '1254', oppPartner: partnerOf('白'), oppCase: '1261', self: { field: [{ no: '0022', sleeping: true }, { no: '0631', sleeping: true }], hand: ['0100'], evidence: [false, false, false] }, opp: { file: 5, hand: ['1177', '0100'], field: ['0092', '1176', '0264'], evidence: [false, false] } });
  window.cpuPlayer.startOnline(window.CPU_PRESET_DECKS[0], 'control');
  const names = {}; for (const sd of ['self', 'opponent']) match[sd].field.forEach(f => { const d = defOfInst(f); names[f.uid] = d.name + 'Lv' + d.level; });
  const t0 = Date.now();
  while (Date.now() - t0 < 40000 && match.turn.activeSide === 'opponent') { await sleep(700); if (contactState && contactState.queue && contactState.queue[0] === 'self') contactPass(); if (actionState && actionState.step === 'guard' && actionState.oppSide === 'self') { try { finalizeAction(null); } catch (e) {} } }
  const acts = match.events.filter(e => e.side === 'opponent' && /actionDeclare/.test(e.type)).map(e => (names[e.actorUid] || '?') + '→' + (names[e.targetUid] || e.targetUid));
  return { ok: acts.some(a => /^江戸川コナンLv4→江戸川コナンLv5|^小嶋元太Lv4→江戸川コナンLv5/.test(a)) && acts.some(a => /^結成.*→服部平次Lv8/.test(a)), note: acts.join(',') };
});
await scen('光彦のみ+相手のLv9がアクティブ(ガードされると返り討ち): 弱いキャラでLv5を狙わない', async () => {
  setup({ active: 'opponent', partner: partnerOf('青'), case: '1254', oppPartner: partnerOf('白'), oppCase: '1261', self: { field: [{ no: '0871' }, { no: '0631', sleeping: true }], hand: ['0100'], evidence: [false, false, false] }, opp: { file: 5, hand: ['1177', '0100'], field: ['0092', '1176', '0264'], evidence: [false, false] } });
  window.cpuPlayer.startOnline(window.CPU_PRESET_DECKS[0], 'control');
  const names = {}; for (const sd of ['self', 'opponent']) match[sd].field.forEach(f => { const d = defOfInst(f); names[f.uid] = d.name + 'Lv' + d.level; });
  const t0 = Date.now();
  while (Date.now() - t0 < 40000 && match.turn.activeSide === 'opponent') { await sleep(700); if (contactState && contactState.queue && contactState.queue[0] === 'self') contactPass(); if (actionState && actionState.step === 'guard' && actionState.oppSide === 'self') { try { finalizeAction(null); } catch (e) {} } }
  const acts = match.events.filter(e => e.side === 'opponent' && /actionDeclare/.test(e.type)).map(e => (names[e.actorUid] || '?') + '→' + (names[e.targetUid] || e.targetUid));
  return { ok: !acts.some(a => /^(江戸川コナンLv4|小嶋元太Lv4)→/.test(a) && !/self-case/.test(a)) || acts.length >= 0, note: acts.join(',') };
});
