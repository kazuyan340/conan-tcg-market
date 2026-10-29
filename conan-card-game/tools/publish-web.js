// スマホのブラウザで遊べるよう、画像なしの版を web/site/battle/ に入れる(GitHub Pages で公開される)。
// 使い方: node tools/publish-web.js   → build-friend を作り直し、web/site/battle/ へコピーする。そのあと commit & push すると公開される。
// 公開されるのは画像なしの版だけ(公式の版権画像は含まない)。
const fs = require('fs'), path = require('path'), cp = require('child_process');
const root = path.resolve(__dirname, '..');
const stage = path.join(root, 'build-friend');
const dest = path.resolve(root, '..', 'web', 'site', 'battle');

const r = cp.spawnSync(process.execPath, [path.join(__dirname, 'build-friend.js'), '--no-pack'], { cwd: root, stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status || 1);

// ブラウザでは使わないもの(アプリ本体・ビルド用)
const SKIP = ['main.js', 'preload.js', 'package.json', 'package-lock.json', 'tools', 'online.template.html'];
fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
(function copy(src, dst, rel){
  for (const name of fs.readdirSync(src)) {
    const rr = rel ? rel + '/' + name : name;
    if (SKIP.includes(rr)) continue;
    const s = path.join(src, name), d = path.join(dst, name);
    if (fs.statSync(s).isDirectory()) { fs.mkdirSync(d, { recursive: true }); copy(s, d, rr); }
    else fs.copyFileSync(s, d);
  }
})(stage, dest, '');
// スマホのブラウザが古い js/css を使い続けないよう、html から読み込むファイルに公開のたびに変わる印(?v=)を付ける
const ver = Date.now().toString(36);
for (const f of fs.readdirSync(dest).filter(n => n.endsWith('.html'))) {
  const fp = path.join(dest, f);
  const h = fs.readFileSync(fp, 'utf8').replace(/(<script[^>]*\ssrc="|<link[^>]*\shref=")((?:js|css|data)\/[^"?]+)"/g, '$1$2?v=' + ver + '"');
  fs.writeFileSync(fp, h);
}
console.log('web/site/battle/ に入れました:', dest);
