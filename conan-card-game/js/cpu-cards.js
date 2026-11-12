// CPUのカード別の動かし方。デッキに入れたカードを増やすたびに、ここへ1枚ずつ足していく。
// 書いていないカードは、js/cpu-player.js の汎用の動き(レベルの高い順に出す・「する」を選ぶ・先頭を選ぶ)になる。
//
// キーはカードID(card_id。例: '0393')。値に書ける項目(すべて省略可):
//   playScore(ctx)         手札から出す優先度(大きいほど先に出す。負なら出さない)。ctx = { card, hand, field, foeField, turn }
//   choose(ctx, items)     このカードの効果で開く選択画面での選び方。選ぶキーの配列を返す(返さなければ汎用)。
//                          ctx = { sourceCardId, hint, min, max }  items = 選べる候補 [{ key, label, cardId }]
//   noAction: true         このキャラではアクションしない(推理だけする)
//   noReason: true         このキャラでは推理しない
// 例:
//   '0393': { playScore: c => 10 },                                  // ウォッカは最優先で出す
//   '0365': { choose: (ctx, items) => items.filter(i => i.key === 'yes').map(i => i.key) },
window.CPU_CARD_RULES = {
};

// ---- 青白探偵団(公式デッキコード Wax1Ojeec)の動かし方 ----
// 狙い: Lv9 怪盗キッド&黒羽快斗・Lv8 怪盗キッドでリムーブを肥やし、Lv8 結成 少年探偵団を5枚重ねにする。
//       Lv7 五人囃子・Lv7 黒羽快斗で、毎ターン4展開する。4展開したら、いちばんレベルの低い自分のキャラをリムーブして
//       事件(コナンVS怪盗キッド)の効果を起動し、相手の現場を減らす(相手の現場が空なら、相手の手札を減らす)。
const cpuRem = me => me.remove.map(c => CARD_BY_ID.get(c.cardId)).filter(Boolean);
const cpuShonen = me => cpuRem(me).filter(d => d.card_type === 'キャラ' && cardHasTrait(d, '少年探偵団'));
const cpuDistinct = list => new Set(list.map(d => d.name)).size;
const ruleOf2 = cardId => { const d = CARD_BY_ID.get(cardId); return d && window.CPU_CARD_RULES[String(d.card_id)]; };
const cpuLv = cardId => { const d = CARD_BY_ID.get(cardId); return d && d.level != null ? d.level : 99; };
// 出す優先度は「レベル×10＋好み」。FILEエリアの枚数がネクストヒントのたびに減るので、レベルの高いカードから先に出す(Lv9→Lv8→Lv7)。条件に合わないときは -1(出さない)。
Object.assign(window.CPU_CARD_RULES, {
  // 怪盗キッド&黒羽快斗(Lv9): 宣言でデッキを5枚リムーブ(肥やす)
  '0547': { playScore: c => c.me.deckPile.length < 10 ? 91 : 99,
            removesFoe: ctx => ctx.me.deckPile.length >= 15 ? 1 : 0, choose: (ctx, items) => cpuPickFoeActive(ctx, items),
            declares: [{ line: 'デッキのカードを上から5枚リムーブ', when: c => c.me.deckPile.length >= 15 }] },   // 山札切れに注意して、15枚以上あるときだけ肥やす
  // 結成 少年探偵団(Lv8): 名前の違う少年探偵団が5枚そろってから出して、5枚重ねにする
  // stackCharge: 登場時に下へ重ねる枚数(リムーブエリアの名前違いの少年探偵団、最大5)。1枚以上で突撃、5枚で「アクションしたとき証拠を1つ得る」(ガードされても得られる)
  '0264': { stackCharge: me => Math.min(5, cpuDistinct(cpuShonen(me))), playScore: c => { const n = cpuDistinct(cpuShonen(c.me)); return n >= 5 ? 88 : n === 4 ? 82 : -1; },
            // 重ねるカードは、五人囃子で使うレベル4をなるべく残して、レベルの低いものから選ぶ
            choose: (ctx, items) => items.length ? [[...items].sort((x, y) => ((cpuLv(x.cardId) === 4) - (cpuLv(y.cardId) === 4)) || (cpuLv(x.cardId) - cpuLv(y.cardId)))[0].key] : null },
  // 怪盗キッド(Lv8): 登場時にデッキを7枚リムーブ(肥やす)。少年探偵団がそろっていないうちに出す
  '0036': { playScore: c => c.me.deckPile.length < 10 ? -1 : cpuDistinct(cpuShonen(c.me)) < 5 ? 86 : 81,
            removesFoe: (ctx, planned) => planned && ctx.me.deckPile.length >= 10 ? 1 : 0, choose: (ctx, items) => cpuPickFoeActive(ctx, items) },
  // 怪盗キッド(Lv8): 宣言で相手のキャラをスリープさせる(お互いの証拠が合わせて5つ以上のとき)
  '1197': { playScore: () => 80, removesFoe: ctx => ctx.me.evidence.length + ctx.foe.evidence.length >= 5 ? 1 : 0 },
  // 灰原哀(Lv8): 自分ターン中、レベル4の少年探偵団が登場したとき(ターン1)、AP8000以下のキャラをリムーブ
  '1171': { playScore: () => 83, removesFoe: ctx => ctx.willEnterLv4 ? 1 : 0, choose: (ctx, items) => cpuPickFoeActive(ctx, items) },
  // 五人囃子(Lv7): リムーブエリアにレベル4の少年探偵団が(名前違いで)そろってから使う
  '1185': { entersLv4: true, playScore: c => { const n = cpuDistinct(cpuShonen(c.me).filter(d => d.level === 4)); return n >= 3 ? 79 : n === 2 ? 74 : -1; } },
  // 黒羽快斗(Lv7): 手札を1枚リムーブして、リムーブエリアのLv5以下の青白の高校生(中森青子など)を登場させる
  '1199': { // 現場に探偵(コナン)がいて、リムーブする手札がある。復活させる青子は、リムーブエリアにいるか、コストで手札の青子を捨てて(リムーブエリアに入れて)用意する
            summonsCharger: ctx => ctx.others.length >= 1 && ctx.chars.some(c => cardHasTrait(defOfInst(c), '探偵')) && (cpuRem(ctx.me).some(d => d.card_id === '1200') || ctx.others.some(h => (CARD_BY_ID.get(h.cardId) || {}).card_id === '1200')),
            // リムーブする手札: リムーブエリアに青子がいなければ、(出す予定でない)手札の青子を捨てて、復活させる。いれば、突撃を持たないカードのうちレベルの低いものを捨てる
            choose: (ctx, items) => {
              const hand = items.filter(i => match.opponent.hand.some(h => h.uid === i.key)); if (!hand.length) return null;
              const planned = (window.cpuPlayer && window.cpuPlayer.lastPlan) || [];
              const isAoko = i => (CARD_BY_ID.get(i.cardId) || {}).card_id === '1200';
              if (!cpuRem(match.opponent).some(d => d.card_id === '1200')) { const a = hand.find(i => isAoko(i) && !planned.includes(i.key)) || hand.find(isAoko); if (a) return [a.key]; }
              const charge = i => (ruleOf2(i.cardId) || {}).lethalCharge ? 1 : 0;
              return [[...hand].sort((x, y) => (charge(x) - charge(y)) || (cpuLv(x.cardId) - cpuLv(y.cardId)))[0].key];
            },
            playScore: c => { const ok = cpuRem(c.me).some(d => d.card_type === 'キャラ' && d.level <= 5 && cardHasTrait(d, '高校生') && /青|白/.test(d.color)); return ok && c.hand.length >= 2 ? 78 : 71; } },
  // 中森青子(Lv5): 事件が青白でパートナーが白のとき、通常の突撃(事件にもアクションできる)を持つ。FILE5でも出せるので、勝ち筋の最後の枠で出す
  '1200': { lethalCharge: true, playScore: c => c.lethal ? 5 : 50 },
});
// ---- コンタクト中に手札から使うカード(アクションで勝てないとき) ----
//   contactCutIn(ctx) / contactDisguise(ctx): true なら使う。ctx = { me, foe, actor(自分の攻撃キャラ), tgt(相手のキャラ), myAp, foeAp }
const cpuLv4Names = (field, excludeUid) => new Set(field.filter(c => c.uid !== excludeUid).map(c => defOfInst(c)).filter(d => d && d.level === 4 && cardHasTrait(d, '少年探偵団')).map(d => d.name)).size;
const cpuTgtLv = ctx => { const d = defOfInst(ctx.tgt); return d && d.level != null ? d.level : 0; };
const cpuHoldForContact = c => cpuLv4Names(c.me.field) >= 2 && c.foeField.some(f => f.sleeping);
// カットインで「コンタクト中のキャラ」を選ぶ画面: 相手のキャラ(self-)を選ぶ。自分のキャラは選ばない
const cpuChooseFoeContact = (ctx, items) => { const foe = items.filter(i => String(i.key).startsWith('self-')); return foe.length ? [foe[0].key] : []; };
Object.assign(window.CPU_CARD_RULES, {
  // 小嶋元太(Lv4): 自分の現場にレベル4の名前違いの少年探偵団が2枚以上いれば、コンタクト中のレベル8以上のキャラをリムーブして1枚引く
  // 手札に残す: 条件がそろっていて(場にレベル4の名前違いが2枚以上)、相手にスリープ状態のキャラがいるときは、コンタクト用に出さずに持っておく
  '1176': { playScore: c => cpuHoldForContact(c) ? -1 : 4, contactCutIn: ctx => cpuLv4Names(ctx.me.field) >= 2 && cpuTgtLv(ctx) >= 8, choose: cpuChooseFoeContact },
  // 円谷光彦(Lv4): 同じ条件で、コンタクト中のレベル7以下のキャラをリムーブして1枚引く
  '1177': { playScore: c => cpuHoldForContact(c) ? -1 : 4, contactCutIn: ctx => cpuLv4Names(ctx.me.field) >= 2 && cpuTgtLv(ctx) <= 7, choose: cpuChooseFoeContact },
  // 吉田歩美(Lv4): 変装で攻撃キャラと入れ替わる。入れ替え後に名前違いのレベル4少年探偵団が3枚以上そろえば、レベル7以下のスリープ状態のキャラをリムーブして1枚引く
  // (勝ち筋: 事件にもアクションできる突撃を持つのは、FILE5以上で出た歩美と、中森青子。元太・光彦の突撃は［キャラ］限定なので、事件には行けない)
  // 先攻3ターン目: 相手が全部アクティブで、FILE5以上なら、歩美を出して事件へ突撃する
  '1175': { lethalCharge: true, chargeMinFile: 5, playScore: c => c.lethal ? 5 : (c.open === 3 && c.foeField.length && c.foeField.every(f => !f.sleeping) && getEffectiveFileCount('opponent') >= 5) ? 60 : cpuHoldForContact(c) ? -1 : 4, contactDisguise: ctx => ctx.tgt.sleeping && cpuTgtLv(ctx) <= 7 && new Set([...ctx.me.field.filter(c => c.uid !== ctx.actor.uid).map(c => defOfInst(c)).filter(d => d && d.level === 4 && cardHasTrait(d, '少年探偵団')).map(d => d.name), '吉田歩美']).size >= 3 },
});

// 相手のキャラを選んで除去する効果の選び方: 相手の「アクティブ(ガードできる)」キャラを優先し、そのなかでAPの高いものを選ぶ。自分のキャラは選ばない
const cpuPickFoeActive = (ctx, items) => {
  if (!/AP8000以下|リムーブ|デッキの下|スリープ/.test(String(ctx.hint || ''))) return null;
  const foe = items.filter(i => String(i.key).startsWith('self-'));
  if (!foe.length) return null;
  const inst = i => match.self.field.find(f => f.uid === i.key);
  foe.sort((a, b) => (((inst(a) || {}).sleeping ? 1 : 0) - ((inst(b) || {}).sleeping ? 1 : 0)) || (effectiveAp(match, inst(b), 'self') - effectiveAp(match, inst(a), 'self')));
  return [foe[0].key];
};
// ---- 2026.11.13 に入れたカード(コナンLv5・妃英理・灰原哀Lv6) ----
const cpuHandOf = (me, cardId) => me.hand.find(h => (CARD_BY_ID.get(h.cardId) || {}).card_id === cardId);
Object.assign(window.CPU_CARD_RULES, {
  // 江戸川コナン(Lv5): 【解決編】突撃(事件にもアクションできる)。登場時にデッキを1枚リムーブして、リムーブエリアの探偵・少年探偵団を2枚まで下に重ねる(AP＋1000ずつ)
  '0631': { lethalCharge: true, playScore: c => c.lethal ? 5 : 55 },
  // 妃英理(Lv7): 登場時に自分をスリープして、手札のレベル6以下の毛利探偵事務所のキャラ(コナンLv5など)を1枚登場させて1枚引く。勝ち筋では、手札のコナンLv5を登場させる(突撃)
  '0513': { playScore: c => (cpuHandOf(c.me, '0631') || cpuHandOf(c.me, '0092')) ? 77 : 20,
            summonsCharger: ctx => ctx.others.find(h => (CARD_BY_ID.get(h.cardId) || {}).card_id === '0631') || null,
            choose: (ctx, items) => { const hand = items.filter(i => match.opponent.hand.some(h => h.uid === i.key)); const k = hand.find(i => (CARD_BY_ID.get(i.cardId) || {}).card_id === '0631') || hand[0]; return k ? [k.key] : null; } },
  // 灰原哀(Lv6): 宣言(スリープ)で、手札のレベル5以下の少年探偵団のキャラを1枚登場させる。突撃のコナンLv5や歩美を優先する
  // summonsAnyFile: 宣言がFILE枚数に関係なく使える(FILE0でも)。summonTarget: 宣言で登場させられるカード
  '0002': { summonsAnyFile: true, summonTarget: d => d.level <= 5 && cardHasTrait(d, '少年探偵団'), playScore: c => (c.open >= 3 && c.open <= 4 && c.hand.some(h => ['0631', '0092'].includes((CARD_BY_ID.get(h.cardId) || {}).card_id))) ? 95 : c.hand.some(h => { const d = CARD_BY_ID.get(h.cardId); return d && d.card_type === 'キャラ' && d.level <= 5 && cardHasTrait(d, '少年探偵団'); }) ? 66 : 15,
            // 歩美の突撃はFILE5以上で出たときだけ(ctx.file はそのときのFILE枚数)
            summonsCharger: ctx => ctx.others.find(h => (CARD_BY_ID.get(h.cardId) || {}).card_id === '0631') || (ctx.file >= 5 ? ctx.others.find(h => (CARD_BY_ID.get(h.cardId) || {}).card_id === '1175') : null) || null,
            // 勝ち筋でコナンを引きにいっている間は、突撃を持つ登場候補(コナンLv5・歩美)が手札に来るまで宣言を取っておく
            declares: [{ line: 'レベル5以下の〚特徴［少年探偵団］〛のキャラを1枚まで登場', when: c => c.me.hand.some(h => { const d = CARD_BY_ID.get(h.cardId); return d && d.card_type === 'キャラ' && d.level <= 5 && cardHasTrait(d, '少年探偵団') && (!(window.cpuPlayer && window.cpuPlayer.drawing) || (((window.CPU_CARD_RULES[String(d.card_id)] || {}).lethalCharge) && getEffectiveFileCount('opponent') >= ((window.CPU_CARD_RULES[String(d.card_id)] || {}).chargeMinFile || 0))); }) }],
            choose: (ctx, items) => { const hand = items.filter(i => match.opponent.hand.some(h => h.uid === i.key)); if (!hand.length) return null; const fileNow = getEffectiveFileCount('opponent'); const pri = i => { const id = (CARD_BY_ID.get(i.cardId) || {}).card_id; return id === '0631' ? 0 : id === '0092' ? 0.5 : id === '1175' && fileNow >= 5 ? 1 : id === '1175' ? 3 : 2; }; return [[...hand].sort((x, y) => pri(x) - pri(y) || cpuLv(y.cardId) - cpuLv(x.cardId))[0].key]; } },
});
// 事件「コナンVS怪盗キッド」: 4展開したら宣言する。選択は、自分のいちばんレベルの低いキャラをリムーブ → 相手の現場のキャラ(レベルの高い順)を手札に戻す
window.CPU_CARD_RULES['1261'] = {
  useCaseDeclare: ctx => ctx.entered >= 4,
  choose: (ctx, items) => {
    const h = String(ctx.hint || '');
    const own = items.filter(i => String(i.key).startsWith('opponent-')), foe = items.filter(i => String(i.key).startsWith('self-'));
    if (/自分の現場にいるキャラを1枚リムーブしてもよい/.test(h)) return ['yes'];
    if (/キャラを1枚選び、リムーブ/.test(h) && own.length) return [own.sort((a, b) => cpuLv(a.cardId) - cpuLv(b.cardId))[0].key];
    if (/手札に移/.test(h)) return foe.length ? [foe.sort((a, b) => cpuLv(b.cardId) - cpuLv(a.cardId))[0].key] : [];
    return null;
  },
};

// AIタイプ(対戦画面の「CPU対戦(仮)」で選ぶ)。タイプごとに、マリガンと動きの傾向を変える。
//   mulligan.levelTiers   優先度①〜⑤を、キャラのレベルで書く([[2],[4],[6],[8],[7]] なら ①Lv2 ②Lv4 ③Lv6 ④Lv8 ⑤Lv7)
//   mulligan.priorities   優先度①〜⑤を、card_id で書く(書いたら levelTiers より優先)。例: [['0085'], ['0393'], ['0365', '0473'], ['0602'], ['0823']]
//   attackUnwinnable      勝てない相手(APが上)のスリープキャラにもアクションするか(アグロは true)
//   reasonFirst           アクションより推理(証拠集め)を優先するか
// マリガンの考え方: https://note.com/kessy456/n/nc27da5360327
//   ルール1: ①があれば、手札の①〜⑤を各1枚残す
//   ルール2: ①がなく、②があり、③〜⑤が1枚以上あれば、優先度の高い2枚を残す
//   ルール3: ④以下しかなければ、全部引き直す
//   ルール4: 上記以外は、最も優先度の高い1枚を残す
window.CPU_AI_TYPES = {
  control: {   // コントロール: 先攻の理想の初手は Lv2,4,6,8,7 のキャラ1枚ずつ(1〜4ターン目に出すカードがそろう)
    label: 'コントロール',
    mulligan: { priorities: [], levelTiers: [[2], [4], [6], [8], [7]] },
    attackUnwinnable: false, reasonFirst: false,
  },
  aggro: {     // アグロ: 軽いキャラを早く並べて殴る(仮の値。デッキに合わせて直す)
    label: 'アグロ',
    mulligan: { priorities: [], levelTiers: [[2], [3], [4], [5], [6]] },
    attackUnwinnable: true, reasonFirst: false,
  },
  midrange: {  // ミッドレンジ: 中くらいのキャラで場を作る(仮の値。デッキに合わせて直す)
    label: 'ミッドレンジ',
    mulligan: { priorities: [], levelTiers: [[2], [4], [5], [6], [7]] },
    attackUnwinnable: false, reasonFirst: false,
  },
};
