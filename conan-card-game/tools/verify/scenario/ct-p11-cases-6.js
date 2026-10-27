const partnerOf = col => CARD_DATA.find(c => c.card_type === 'パートナー' && c.color === col && /^P/.test(String(c.card_id))).card_id;
const numeric = c => /^[0-9]+$/.test(String(c.card_id)) && Number(c.card_id) < 1000;
const lowFiller = CARD_DATA.filter(c => c.card_type === 'キャラ' && c.ap != null && numeric(c)).sort((a, b) => a.ap - b.ap)[0].card_id;
const instOf = (sk, no) => match[sk].field.find(c => defOfInst(c).card_id === String(no));
const runDecl = (sk, no, lineHas) => {
  const inst = instOf(sk, no);
  const d = geeDeclareDefs(inst.cardId).find(x => (x.lineText || '').includes(lineHas));
  if (!d) return { err: 'no def for ' + lineHas, defs: geeDeclareDefs(inst.cardId).map(x => x.lineText.slice(0, 40)) };
  const why = d.check(sk, inst.uid); if (why) return { err: 'check: ' + why };
  if (d.sleepCost) recordEvent({ type: 'declareSleepCost', side: sk, uid: inst.uid });
  d.run(sk, inst.uid); return {};
};
const enterChar = (sk, id, via) => { const inst = mkInst(sk, id); match[sk].field.push(inst); runEntryAbility(sk, inst.uid, id, !!via, 5); return inst; };
const kid = CARD_DATA.find(c => c.card_type === 'キャラ' && (c.category || '').includes('少年探偵団') && numeric(c)).card_id;
await scen('1181 間宮マス代: 事件編の登場時(少年探偵団がいればドロー)', async () => {
  setup({ partner: partnerOf('青'), case: '1261', self: { field: [kid] } });
  const h0 = match.self.hand.length;
  enterChar('self', CID('1181'));
  const log = await settle();
  return { ok: match.self.hand.length === h0 + 1, log, note: `hand ${h0}->${match.self.hand.length}` };
});
await scen('1181 間宮マス代: 解決編の宣言(少年探偵団をデッキの下→Lv6以下をリムーブ)', async () => {
  setup({ partner: partnerOf('青'), case: '1261', resolved: true, self: { field: ['1181', kid] }, opp: { field: [lowFiller] } });
  const d0 = match.self.deckPile.length;
  const r = runDecl('self', '1181', 'レベル6以下');
  const log = await settle();
  return { ok: !r.err && match.opponent.field.length === 0 && match.self.deckPile.length === d0 + 1, log, note: JSON.stringify(r) };
});
await scen('1219 ジョディ: 宣言(AP8000以下をリムーブ→APが4000以上低ければLv2緑赤を登場)', async () => {
  const lv2 = CARD_DATA.find(c => c.card_type === 'キャラ' && c.level === 2 && numeric(c) && (c.color.includes('緑') || c.color.includes('赤'))).card_id;
  setup({ partner: partnerOf('赤'), case: '1262', self: { field: ['1219'], remove: [lv2] }, opp: { field: [lowFiller] } });
  const r = runDecl('self', '1219', 'AP8000以下');
  const log = await settle();
  return { ok: !r.err && match.opponent.field.length === 0 && match.self.field.some(c => defOfInst(c).card_id === String(lv2)), log, note: JSON.stringify(r) + snap() };
});
await scen('1228 宮野厚司: 宣言(スリープかスタン時 AP8000以下をリムーブ)', async () => {
  setup({ partner: partnerOf('赤'), case: '1262', self: { field: [{ no: '1228', sleeping: true }] }, opp: { field: [lowFiller] } });
  const r = runDecl('self', '1228', 'AP8000以下');
  const log = await settle();
  return { ok: !r.err && match.opponent.field.length === 0, log, note: JSON.stringify(r) };
});
await scen('1231 高木渉: 絆佐藤美和子の宣言(佐藤美和子をスリープ→Lv2以下の佐藤美和子/高木渉を登場)', async () => {
  const sato = CARD_DATA.find(c => c.name.includes('佐藤美和子') && c.card_type === 'キャラ' && c.level <= 2);
  const sato2 = CARD_DATA.find(c => c.name.includes('佐藤美和子') && c.card_type === 'キャラ');
  setup({ partner: partnerOf('黄'), case: '1263', self: { field: ['1231', sato2.card_id], remove: sato ? [sato.card_id] : [] } });
  const r = runDecl('self', '1231', 'スリープ');
  const log = await settle();
  return { ok: !r.err && (sato ? match.self.field.length === 3 : true), log, note: JSON.stringify(r) + ' sato=' + !!sato + ' ' + snap() };
});
await scen('1233 宮本由美: 事件編の疾風(ドロー)', async () => {
  setup({ partner: partnerOf('黄'), case: '1263' });
  const h0 = match.self.hand.length;
  enterChar('self', CID('1233'));
  const log = await settle();
  return { ok: match.self.hand.length === h0 + 1, log, note: `hand ${h0}->${match.self.hand.length}` };
});
await scen('1233 宮本由美: 解決編・相手ターン中の登場時(スリープ→AP5000以下をバウンス)', async () => {
  setup({ partner: partnerOf('黄'), case: '1263', resolved: true, active: 'opponent', opp: { field: [lowFiller] } });
  enterChar('self', CID('1233'));
  const log = await settle();
  return { ok: match.opponent.field.length === 0, log, note: snap() };
});
await scen('1241 諸伏高明: 疾風(AP+1000)/登場時に上3枚リムーブ→疾風が出れば突撃', async () => {
  const h = CARD_DATA.find(c => c.card_type === 'キャラ' && (c.ability_text || '').includes('【疾風】'));
  setup({ partner: partnerOf('黄'), case: '1263', self: { deckTop: [h.card_id, lowFiller, lowFiller] } });
  const d0 = match.self.deckPile.length;
  const inst = enterChar('self', CID('1241'));
  const log = await settle();
  return { ok: match.self.deckPile.length === d0 - 3 && charHasKeyword(inst, '突撃') && match.turn.tempApBuffs.some(b => b.uid === inst.uid && b.amount === 1000), log, note: JSON.stringify(match.turn.tempApBuffs) + ' kw=' + charHasKeyword(inst, '突撃') };
});
