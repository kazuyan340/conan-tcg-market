const byName = (name, pred) => CARD_DATA.find(c => c.name === name && (!pred || pred(c)));
const partnerOf = col => CARD_DATA.find(c => c.card_type === 'パートナー' && c.color === col && /^P/.test(String(c.card_id))).card_id;
const numeric = c => /^[0-9]+$/.test(String(c.card_id)) && Number(c.card_id) < 1000;
const lowFiller = CARD_DATA.filter(c => c.card_type === 'キャラ' && c.ap != null && numeric(c)).sort((a, b) => a.ap - b.ap)[0].card_id;
const lv2BW = CARD_DATA.find(c => c.card_type === 'キャラ' && c.level === 2 && numeric(c) && (c.color.includes('青') || c.color.includes('白'))).card_id;
const hayateLow = CARD_DATA.find(c => c.card_type === 'キャラ' && c.level === 2 && (c.ability_text || '').includes('【疾風】') && (c.color.includes('黄') || c.color.includes('黒')));
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
const playEvent = (sk, no) => { const e = { cardId: CID(no), uid: sk + '-ev' + (++uidSeq) }; match[sk].hand.push(e); runEntryAbility(sk, e.uid, e.cardId, true, 5); return e; };
const lvOfField = (sk, inst) => { let lv; fieldItemsBase([sk], (c, i) => { if (i.uid === inst.uid) lv = c.level; return true; }, sk); return lv; };

// ---------- 常時効果 ----------
await scen('1173 毛利蘭: 証拠合計5つ以上でAP+3000(事件青白・自分ターン中)', async () => {
  setup({ partner: partnerOf('青'), case: '1261', self: { field: ['1173'], evidence: [false, false, false] }, opp: { evidence: [false, false] } });
  const inst = instOf('self', '1173'), d = defOfInst(inst);
  const on = effectiveAp(match, inst, 'self');
  match.opponent.evidence.pop();
  const off = effectiveAp(match, inst, 'self');
  return { ok: on - off === 3000 && off === d.ap, note: `on=${on} off=${off}` };
});
await scen('1201 白馬探: 証拠合計5つ以上でLP+1', async () => {
  setup({ partner: partnerOf('青'), case: '1261', self: { field: ['1201'], evidence: [false, false, false] }, opp: { evidence: [false, false] } });
  const inst = instOf('self', '1201');
  const on = effectiveLp(match, inst);
  match.opponent.evidence.pop();
  const off = effectiveLp(match, inst);
  return { ok: on - off === 1, note: `on=${on} off=${off}` };
});
await scen('1217 宮野志保＆明美 / 1228 宮野厚司: 解決編・自分ターン中にレベル低下', async () => {
  setup({ partner: partnerOf('赤'), case: '1262', resolved: true, self: { field: ['1217', '1228'] } });
  const a = instOf('self', '1217'), b = instOf('self', '1228');
  const la = lvOfField('self', a), lb = lvOfField('self', b);
  const ok = la === defOfInst(a).level - 2 && lb === defOfInst(b).level - 1;
  match.turn.activeSide = 'opponent';
  const la2 = lvOfField('self', a);
  return { ok: ok && la2 === defOfInst(a).level, note: `lv ${la}/${lb} oppTurn ${la2}` };
});
await scen('1227 宮野エレーナ: 解決編でレベル+1(既存処理)', async () => {
  setup({ partner: partnerOf('赤'), case: '1262', resolved: true, self: { field: ['1227'] } });
  const a = instOf('self', '1227');
  return { ok: lvOfField('self', a) === defOfInst(a).level + 1 };
});
await scen('1198 中森銀三: 証拠合計5つ以上で手札のレベル-1', async () => {
  setup({ partner: partnerOf('白'), case: '1261', self: { evidence: [false, false, false] }, opp: { evidence: [false, false] } });
  const id = CID('1198'), base = CARD_BY_ID.get(id).level;
  const on = effectiveHandLevel('self', id);
  match.opponent.evidence.pop();
  const off = effectiveHandLevel('self', id);
  return { ok: on === base - 1 && off === base, note: `base=${base} on=${on} off=${off}` };
});
await scen('1210 鈴木朋子: セットされていれば突撃 / 登場時に漆黒の星をセット', async () => {
  setup({ partner: partnerOf('白'), case: '1261', self: { remove: ['1216'] } });
  const inst = enterChar('self', CID('1210'));
  const noSet = charHasKeyword(inst, '突撃');
  const log = await settle();
  const hasSet = (inst.under || []).length === 1 && charHasKeyword(inst, '突撃');
  return { ok: !noSet && hasSet, log, note: 'under=' + (inst.under || []).length };
});
await scen('1180 日原誠人 / 1193 和田進一: 別名(現場以外／すべてのエリア)', async () => {
  setup({ partner: partnerOf('青'), case: '1261', self: { field: ['1180', '1193'] } });
  const hara = defOfInst(instOf('self', '1180')), wada = defOfInst(instOf('self', '1193'));
  const handCardDef = C('1180');
  return { ok: nameIs(handCardDef, '工藤新一') && nameIs(wada, '伊織無我') && wada.name !== '伊織無我', note: '' };
});
await scen('1213 富沢雄三: 現場で特徴[鈴木財閥]', async () => {
  setup({ partner: partnerOf('白'), case: '1261', self: { field: ['1213'] } });
  return { ok: cardHasTrait(defOfInst(instOf('self', '1213')), '鈴木財閥') };
});
await scen('突撃(条件付き): 1172/1173/1188 の innate keyword', async () => {
  setup({ partner: partnerOf('青'), case: '1261', self: { field: ['1172', '1173'] } });
  const a = instOf('self', '1172'), b = instOf('self', '1173');
  return { ok: charHasKeyword(a, '突撃') && charHasKeyword(b, '突撃'), note: `${charHasKeyword(a, '突撃')} ${charHasKeyword(b, '突撃')}` };
});

// ---------- ターン終了時 ----------
const turnEnd = async (sk) => { let done = false; triggerTurnEndAbilities(sk, () => { done = true; }); const log = await settle(); return { log, done }; };
await scen('1217 ターン終了時: スタンがいれば2枚引いて1枚リムーブ', async () => {
  setup({ partner: partnerOf('赤'), case: '1262', self: { field: ['1217', { no: lowFiller, stunned: true }] } });
  const h0 = match.self.hand.length;
  const t = await turnEnd('self');
  return { ok: match.self.hand.length === h0 + 1, log: t.log, note: `hand ${h0}->${match.self.hand.length}` };
});
await scen('1258 ターン終了時: 1枚引く(手札5枚以上なら1枚リムーブ)', async () => {
  setup({ partner: partnerOf('青'), case: '1261', self: { field: ['1258'] } });
  const h0 = match.self.hand.length;
  const t = await turnEnd('self');
  return { ok: match.self.hand.length === h0 + 1 - (h0 + 1 >= 5 ? 1 : 0), log: t.log, note: `hand ${h0}->${match.self.hand.length}` };
});
await scen('1258 ターン終了時: 自分の証拠が9つ以上で勝利', async () => {
  setup({ partner: partnerOf('青'), case: '1261', self: { field: ['1258'], evidence: Array(9).fill(false) } });
  const t = await turnEnd('self');
  const ok = match.gameOver === true;
  match.gameOver = false;
  return { ok, log: t.log };
});
await scen('1246 バーボン ターン終了時: 手札1枚リムーブで疾風Lv2を登場', async () => {
  setup({ partner: partnerOf('黒'), case: '1263', self: { field: ['1246'], remove: [hayateLow.card_id] } });
  const t = await turnEnd('self');
  const entered = match.self.field.some(c => defOfInst(c).card_id === String(hayateLow.card_id));
  return { ok: entered, log: t.log, note: snap() };
});

// ---------- 宣言 ----------
await scen('1178 江戸川コナン(解決編): デッキ3枚リムーブ→レベル-3', async () => {
  setup({ partner: partnerOf('青'), case: '1261', resolved: true, self: { field: ['1178'] } });
  const d0 = match.self.deckPile.length;
  const r = runDecl('self', '1178', 'レベル－3');
  const log = await settle();
  return { ok: !r.err && match.self.deckPile.length === d0 - 3, log, note: JSON.stringify(r) };
});
await scen('1180 日原誠人: 工藤新一をスタンして レベル6以下をリムーブ', async () => {
  setup({ partner: partnerOf('青'), case: '1261', self: { field: ['1180', '1172'] }, opp: { field: [lowFiller] } });
  const r = runDecl('self', '1180', 'スタン');
  const log = await settle();
  const shin = instOf('self', '1172');
  return { ok: !r.err && !!shin && shin.stunned && match.opponent.field.length === 0, log, note: JSON.stringify(r) + snap() };
});
await scen('1197 怪盗キッド: 手札リムーブ→アクティブ&AP-2000→スリープ', async () => {
  setup({ partner: partnerOf('白'), case: '1261', self: { field: [{ no: '1197', sleeping: true }], evidence: [false, false, false] }, opp: { field: [lowFiller], evidence: [false, false] } });
  const r = runDecl('self', '1197', '手札を1枚リムーブ');
  const log = await settle();
  const inst = instOf('self', '1197');
  return { ok: !r.err && !inst.sleeping && match.opponent.field[0].sleeping, log, note: JSON.stringify(r) + snap() };
});
await scen('1201 白馬探: 他の探偵がいればスリープ宣言でリムーブ', async () => {
  setup({ partner: partnerOf('青'), case: '1261', self: { field: ['1201', '1172'] }, opp: { field: [lowFiller] } });
  const r = runDecl('self', '1201', 'レベル7以下');
  const log = await settle();
  return { ok: !r.err && match.opponent.field.length === 0, log, note: JSON.stringify(r) };
});
await scen('1213 富沢雄三: 宣言(自身リムーブ→リムーブエリア全部デッキの下→シャッフル)', async () => {
  setup({ partner: partnerOf('白'), case: '1261', self: { field: ['1213'], remove: [lowFiller, lowFiller, lowFiller] } });
  const d0 = match.self.deckPile.length;
  const r = runDecl('self', '1213', 'すべてのカード');
  const log = await settle();
  return { ok: !r.err && match.self.remove.length === 0 && match.self.deckPile.length === d0 + 4, log, note: JSON.stringify(r) + snap() };
});
await scen('1217 宿: スタンをコストにレベル9以下をリムーブ', async () => {
  setup({ partner: partnerOf('赤'), case: '1262', self: { field: ['1217', '1172'] }, opp: { field: [lowFiller] } });
  const r = runDecl('self', '1217', 'レベル9以下');
  const log = await settle();
  return { ok: !r.err && match.opponent.field.length === 0 && instOf('self', '1172').stunned, log, note: JSON.stringify(r) };
});
await scen('1221 羽田秀吉: スタンして AP-2000', async () => {
  setup({ partner: partnerOf('赤'), case: '1262', self: { field: [{ no: '1221', sleeping: true }] }, opp: { field: [lowFiller] } });
  const r = runDecl('self', '1221', 'スタンさせる');
  const log = await settle();
  const inst = instOf('self', '1221');
  return { ok: !r.err && inst.stunned && match.turn.tempApBuffs.some(b => b.amount === -2000), log, note: JSON.stringify(r) };
});
await scen('1227 宮野エレーナ(解決編): Lv7アクティブをスタンして同AP以下をリムーブ', async () => {
  setup({ partner: partnerOf('赤'), case: '1262', resolved: true, self: { field: ['1227', '1172'] }, opp: { field: [lowFiller] } });
  const r = runDecl('self', '1227', 'スタンさせたキャラのAP');
  const log = await settle();
  return { ok: !r.err && match.opponent.field.length === 0, log, note: JSON.stringify(r) };
});
await scen('1235 千葉和伸: 警視庁Lv7以下をスタンし、そのレベル以下をリムーブ', async () => {
  setup({ partner: partnerOf('黄'), case: '1263', self: { field: ['1235', '1233'] }, opp: { field: [lowFiller] } });
  const r = runDecl('self', '1235', 'スタンさせたキャラのレベル');
  const log = await settle();
  return { ok: !r.err && match.opponent.field.length === 0, log, note: JSON.stringify(r) };
});
await scen('1249 ベルモット: 自分の黒を1枚リムーブ→そのレベル以下のスリープをリムーブ', async () => {
  setup({ partner: partnerOf('黒'), case: '1263', self: { field: ['1249', '1248'] }, opp: { field: [{ no: lowFiller, sleeping: true }] } });
  const r = runDecl('self', '1249', 'リムーブしたキャラ');
  const log = await settle();
  return { ok: !r.err && match.opponent.field.length === 0, log, note: JSON.stringify(r) };
});
await scen('1250 狼男(解決編): 自分のLv4以下の黒をリムーブ→そのレベル以下をスタン', async () => {
  setup({ partner: partnerOf('黒'), case: '1263', resolved: true, self: { field: ['1250', '1253'] }, opp: { field: [lowFiller] } });
  const r = runDecl('self', '1250', 'スタンさせる');
  const log = await settle();
  return { ok: !r.err && match.opponent.field[0].stunned, log, note: JSON.stringify(r) };
});
await scen('1253 亡霊船長: 宣言(自身リムーブ)→好きな数にAP+1000', async () => {
  setup({ partner: partnerOf('黒'), case: '1263', self: { field: ['1253', lowFiller, lowFiller] } });
  const r = runDecl('self', '1253', '好きな数');
  const log = await settle();
  return { ok: !r.err && match.turn.tempApBuffs.filter(b => b.amount === 1000).length >= 1, log, note: JSON.stringify(r) + JSON.stringify(match.turn.tempApBuffs) };
});
await scen('1247 スコッチ: 宣言(リムーブエリアに移し手札1枚リムーブ→疾風をパートナーエリアへ)', async () => {
  setup({ partner: partnerOf('黒'), case: '1263', resolved: true, self: { field: ['1247'], remove: [hayateLow.card_id], file: 8 } });
  const r = runDecl('self', '1247', 'パートナーエリアに移す');
  const log = await settle();
  const j = (match.self.partnerJewels || []);
  return { ok: !r.err && j.length === 1 && (match.self.partnerReturnGrants || []).length === 1, log, note: JSON.stringify(r) + snap() };
});
await scen('スコッチ後: 相手のメインフェイズ開始時にパートナーエリアから登場', async () => {
  setup({ partner: partnerOf('黒'), case: '1263', active: 'opponent' });
  const card = { cardId: hayateLow.id, uid: 'self-pj1' };
  match.self.partnerJewels = [card];
  recordEvent({ type: 'grantPartnerReturn', side: 'self', uid: 'self-pj1' });
  triggerMainPhaseStart('opponent');
  const log = await settle();
  return { ok: match.self.field.some(c => c.uid === 'self-pj1') && (match.self.partnerReturnGrants || []).length === 0, log, note: snap() };
});
await scen('スコッチ後(登場させない): リムーブエリアへ', async () => {
  setup({ partner: partnerOf('黒'), case: '1263', active: 'opponent' });
  match.self.partnerJewels = [{ cardId: hayateLow.id, uid: 'self-pj2' }];
  recordEvent({ type: 'grantPartnerReturn', side: 'self', uid: 'self-pj2' });
  triggerMainPhaseStart('opponent');
  const log = await settle({ choose: (cs, items) => ['no'] });
  return { ok: match.self.remove.some(c => c.uid === 'self-pj2') && match.self.partnerJewels.length === 0, log, note: snap() };
});
