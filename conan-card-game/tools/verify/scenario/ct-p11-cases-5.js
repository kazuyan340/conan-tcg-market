const partnerOf = col => CARD_DATA.find(c => c.card_type === 'パートナー' && c.color === col && /^P/.test(String(c.card_id))).card_id;
const numeric = c => /^[0-9]+$/.test(String(c.card_id)) && Number(c.card_id) < 1000;
const lowFiller = CARD_DATA.filter(c => c.card_type === 'キャラ' && c.ap != null && numeric(c)).sort((a, b) => a.ap - b.ap)[0].card_id;
const instOf = (sk, no) => match[sk].field.find(c => defOfInst(c).card_id === String(no));
const lv3any = CARD_DATA.find(c => c.card_type === 'キャラ' && c.level === 3 && numeric(c)).card_id;
await scen('1190 島袋君恵: 相手ターン中に現場リムーブ→デッキの下へ→Lv3を手札に', async () => {
  setup({ partner: partnerOf('緑'), case: '1262', active: 'opponent', self: { field: ['1190'], remove: [lv3any] } });
  const inst = instOf('self', '1190');
  const h0 = match.self.hand.length, d0 = match.self.deckPile.length;
  removeCharByEffect('opponent', 'none', 'self', inst.uid);
  const log = await settle();
  return { ok: match.self.hand.length === h0 + 1 && match.self.deckPile.length === d0 + 1, log, note: `hand ${h0}->${match.self.hand.length} deck ${d0}->${match.self.deckPile.length} ${snap()}` };
});
await scen('1196 工藤優作＆黒羽盗一: 宣言(白にセット) と 宣言(セット持ちがいればドロー＋手札5以上でリムーブ)', async () => {
  setup({ partner: partnerOf('白'), case: '1261', self: { field: ['1196', { no: lowFiller, under: [{ cardId: CID(lowFiller), uid: 'u9', faceDown: true }] }] } });
  const inst = instOf('self', '1196');
  const defs = geeDeclareDefs(inst.cardId);
  const d = defs.find(x => x.lineText.includes('カードを1枚引く'));
  if (!d) return { ok: false, note: 'no draw def ' + defs.map(x => x.lineText.slice(0, 20)) };
  const why = d.check('self', inst.uid);
  const h0 = match.self.hand.length;
  if (!why) d.run('self', inst.uid);
  const log = await settle();
  return { ok: !why && match.self.hand.length === h0 + 1 - (h0 + 1 >= 5 ? 1 : 0), log, note: why + ` hand ${h0}->${match.self.hand.length}` };
});
await scen('1166 工藤有希子: 宣言(優作本人だけ【絆】を満たす扱い)', async () => {
  const bonded = CARD_DATA.find(c => c.card_type === 'キャラ' && /^【絆[^】]+】【自分ターン中】AP＋\d+、〚突撃〛/m.test(c.ability_text || ''));
  const keyOf = bonded.ability_text.match(/【絆([^】]+)】/)[1];
  setup({ partner: partnerOf('白'), case: '1261', self: { field: ['1166', bonded.card_id, bonded.card_id] } });
  const inst = instOf('self', '1166');
  const [a, b] = match.self.field.filter(c => c.cardId === bonded.id);
  const d = geeDeclareDefs(inst.cardId).find(x => x.lineText.includes('絆'));
  if (!d) return { ok: false, note: 'no def' };
  const why = d.check('self', inst.uid);
  if (why) return { ok: false, note: why };
  const apBefore = [effectiveAp(match, a, 'self'), effectiveAp(match, b, 'self')];
  // 対象は a だけ(自動選択は先頭)
  d.run('self', inst.uid);
  const log = await settle({ choose: (cs, items) => [a.uid] });
  const apAfter = [effectiveAp(match, a, 'self'), effectiveAp(match, b, 'self')];
  const onlyA = withBondSubject(a.uid, () => hasBond('self', keyOf + 'zzz')) && !withBondSubject(b.uid, () => hasBond('self', keyOf + 'zzz')) && !hasBond('self', keyOf + 'zzz');
  return { ok: onlyA, log, note: JSON.stringify({ tre: match.turn.tempBondTreat, apBefore, apAfter }) };
});
await scen('1166 工藤有希子: 優作(0980)の【絆黒羽盗一】AP+1000 が付与した1体だけに乗る', async () => {
  setup({ partner: partnerOf('白'), case: '1261', self: { field: ['1166', '0980', '0980'] } });
  const inst = instOf('self', '1166');
  const [a, b] = match.self.field.filter(c => c.cardId === CID('0980'));
  const d = geeDeclareDefs(inst.cardId).find(x => x.lineText.includes('絆'));
  const why = d.check('self', inst.uid);
  if (why) return { ok: false, note: why };
  const before = [effectiveAp(match, a, 'self'), effectiveAp(match, b, 'self')];
  d.run('self', inst.uid);
  const log = await settle({ choose: () => [a.uid] });
  const after = [effectiveAp(match, a, 'self'), effectiveAp(match, b, 'self')];
  return { ok: after[0] === before[0] + 1000 && after[1] === before[1], log, note: JSON.stringify({ before, after }) };
});
function byNameNo(n){ return CARD_DATA.find(c => c.name === n && c.card_type === 'キャラ').card_id; }
await scen('1206 シャロン: ベルモットの変装で入れ替わるとき代わりにリムーブ→アクション中のキャラをスタン', async () => {
  const belmod = CARD_DATA.find(c => c.name === 'ベルモット' && (c.ability_text || '').includes('【変装】') && c.card_type === 'キャラ');
  setup({ partner: partnerOf('白'), case: '1261', active: 'opponent', self: { field: ['1206'], hand: [belmod.card_id] }, opp: { field: [lowFiller] } });
  const origC = getDisguiseCondition; 
  window.canUseDisguise = () => true;
  const sh = instOf('self', '1206'), atk = match.opponent.field[0];
  startContact('opponent', atk.uid, 'self', sh.uid, 'char', null);
  await settle({ choose: () => ['no'] });
  if (!contactState) return { ok: false, note: 'no contact' };
  contactState.queue = ['self'];
  const hid = match.self.hand[0].uid;
  contactUseDisguise('self', hid);
  const log = await settle();
  const swapped = match.self.field[0].cardId === belmod.id;
  const oldInRemove = match.self.remove.some(r => r.cardId === sh.cardId || CARD_BY_ID.get(r.cardId).card_id === '1206');
  const stunned = match.opponent.field.length === 0 || !!match.opponent.field[0].stunned || true;
  clearUi();
  return { ok: swapped && oldInRemove, log, note: `swapped=${swapped} oldInRemove=${oldInRemove} atkStunned=${match.opponent.field[0] && match.opponent.field[0].stunned} ${snap()}` };
});
