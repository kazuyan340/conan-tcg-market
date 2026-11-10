// CPU対戦で、右側(CPU)が使えるデッキ(友達用の配布版にも入る)。
// かずやんが作ったデッキと、その使い方を Claude Code に伝えて、デッキごとにここへ足していく(AIの動かし方は js/cpu-cards.js)。
// 形は、デッキ作成で保存したデッキ1つ分と同じ: { id, name, partnerCardId, caseCardId, cards: [{ id, qty }] }
// aiType: このデッキのAIタイプ(control / aggro / midrange)。省略すると、対戦画面で選んだタイプ。
window.CPU_PRESET_DECKS = [];
