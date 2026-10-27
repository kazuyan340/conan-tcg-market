const byName = (name, pred) => CARD_DATA.find(c => c.name === name && (!pred || pred(c)));
const partnerOf = col => CARD_DATA.find(c => c.card_type === 'パートナー' && c.color === col && /^P/.test(String(c.card_id))).card_id;
const numeric = c => /^[0-9]+$/.test(String(c.card_id)) && Number(c.card_id) < 1000;
const lowFiller = CARD_DATA.filter(c => c.card_type === 'キャラ' && c.ap != null && numeric(c)).sort((a, b) => a.ap - b.ap)[0].card_id;
const lv2BW = CARD_DATA.find(c => c.card_type === 'キャラ' && c.level === 2 && numeric(c) && (c.color.includes('青') || c.color.includes('白'))).card_id;
const instOf = (sk, no) => match[sk].field.find(c => defOfInst(c).card_id === String(no));
const enterChar = (sk, id, viaAbility) => { const inst = mkInst(sk, id); match[sk].field.push(inst); runEntryAbility(sk, inst.uid, id, !!viaAbility, 5); return inst; };
const playEvent = (sk, no) => { const e = { cardId: CID(no), uid: sk + '-ev' + (++uidSeq) }; match[sk].hand.push(e); executePlay(sk, e.uid, {}); return e; };
const sd = (no, color) => ({ partner: partnerOf(color), case: no });

// ---------- 登場時 ----------
await scen('1172 工藤新一: 探偵がいれば毛利蘭(Lv2)を登場、証拠合計4以下で手札リムーブ', async () => {
  const lowRan = CARD_DATA.find(c => c.name === '毛利蘭' && c.level != null && c.level <= 2);
  setup({ partner: partnerOf('青'), case: '1261', self: { field: ['1201'], remove: [lowRan ? lowRan.card_id : '1173'] } });
  const h0 = match.self.hand.length;
  enterChar('self', CID('1172'));
  const log = await settle();
  const entered = lowRan ? match.self.field.some(c => c.cardId === lowRan.id) : true;
  return { ok: entered && match.self.hand.length === h0 - 1, log, note: `lowRan=${!!lowRan} hand ${h0}->${match.self.hand.length} ${snap()}` };
});
await scen('1186 大岡紅葉: スリープして Lv8以下に相手デッキの上をセット', async () => {
  setup({ partner: partnerOf('緑'), case: '1262', opp: { field: [lowFiller] } });
  enterChar('self', CID('1186'));
  const log = await settle();
  const t = match.opponent.field[0];
  return { ok: !!t && (t.under || []).length === 1 && fdUnder(t).length === 1, log, note: snap() };
});
await scen('1186 大岡紅葉: 宣言(セット持ちの相手をリムーブ→自分デッキの上をこのキャラにセット)', async () => {
  setup({ partner: partnerOf('緑'), case: '1262', self: { field: ['1186'] }, opp: { field: [{ no: lowFiller, under: [{ cardId: CID(lowFiller), uid: 'x1', faceDown: true }] }] } });
  const inst = instOf('self', '1186');
  const d = geeDeclareDefs(inst.cardId).find(x => x.lineText.includes('裏向きのカードがセットされている'));
  if (!d) return { ok: false, note: 'no def' };
  const why = d.check('self', inst.uid);
  if (why) return { ok: false, note: why };
  d.run('self', inst.uid);
  const log = await settle();
  return { ok: match.opponent.field.length === 0 && fdUnder(instOf('self', '1186')).length === 1, log, note: snap() };
});
await scen('1193 和田進一(解決編/FILE6): スリープして相手キャラに相手デッキの上をセット', async () => {
  setup({ partner: partnerOf('緑'), case: '1262', resolved: true, self: { file: 7 }, opp: { field: [lowFiller] } });
  enterChar('self', CID('1193'));
  const log = await settle();
  const t = match.opponent.field[0];
  return { ok: !!t && fdUnder(t).length === 1, log, note: snap() };
});
await scen('1200 中森青子: 証拠合計5以上で AP+1000', async () => {
  setup({ partner: partnerOf('白'), case: '1261', self: { evidence: [false, false, false] }, opp: { evidence: [false, false] } });
  const inst = enterChar('self', CID('1200'));
  const log = await settle();
  return { ok: match.turn.tempApBuffs.some(b => b.uid === inst.uid && b.amount === 1000), log };
});
await scen('1209 鈴木園子: 3枚公開→1枚手札/1枚リムーブエリア/残りデッキの下', async () => {
  setup({ partner: partnerOf('白'), case: '1261', self: { deckTop: [lowFiller, lowFiller, lowFiller] } });
  const h0 = match.self.hand.length, r0 = match.self.remove.length, d0 = match.self.deckPile.length;
  enterChar('self', CID('1209'));
  const log = await settle();
  return { ok: match.self.remove.length >= r0 + 1 && match.self.deckPile.length === d0 - 2, log, note: `hand ${h0}->${match.self.hand.length} remove ${r0}->${match.self.remove.length} deck ${d0}->${match.self.deckPile.length}` };
});
await scen('1237 榎本梓: 2枚公開→相手が選んだキャラを手札に→残りリムーブ', async () => {
  setup({ partner: partnerOf('黄'), case: '1263', self: { deckTop: [lowFiller, lowFiller] }, opp: { field: [lowFiller] } });
  const h0 = match.self.hand.length, r0 = match.self.remove.length;
  enterChar('self', CID('1237'));
  const log = await settle();
  return { ok: match.self.hand.length === h0 + 1 && match.self.remove.length === r0 + 1, log, note: `hand ${h0}->${match.self.hand.length} remove ${r0}->${match.self.remove.length}` };
});
await scen('1240 目暮十三: リムーブエリアの警察を3枚までデッキの下→シャッフル', async () => {
  const police = CARD_DATA.filter(c => c.card_type === 'キャラ' && (c.category || '').includes('警察') && numeric(c)).slice(0, 3).map(c => c.card_id);
  setup({ partner: partnerOf('黄'), case: '1263', self: { remove: police } });
  const d0 = match.self.deckPile.length;
  enterChar('self', CID('1240'));
  const log = await settle();
  return { ok: match.self.remove.length === 0 && match.self.deckPile.length === d0 + 3, log, note: snap() };
});
await scen('1246 バーボン(事件黄黒/パートナー黒): 上3枚リムーブ→疾風ならレベル8以下をリムーブ', async () => {
  const h = CARD_DATA.find(c => c.card_type === 'キャラ' && (c.ability_text || '').includes('【疾風】'));
  setup({ partner: partnerOf('黒'), case: '1263', self: { deckTop: [h.card_id, lowFiller, lowFiller] }, opp: { field: [lowFiller] } });
  const d0 = match.self.deckPile.length;
  enterChar('self', CID('1246'));
  const log = await settle();
  return { ok: match.self.deckPile.length === d0 - 3 && match.opponent.field.length === 0, log, note: snap() };
});
await scen('1252 犯人: 自分ターン中の登場で相手パートナーをアクティブに(アシスト中なら戻す)', async () => {
  setup({ partner: partnerOf('黒'), case: '1263' });
  match.opponent.partner.sleeping = true; match.opponent.partner.assisting = true;
  enterChar('self', CID('1252'));
  const log = await settle();
  return { ok: !match.opponent.partner.sleeping && !match.opponent.partner.assisting, log };
});
await scen('1258 コナン＆キッド: 証拠合計5以上でカード2枚引き手札2枚リムーブ', async () => {
  setup({ partner: partnerOf('青'), case: '1261', self: { evidence: [false, false, false] }, opp: { evidence: [false, false] } });
  const h0 = match.self.hand.length;
  enterChar('self', CID('1258'));
  const log = await settle();
  return { ok: match.self.hand.length === h0, log, note: `hand ${h0}->${match.self.hand.length} ${snap()}` };
});
await scen('1258 コナン＆キッド: 証拠合計4以下で手札1枚リムーブ→証拠を得る', async () => {
  setup({ partner: partnerOf('青'), case: '1261', self: { evidence: [false] }, opp: { evidence: [false] } });
  const e0 = match.self.evidence.length;
  enterChar('self', CID('1258'));
  const log = await settle();
  return { ok: match.self.evidence.length === e0 + 1, log, note: snap() };
});

// ---------- イベント ----------
await scen('1168 やっとお逢いできましたね: Lv7以下をリムーブ→解決編ならLv2を登場→同名をデッキの下', async () => {
  setup({ partner: partnerOf('白'), case: '1261', resolved: true, self: { remove: [lv2BW, lv2BW] }, opp: { field: [lowFiller] } });
  const orig = tagsOk; window.tagsOk = () => true;
  const d0 = match.self.deckPile.length;
  playEvent('self', '1168');
  const log = await settle();
  window.tagsOk = orig;
  return { ok: match.opponent.field.length === 0 && match.self.field.length === 1 && match.self.deckPile.length === d0 + 1, log, note: snap() };
});
await scen('1185 五人囃子: Lv4少年探偵団3種→登場/スリープ登場/残り手札', async () => {
  const kids = ['1176', '1177', '1178'].map(n => n);
  const four = CARD_DATA.filter(c => c.card_type === 'キャラ' && c.level === 4 && (c.category || '').includes('少年探偵団')).reduce((a, c) => { if (!a.some(x => x.name === c.name)) a.push(c); return a; }, []).slice(0, 3);
  setup({ partner: partnerOf('青'), case: '1261', self: { remove: four.map(c => c.card_id) } });
  const h0 = match.self.hand.length;
  playEvent('self', '1185');
  const log = await settle();
  return { ok: match.self.field.length === 2 && match.self.hand.length === h0 + 1, log, note: `kids=${four.length} ${snap()}` };
});
await scen('1216 漆黒の星: 証拠を裏向きにし、鈴木財閥/怪盗にセットしAP+2000', async () => {
  setup({ partner: partnerOf('白'), case: '1261', self: { field: ['1213'], evidence: [true, false] } });
  playEvent('self', '1216');
  const log = await settle();
  const host = instOf('self', '1213');
  return { ok: !!host && host.under.length === 1 && match.self.evidence.every(e => !e.faceUp) && match.turn.tempApBuffs.some(b => b.amount === 2000), log, note: snap() + JSON.stringify(match.turn.tempApBuffs) };
});
await scen('1230 消毒と絆創膏: 4人揃えば3つとも行う', async () => {
  const names = ['宮野厚司', '宮野エレーナ', '宮野明美', '宮野志保'];
  const ids = names.map(n => CARD_DATA.find(c => c.card_type === 'キャラ' && c.name === n && numeric(c) || (c.card_type === 'キャラ' && c.name === n))).filter(Boolean);
  setup({ partner: partnerOf('赤'), case: '1262', self: { field: [{ no: lowFiller, stunned: true }] }, opp: { field: [lowFiller, lowFiller], evidence: [false, false] } });
  ids.forEach(c => match.self.field.push(mkInst('self', c.id)));
  while (match.self.field.length > 5) match.self.field.shift();
  const e0 = match.self.evidence.length;
  playEvent('self', '1230');
  const log = await settle();
  return { ok: log.length >= 0 && match.opponent.field.length <= 1, log, note: `names=${ids.length} ${snap()}` };
});
await scen('1243 「うるさい!!これは警察の仕事だ!!」: 色の数まで選んで上から行う', async () => {
  setup({ partner: partnerOf('黄'), case: '1263', resolved: true, self: { field: ['1233', '1246'] }, opp: { field: [lowFiller], evidence: [false] } });
  const orig = tagsOk; window.tagsOk = () => true;
  const h0 = match.self.hand.length;
  playEvent('self', '1243');
  const log = await settle({ choose: (cs, items) => items.map(i => i.key).slice(0, cs.max) });
  window.tagsOk = orig;
  return { ok: log.length > 0, log, note: `hand ${h0}->${match.self.hand.length} ${snap()}` };
});
await scen('1244 まだ配属先は決まってないけどね: 疾風Lv7以上の黄/黒にセット', async () => {
  const hy = CARD_DATA.find(c => c.card_type === 'キャラ' && c.level >= 7 && (c.ability_text || '').includes('【疾風】') && (c.color.includes('黄') || c.color.includes('黒')));
  setup({ partner: partnerOf('黄'), case: '1263', self: { field: [hy.card_id] } });
  const ev = { cardId: CID('1244'), uid: 'self-ev1' }; match.self.hand.push(ev);
  const r = '';
  executePlay('self', ev.uid, {});
  const log = await settle();
  const host = match.self.field[0];
  return { ok: !!host && host.under.length === 1, log, note: r + ' ' + snap() };
});
await scen('1244 リムーブエリアに置かれたとき(相手ターン): 疾風Lv6以下の黄/黒を登場', async () => {
  const hy = hayateCard = CARD_DATA.find(c => c.card_type === 'キャラ' && c.level <= 6 && (c.ability_text || '').includes('【疾風】') && (c.color.includes('黄') || c.color.includes('黒')));
  setup({ partner: partnerOf('黄'), case: '1263', active: 'opponent', self: { remove: [hy.card_id] } });
  const u = { cardId: CID('1244'), uid: 'self-evx' };
  match.self.remove.push(u);
  triggerEventPlacedInRemove('self', u);
  const log = await settle();
  return { ok: match.self.field.length === 1, log, note: snap() };
});
await scen('1256 黒と黒が混ざっても…: ジン＆ベルモットがいれば2つとも', async () => {
  setup({ partner: partnerOf('黒'), case: '1263', self: { field: ['1245', '1248'] }, opp: { field: [{ no: lowFiller, sleeping: false }, { no: lowFiller, sleeping: true }] } });
  const orig = tagsOk; window.tagsOk = () => true;
  const h0 = match.self.hand.length;
  playEvent('self', '1256');
  const log = await settle();
  window.tagsOk = orig;
  return { ok: match.self.hand.length >= h0 + 1, log, note: `hand ${h0}->${match.self.hand.length} ${snap()}` };
});

// ---------- 事件カード ----------
const caseDecl = async (no, setupFn, check, label) => scen(`${no} 事件: ${label}`, async () => {
  const o = setupFn();
  o.case = no; o.resolved = true;
  setup(o);
  const orig = tagsOk; window.tagsOk = () => true;
  const chk = canDeclareGenericCase('self');
  if (!chk.ok) { window.tagsOk = orig; return { ok: false, note: 'cannot: ' + chk.reason }; }
  declareGenericCase('self');
  const log = await settle();
  window.tagsOk = orig;
  return { ok: check(), log, note: snap() };
});
await caseDecl('1262', () => ({ partner: partnerOf('緑'), self: { evidence: [false, false, false] }, opp: { field: [lowFiller] } }), () => match.turn.tempApBuffs.some(b => b.amount === -3000) && match.self.evidence.filter(e => e.faceUp).length === 2, '証拠2つ表向き→AP-3000');
await caseDecl('1261', () => ({ partner: partnerOf('青'), self: { field: [lowFiller], evidence: [false, false, false] }, opp: { field: [{ no: lowFiller, sleeping: true }] } }), () => match.opponent.field.length === 0, '自分のキャラをリムーブ→相手のスリープをバウンス');
await caseDecl('1263', () => {
  const hy = CARD_DATA.find(c => c.card_type === 'キャラ' && c.level <= 3 && (c.ability_text || '').includes('【疾風】') && (c.color.includes('黄') || c.color.includes('黒')));
  return { partner: partnerOf('黄'), self: { hand: [hy.card_id], file: 5 } };
}, () => (match.self.partnerJewels || []).length === 1 && (match.self.partnerReturnGrants || []).length === 1, 'FILEの上をリムーブ→疾風をパートナーエリアへ');

// ---------- 変装 ----------
await scen('1206/1212 入れ替わり時のリムーブ代替が読めること', async () => {
  setup({ partner: partnerOf('白'), case: '1261', active: 'opponent', self: { field: ['1206'] } });
  const belmod = CARD_DATA.find(c => c.name === 'ベルモット' && (c.ability_text || '').includes('【変装】'));
  match.self.hand.push({ cardId: belmod.id, uid: 'self-hb' });
  contactState = { attackerSide: 'opponent', attackerUid: 'o', defenderSide: 'self', defenderUid: instOf('self', '1206').uid, queue: ['self'] };
  const r = geeSwapOutRule('self', 'self-hb');
  contactState = null;
  return { ok: !!r && r.steps.length >= 1, note: 'rule=' + !!r };
});
await scen('1212 土井塔克樹: 怪盗キッドに入れ替わられるときのリムーブ代替', async () => {
  setup({ partner: partnerOf('白'), case: '1261', active: 'opponent', self: { field: ['1212'] } });
  const kid = CARD_DATA.find(c => c.name === '怪盗キッド' && (c.ability_text || '').includes('【変装】'));
  match.self.hand.push({ cardId: kid.id, uid: 'self-hk' });
  contactState = { attackerSide: 'opponent', attackerUid: 'o', defenderSide: 'self', defenderUid: instOf('self', '1212').uid, queue: ['self'] };
  const r = geeSwapOutRule('self', 'self-hk');
  contactState = null;
  return { ok: !!r, note: 'rule=' + !!r };
});
await scen('1211 茶木神太郎: 相手が変装を使用したらアクティブに / ヒラメキで相手は変装不可', async () => {
  setup({ partner: partnerOf('白'), case: '1261', active: 'self', self: { field: [{ no: '1211', sleeping: true }] } });
  triggerCutinOrDisguiseUsedObservers('opponent', 'opp-x', 'disguise');
  const log = await settle();
  const inst = instOf('self', '1211');
  const hir = getHiramekiEffect(CID('1211'));
  recordEvent({ type: 'oppNoDisguise', side: 'self' });
  return { ok: !inst.sleeping && !!hir && match.turn.noDisguise.opponent === true, log, note: 'hirameki=' + JSON.stringify(hir) };
});

await scen('1216 漆黒の星(セット中): 相手ターンのコンタクトでパートナーエリアへ→リムーブされない', async () => {
  setup({ partner: partnerOf('白'), case: '1261', active: 'opponent', self: { field: ['1213'] }, opp: { field: [CARD_DATA.find(c => c.card_type === 'キャラ' && c.ap >= 6000 && numeric(c)).card_id] } });
  const host = instOf('self', '1213');
  host.under.push({ cardId: CID('1216'), uid: 'self-star', faceDown: false });
  const atk = match.opponent.field[0];
  startContact('opponent', atk.uid, 'self', host.uid, 'char', null);
  const log = await settle();
  const imm = contactState && (contactState.immuneUids || []).includes(host.uid);
  const moved = (match.self.partnerJewels || []).some(j => j.uid === 'self-star') && host.under.length === 0;
  clearUi();
  return { ok: !!imm && moved, log, note: 'imm=' + imm + ' moved=' + moved };
});
