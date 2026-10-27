const byName = (name, pred) => CARD_DATA.find(c => c.name === name && (!pred || pred(c)));
const partnerOf = col => CARD_DATA.find(c => c.card_type === 'パートナー' && c.color === col && /^P/.test(String(c.card_id))).card_id;
const lowFiller = CARD_DATA.filter(c => c.card_type === 'キャラ' && c.ap != null && /^[0-9]+$/.test(String(c.card_id)) && Number(c.card_id) < 1000).sort((a, b) => a.ap - b.ap)[0].card_id;
const lv2BW = CARD_DATA.find(c => c.card_type === 'キャラ' && c.level === 2 && /^[0-9]+$/.test(String(c.card_id)) && (c.color.includes('青') || c.color.includes('白'))).card_id;
const lv2GR = CARD_DATA.find(c => c.card_type === 'キャラ' && c.level === 2 && /^[0-9]+$/.test(String(c.card_id)) && (c.color.includes('緑') || c.color.includes('赤'))).card_id;
const hayateLow = CARD_DATA.find(c => c.card_type === 'キャラ' && c.level === 2 && /^[0-9]+$/.test(String(c.card_id)) && (c.ability_text || '').includes('【疾風】') && (c.color.includes('黄') || c.color.includes('黒')));
const pick = (arr, f) => arr.find(f);
const instOf = (sk, no) => match[sk].field.find(c => defOfInst(c).card_id === String(no));
const runDecl = (sk, no, lineHas) => {
  const inst = instOf(sk, no);
  const d = geeDeclareDefs(inst.cardId).find(x => (x.lineText || '').includes(lineHas));
  if (!d) return { err: 'no def for ' + lineHas, defs: geeDeclareDefs(inst.cardId).map(x => x.lineText) };
  const why = d.check(sk, inst.uid);
  if (why) return { err: 'check: ' + why };
  if (d.sleepCost) recordEvent({ type: 'declareSleepCost', side: sk, uid: inst.uid });
  d.run(sk, inst.uid);
  return {};
};
const enterChar = (sk, id, viaAbility) => { const inst = mkInst(sk, id); match[sk].field.push(inst); runEntryAbility(sk, inst.uid, id, !!viaAbility, 5); return inst; };

// ---------- 誘発(登場・リムーブ・指定アクション) ----------
await scen('1166 工藤有希子: 工藤優作の登場でAP8000以下をリムーブ', async () => {
  setup({ partner: partnerOf('白'), case: '1261', self: { field: ['1166'] }, opp: { field: [lowFiller] } });
  enterChar('self', byName('工藤優作').id);
  const log = await settle();
  return { ok: match.opponent.field.length === 0, log };
});
await scen('1170 江戸川コナン: レベル5以上の青が登場でリムーブ', async () => {
  setup({ partner: partnerOf('青'), case: '1261', self: { field: ['1170'] }, opp: { field: [lowFiller] } });
  enterChar('self', C('1173').id);
  const log = await settle();
  return { ok: match.opponent.field.length === 0, log };
});
await scen('1170 江戸川コナン: 自分の効果でリムーブされた→証拠表向き→Lv2青白を登場', async () => {
  setup({ partner: partnerOf('青'), case: '1261', self: { field: ['1170'], remove: [lv2BW], evidence: [false, false] }, opp: { evidence: [false, false, false] } });
  const inst = instOf('self', '1170');
  removeCharByEffect('self', inst.uid, 'self', inst.uid);
  const log = await settle();
  return { ok: !!match.self.field.find(c => defOfInst(c).card_id === String(lv2BW)) && match.self.evidence.some(e => e.faceUp), log, note: snap() };
});
await scen('1171 灰原哀: レベル4少年探偵団が登場でリムーブ', async () => {
  setup({ partner: partnerOf('青'), case: '1261', self: { field: ['1171'] }, opp: { field: [lowFiller] } });
  enterChar('self', C('1176').id);
  const log = await settle();
  return { ok: match.opponent.field.length === 0, log };
});
await scen('1171 灰原哀: 宣言(デッキ3枚リムーブ→レベル－4)', async () => {
  setup({ partner: partnerOf('青'), case: '1261', self: { field: ['1171'] } });
  const deck0 = match.self.deckPile.length;
  const r = runDecl('self', '1171', 'レベル－4');
  const log = await settle();
  return { ok: !r.err && match.self.deckPile.length === deck0 - 3 && match.turn.tempLevelDebuffs.some(d => d.amount === 4), log, note: JSON.stringify(r) };
});
await scen('1245 ジン＆ベルモット: 黒ずくめ登場でレベル9以下をリムーブ', async () => {
  setup({ partner: partnerOf('黒'), case: '1263', self: { field: ['1245'] }, opp: { field: [lowFiller] } });
  enterChar('self', C('1249').id);
  const log = await settle();
  return { ok: match.opponent.field.length === 0, log };
});
await scen('1245 ジン＆ベルモット: 宣言(スタン)→現場リムーブ時ドロー', async () => {
  setup({ partner: partnerOf('黒'), case: '1263', self: { field: ['1245', '1248'] }, opp: { field: [lowFiller] } });
  const r = runDecl('self', '1245', 'スタン');
  const log = await settle();
  const vod = instOf('self', '1248');
  if (!vod || !vod.stunned || vod.frDrawUntilTurn == null) return { ok: false, log, note: 'stun/grant failed ' + JSON.stringify(r) + ' ' + snap() };
  match.turn.activeSide = 'opponent'; match.turn.turnNumber = 4;
  const h0 = match.self.hand.length;
  removeCharByEffect('opponent', 'none', 'self', vod.uid);
  await settle();
  return { ok: match.self.hand.length === h0 + 1, log, note: 'hand ' + h0 + '->' + match.self.hand.length };
});
await scen('1248 ウォッカ: アクション済みで効果リムーブ→スリープで登場', async () => {
  setup({ partner: partnerOf('黒'), case: '1263', self: { field: ['1248'] } });
  const inst = instOf('self', '1248');
  recordEvent({ type: 'actionDeclare', side: 'self', actorUid: inst.uid, targetSide: 'opponent', targetUid: 'x', targetType: 'case' });
  match.self.field[0].sleeping = false;
  removeCharByEffect('self', inst.uid, 'self', inst.uid);
  const log = await settle();
  const back = instOf('self', '1248');
  return { ok: !!back && back.sleeping, log, note: snap() };
});
await scen('1260 諸伏景光＆スコッチ: 相手ターン中に疾風キャラ登場→ドロー(＋証拠表向きでさらにドロー)', async () => {
  setup({ partner: partnerOf('黄'), case: '1263', active: 'opponent', self: { field: ['1260'], evidence: [false, false, false] } });
  const h0 = match.self.hand.length;
  enterChar('self', C('1233').id);
  const log = await settle();
  return { ok: match.self.hand.length >= h0 + 2, log, note: "hand " + h0 + '->' + match.self.hand.length + ' ' + snap() };
});
const actTargetTest = async (no, setupExtra, check, label) => scen(`${no} 指定アクション誘発: ${label}`, async () => {
  const o = Object.assign({ partner: partnerOf('緑'), case: '1262', self: { field: [no] }, opp: { field: [{ no: lowFiller, sleeping: true }] } }, setupExtra || {});
  setup(o);
  const atk = instOf('self', no), tgt = match.opponent.field[0];
  const h0 = match.self.hand.length;
  runGeeTriggers('actTarget', { side: 'self', actorUid: atk.uid, targetSide: 'opponent', targetUid: tgt.uid });
  const log = await settle();
  return { ok: check(h0), log, note: snap() };
});
await actTargetTest('1188', null, () => match.opponent.field.length === 0, 'レベル7以下をリムーブ');
await actTargetTest('1229', { partner: partnerOf('赤'), case: '1262' }, h0 => match.self.hand.length === h0 + 1, 'カードを1枚引く');
await actTargetTest('1224', { partner: partnerOf('赤') }, () => match.opponent.field.length === 0 && match.opponent.deckPile.length > 0, 'そのキャラをデッキの下に');
await actTargetTest('1189', { self: { field: ['1189'], remove: [lv2GR] } }, () => match.self.field.some(c => defOfInst(c).card_id === String(lv2GR)), 'Lv2緑赤を登場');
await actTargetTest('1259', { partner: partnerOf('緑'), self: { field: ['1259'], hand: [lowFiller], evidence: [] } }, () => match.self.evidence.length === 1, '手札リムーブで証拠を得る');
