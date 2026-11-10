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

// マリガン(初手の引き直し)。CPUのデッキで「初手に来てほしいカード」を、優先度①〜⑤の順に card_id で並べる。
// 参考: https://note.com/kessy456/n/nc27da5360327
//   ルール1: ①があれば、手札の①〜⑤を各1枚残す
//   ルール2: ①がなく、②があり、③〜⑤が1枚以上あれば、優先度の高い2枚を残す
//   ルール3: ④以下しかなければ、全部引き直す
//   ルール4: 上記以外は、最も優先度の高い1枚を残す
// priorities[0] が優先度①、[1] が②…(各段に複数のカードを書いてよい。同じ段のカードは1枚として数える)。
// 空のままなら、レベルの低いキャラほど高い優先度とみなす。
// 例: window.CPU_MULLIGAN = { priorities: [['0085'], ['0393'], ['0365', '0473'], ['0602'], ['0823']] };
window.CPU_MULLIGAN = { priorities: [] };
