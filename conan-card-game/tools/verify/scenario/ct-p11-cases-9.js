const partnerOf = col => CARD_DATA.find(c => c.card_type === 'パートナー' && c.color === col && /^P/.test(String(c.card_id))).card_id;
const numeric = c => /^[0-9]+$/.test(String(c.card_id)) && Number(c.card_id) < 1000;
const lowFiller = CARD_DATA.filter(c => c.card_type === 'キャラ' && c.ap != null && numeric(c)).sort((a, b) => a.ap - b.ap)[0].card_id;
const instOf = (sk, no) => match[sk].field.find(c => defOfInst(c).card_id === String(no));
await scen('1228 宮野厚司: 相手ターンの現場リムーブ時(上3枚から宮野姉妹を手札へ・残りリムーブ)', async () => {
  const sis = CARD_DATA.find(c => c.name === '宮野エレーナ' && c.card_type === 'キャラ');
  setup({ partner: partnerOf('赤'), case: '1262', active: 'opponent', self: { field: ['1228'], deckTop: [sis.card_id, lowFiller, lowFiller] } });
  const inst = instOf('self', '1228');
  const h0 = match.self.hand.length, r0 = match.self.remove.length;
  removeCharByEffect('opponent', 'none', 'self', inst.uid);
  await sleep(1500);
  if (!deckPeekState) return { ok: false, note: 'no peek' };
  const cand = deckPeekState.revealedUids.find(u => deckPeekState.filter ? deckPeekState.filter(defOfInst(match.self.deckPile.find(c => c.uid === u))) : true);
  deckPeekState.pendingUid = cand;
  const sis0 = match.self.deckPile.find(c => c.uid === cand);
  confirmDeckPeekChoice(cand);
  await sleep(800);
  return { ok: match.self.hand.length === h0 + 1 && match.self.remove.length === r0 + 1 + 2 && !deckPeekState, note: `hand ${h0}->${match.self.hand.length} remove ${r0}->${match.self.remove.length} peekOpen=${!!deckPeekState} cand=${sis0 && defOfInst(sis0).name}` };
});
