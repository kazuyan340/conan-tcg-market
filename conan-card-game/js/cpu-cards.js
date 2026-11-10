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
