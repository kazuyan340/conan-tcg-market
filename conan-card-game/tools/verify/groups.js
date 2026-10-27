const fs = require('fs');
global.window = global;
require(process.argv[2] + '/data/cards-data.js');
require(process.argv[2] + '/data/text-fixes.js');
const fl = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const kind = process.argv[4]; // entry | declare | fieldRemove | hirameki | error
const m = new Map();
const pt = l => (l.match(/^((?:【[^】]*】)*)/) || ['', ''])[1];
fl.filter(f => f.probs.some(p => p.startsWith(kind))).forEach(f => {
  const c = CARD_DATA.find(x => x.id === f.id);
  const lines = c.ability_text.replace(/\r/g, '').split('\n').map(l => l.trim()).filter(Boolean);
  let rel;
  if (kind === 'entry') rel = c.card_type === 'キャラ' ? lines.filter(l => pt(l).includes('【登場時】')) : lines.filter(l => !/^【(ヒラメキ|カットイン)】/.test(l) && !/^このイベントがセットされている/.test(l) && !/^このイベントを/.test(l));
  else if (kind === 'declare') rel = lines.filter(l => pt(l).includes('【宣言】'));
  else if (kind === 'fieldRemove') rel = lines.filter(l => pt(l).includes('【現場リムーブ時】'));
  else if (kind === 'hirameki') rel = lines.filter(l => pt(l).includes('【ヒラメキ】'));
  else rel = lines;
  const k = rel.join(' // ');
  if (!m.has(k)) m.set(k, []);
  m.get(k).push(f.id);
});
let i = 0;
for (const [k, v] of m) console.log((i++) + ' [' + v.join(',') + '] ' + k.slice(0, 380));
