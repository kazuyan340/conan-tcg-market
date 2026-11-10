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
const SKIP = ['data/cpu-decks.js', 'js/cpu-player.js', 'js/cpu-cards.js', 'main.js', 'preload.js', 'package.json', 'package-lock.json', 'tools', 'online.template.html'];
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
// スマホ版はリプレイ機能なし・ホーム画面はデッキ作成とオンライン対戦だけ(PC版は元のまま)
for (const f of ['battle.html', 'board.html', 'replays.html', 'images.html']) fs.rmSync(path.join(dest, f), { force: true });
fs.writeFileSync(path.join(dest, 'index.html'), `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>名探偵コナンTCG 対戦シミュレータ</title>
<style>
  *{box-sizing:border-box; margin:0; padding:0;}
  body{ font-family:'Zen Kaku Gothic New','Hiragino Sans',sans-serif; color:#fff; min-height:100vh;
    background:linear-gradient(180deg, #2c3550 0%, #232a42 38%, #3a3226 60%, #4a3d28 100%);
    display:flex; flex-direction:column; align-items:center; justify-content:center; gap:28px; padding:24px 16px; }
  h1{ font-size:22px; letter-spacing:.05em; text-align:center; text-shadow:0 3px 10px rgba(0,0,0,.4); line-height:1.4; }
  .menu{ display:flex; flex-direction:column; gap:16px; width:100%; max-width:380px; }
  a.menu-card{ display:flex; align-items:center; gap:16px; padding:20px 18px; border-radius:18px; text-decoration:none; color:#fff;
    background:rgba(255,255,255,.1); border:2px solid rgba(255,255,255,.28); box-shadow:0 8px 20px rgba(0,0,0,.35); }
  a.menu-card:active{ background:rgba(255,255,255,.2); }
  .icon{ font-size:40px; }
  .label{ font-size:19px; font-weight:800; }
  .desc{ font-size:12px; opacity:.75; margin-top:4px; line-height:1.5; }
</style>
</head>
<body>
  <h1>🔍 DETECTIVE CONAN<br>CARD GAME</h1>
  <div class="menu">
    <a class="menu-card" href="deckbuilder.html"><div class="icon">🛠️</div><div><div class="label">デッキ作成</div><div class="desc">カードを選んでデッキを組む</div></div></a>
    <a class="menu-card" href="online.html"><div class="icon">🌐</div><div><div class="label">オンライン対戦</div><div class="desc">同じパスを入れて友達と対戦(縦向き画面)</div></div></a>
  </div>
</body>
</html>
`);
// オンライン画面のリプレイ(読み込み・保存)の表示を消す
{
  const fp = path.join(dest, 'online.html');
  let h = fs.readFileSync(fp, 'utf8');
  h = h.replace('</head>', '<style>#replayFileInput, .file-row, #gameOverSaveBtn, #gameOverReplayHint{ display:none !important; }</style></head>');
  h = h.replace(/<div class="divider">または<\/div>/, '<div class="divider" style="display:none">または</div>');
  h = h.replace(/<div class="setup-hint" style="text-align:center;">保存済みのリプレイファイル[^<]*<\/div>/, '');
  h = h.replace(/<p class="mulligan-hint">対戦を保存しますか？[^<]*<\/p>/, '<p class="mulligan-hint" id="gameOverReplayHint"></p>');
  fs.writeFileSync(fp, h);
}
// スマホのブラウザが古い js/css を使い続けないよう、html から読み込むファイルに公開のたびに変わる印(?v=)を付ける
const ver = Date.now().toString(36);
for (const f of fs.readdirSync(dest).filter(n => n.endsWith('.html'))) {
  const fp = path.join(dest, f);
  const h = fs.readFileSync(fp, 'utf8').replace(/(<script[^>]*\ssrc="|<link[^>]*\shref=")((?:js|css|data)\/[^"?]+)"/g, '$1$2?v=' + ver + '"');
  fs.writeFileSync(fp, h);
}
console.log('web/site/battle/ に入れました:', dest);
