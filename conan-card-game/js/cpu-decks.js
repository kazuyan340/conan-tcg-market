// CPU対戦で、右側(CPU)が使えるデッキ(友達用の配布版にも入る)。
// かずやんが作ったデッキと、その使い方を Claude Code に伝えて、デッキごとにここへ足していく(AIの動かし方は js/cpu-cards.js)。
// 形は、デッキ作成で保存したデッキ1つ分と同じ: { id, name, partnerCardId, caseCardId, cards: [{ id, qty }] }
// registered: 登録日(例 '2026.11.13')。デッキ選択の下に薄灰色で出る。
// aiType: このデッキのAIタイプ(control / aggro / midrange)。省略すると、対戦画面で選んだタイプ。
window.CPU_PRESET_DECKS = [
  // 公式デッキコード WV5n7AFci(最初は Wax1Ojeec。2026.11.13に黒羽快斗・青子を抜いて、コナンLv5・妃英理・灰原Lv6を入れた)(パートナー: 怪盗キッド白 / 事件: コナンVS怪盗キッド)。AIタイプは仮
  { id: 'cpu-Wax1Ojeec', name: '青白探偵団', registered: '2026.11.13', aiType: 'control',
    // マリガン(仮): ①Lv2 ②Lv4 ③コナンLv5・灰原Lv6 ④Lv8のキッド(リムーブを肥やす) ⑤五人囃子・妃英理・Lv9キッド&快斗・結成・灰原Lv8
    mulligan: { priorities: [['0100', '0491', '0496', '0957'], ['0092', '1175', '1176', '1177'], ['0631', '0002'], ['0036', '1197'], ['1185', '0513', '0547', '0264', '1171']] },
    // 戦い方: アシストでFILE9→Lv9/8を1枚、ネクストヒントでFILE8→Lv8を1枚、ネクストヒントでFILE7→五人囃子か黒羽快斗(2展開)。FILEは6枚(パートナー込みで7)残す
    strategy: { nextHintKeep: 6, nextHintKeepLethal: 5, lethalGambleP: 0.5 },   // 勝ち筋のターンは、FILEを5枚まで切る(FILE5以上で出たレベル4の少年探偵団は突撃を持つ)
    partnerCardId: 67, caseCardId: 3018,
    cards: [{ id: 13, qty: 1 },{ id: 71, qty: 1 },{ id: 163, qty: 3 },{ id: 171, qty: 2 },{ id: 947, qty: 2 },{ id: 1167, qty: 2 },{ id: 1228, qty: 2 },{ id: 1238, qty: 2 },{ id: 1242, qty: 3 },{ id: 1249, qty: 1 },{ id: 1502, qty: 3 },{ id: 2406, qty: 1 },{ id: 2864, qty: 3 },{ id: 2871, qty: 3 },{ id: 2873, qty: 3 },{ id: 2875, qty: 3 },{ id: 2887, qty: 3 },{ id: 2911, qty: 2 }] },
];
