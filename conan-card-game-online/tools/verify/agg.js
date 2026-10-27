const fs = require('fs');
const sp = process.argv[2];
let all = [];
for (let i = 0; i < 4; i++) {
  const t = fs.readFileSync(sp + '/vout' + i + '.txt', 'utf8');
  const m = t.match(/VERIFY_JSON (.*)/);
  if (!m) { console.log('no out', i, t.slice(-300)); continue; }
  all = all.concat(JSON.parse(m[1]).out.flagged);
}
fs.writeFileSync(sp + '/' + (process.argv[3] || 'flagged_new.json'), JSON.stringify(all));
const cnt = {};
all.forEach(f => f.probs.forEach(p => { const k = p.split(':')[0]; cnt[k] = (cnt[k] || 0) + 1; }));
console.log(all.length, JSON.stringify(cnt));
