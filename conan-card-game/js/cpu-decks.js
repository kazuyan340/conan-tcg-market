// CPU対戦で、右側(CPU)が使えるデッキ(友達用の配布版にも入る)。
// かずやんが作ったデッキと、その使い方を Claude Code に伝えて、デッキごとにここへ足していく(AIの動かし方は js/cpu-cards.js)。
// 形は、デッキ作成で保存したデッキ1つ分と同じ: { id, name, partnerCardId, caseCardId, cards: [{ id, qty }] }
// registered: 登録日(例 '2026.11.13')。デッキ選択の下に薄灰色で出る。
// aiType: このデッキのAIタイプ(control / aggro / midrange)。省略すると、対戦画面で選んだタイプ。
window.CPU_PRESET_DECKS = [
  // 公式デッキコード Wax1Ojeec(パートナー: 怪盗キッド白 / 事件: コナンVS怪盗キッド)。AIタイプは仮
  { id: 'cpu-Wax1Ojeec', name: '青白探偵団', registered: '2026.11.13', partnerCardId: 67, caseCardId: 3018,
    cards: [{ id: 171, qty: 2 },{ id: 1228, qty: 2 },{ id: 1238, qty: 2 },{ id: 2406, qty: 1 },{ id: 947, qty: 2 },{ id: 163, qty: 3 },{ id: 2871, qty: 3 },{ id: 2873, qty: 3 },{ id: 2875, qty: 3 },{ id: 2918, qty: 3 },{ id: 2887, qty: 3 },{ id: 2916, qty: 2 },{ id: 71, qty: 1 },{ id: 1242, qty: 3 },{ id: 2864, qty: 3 },{ id: 2911, qty: 2 },{ id: 1167, qty: 2 }] },
];
