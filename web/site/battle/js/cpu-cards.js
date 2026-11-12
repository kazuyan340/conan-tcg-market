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
const cpuLv = cardId => { const d = CARD_BY_ID.get(cardId); return d && d.level != null ? d.level : 99; };
Object.assign(window.CPU_CARD_RULES, {
  // 五人囃子: リムーブエリアにレベル4の少年探偵団が(名前違いで)そろってから使う
  '1185': { playScore: c => { const n = cpuDistinct(cpuShonen(c.me).filter(d => d.level === 4)); return n >= 3 ? 100 : n === 2 ? 70 : -1; } },
  // 結成 少年探偵団: 名前の違う少年探偵団が5枚そろってから出して、5枚重ねにする
  '0264': { playScore: c => { const n = cpuDistinct(cpuShonen(c.me)); return n >= 5 ? 95 : n === 4 ? 30 : -1; } },
  // 怪盗キッド(Lv8): 登場時にデッキを7枚リムーブ(肥やす)。少年探偵団がそろっていないうちに出す
  '0036': { playScore: c => c.me.deckPile.length < 10 ? -1 : cpuDistinct(cpuShonen(c.me)) < 5 ? 85 : 20 },
  // 怪盗キッド&黒羽快斗(Lv9): 宣言でデッキを5枚リムーブ(肥やす)
  '0547': { playScore: c => c.me.deckPile.length < 10 ? 30 : 80,
            declares: [{ line: 'デッキのカードを上から5枚リムーブ', when: c => c.me.deckPile.length >= 15 }] },   // 山札切れに注意して、15枚以上あるときだけ肥やす
  // 黒羽快斗(Lv7): 手札を1枚リムーブして、リムーブエリアのLv5以下の青白の高校生(中森青子など)を登場させる
  '1199': { playScore: c => { const ok = cpuRem(c.me).some(d => d.card_type === 'キャラ' && d.level <= 5 && cardHasTrait(d, '高校生') && /青|白/.test(d.color)); return ok && c.hand.length >= 2 ? 90 : 35; } },
  '1200': { playScore: () => 45 },
  '1171': { playScore: () => 50 },
  '1197': { playScore: () => 40 },
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
