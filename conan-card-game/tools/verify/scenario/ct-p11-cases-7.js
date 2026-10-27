const partnerOf = col => CARD_DATA.find(c => c.card_type === 'パートナー' && c.color === col && /^P/.test(String(c.card_id))).card_id;
const numeric = c => /^[0-9]+$/.test(String(c.card_id)) && Number(c.card_id) < 1000;
const lowFiller = CARD_DATA.filter(c => c.card_type === 'キャラ' && c.ap != null && numeric(c)).sort((a, b) => a.ap - b.ap)[0].card_id;
const enterChar = (sk, id, via) => { const inst = mkInst(sk, id); match[sk].field.push(inst); runEntryAbility(sk, inst.uid, id, !!via, 5); return inst; };
await scen('1241 諸伏高明: 疾風(AP+1000)＋登場時(疾風が出れば突撃)', async () => {
  const h = CARD_DATA.find(c => c.card_type === 'キャラ' && (c.ability_text || '').includes('【疾風】'));
  setup({ partner: partnerOf('黄'), case: '1263', self: { deckTop: [h.card_id, lowFiller, lowFiller] } });
  const d0 = match.self.deckPile.length;
  const inst = enterChar('self', CID('1241'));
  const log = await settle();
  return { ok: match.self.deckPile.length === d0 - 3 && charHasKeyword(inst, '突撃') && match.turn.tempApBuffs.some(b => b.uid === inst.uid && b.amount === 1000), log, note: JSON.stringify(match.turn.tempApBuffs) };
});
await scen('1246 バーボン: 疾風(自分の表向きの証拠を裏向きに)', async () => {
  setup({ partner: partnerOf('黒'), case: '1263', self: { evidence: [true, false] } });
  enterChar('self', CID('1246'));
  const log = await settle({ choose: (cs, items) => cs.title === '効果' && cs.hint && cs.hint.includes('リムーブしてもよい') ? ['no'] : undefined });
  return { ok: match.self.evidence.every(e => !e.faceUp), log, note: snap() };
});
await scen('1260 諸伏景光＆スコッチ: 疾風(カードを1枚引き手札を1枚リムーブ)', async () => {
  setup({ partner: partnerOf('黄'), case: '1263' });
  const h0 = match.self.hand.length;
  enterChar('self', CID('1260'));
  const log = await settle();
  return { ok: match.self.hand.length === h0, log, note: `hand ${h0}->${match.self.hand.length}` };
});
await scen('1247 スコッチ: 疾風(ターン終了時まで突撃[事件])', async () => {
  setup({ partner: partnerOf('黒'), case: '1263' });
  const inst = enterChar('self', CID('1247'));
  const log = await settle();
  return { ok: charHasKeyword(inst, '突撃［事件］'), log };
});
