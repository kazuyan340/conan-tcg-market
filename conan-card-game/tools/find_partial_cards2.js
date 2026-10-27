// 「実装済み」と判定されているカードのうち、効果文の一部しか実装されていないものを探して表示する。
// 検出ロジックは tools/partial_check.js。
//
// 使い方: conan-card-game ディレクトリで
//   node tools/find_partial_cards2.js            ... 一覧を表示
//   node tools/find_partial_cards2.js --json out.json
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
global.window = global;
require(path.join(ROOT, 'data', 'cards-data.js'));
require(path.join(ROOT, 'data', 'text-fixes.js'));
const { findPartialCards } = require('./partial_check.js');

const out = findPartialCards(window.CARD_DATA);
console.log(`対象: ${window.CARD_DATA.length}, 一部のみ実装の疑い: ${out.length}`);
const ji = process.argv.indexOf('--json');
if (ji !== -1) fs.writeFileSync(process.argv[ji + 1], JSON.stringify(out, null, 1));
else out.forEach(o => {
  console.log(`\n#${o.id} ${o.card_num} ${o.name}`);
  o.bad.forEach(b => console.log(`   ${b.line.slice(0, 100)}\n     └ ${b.miss.join(' | ').slice(0, 100)}`));
});
