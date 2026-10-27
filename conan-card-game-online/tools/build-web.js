// スマホ/ブラウザ用の公開版を web-build/ に書き出す(公開用に書き出す先)。
// 画像は含めない(カード画像は同梱せず、文字のカード表示になる)。デスクトップ版の
// 「画像設定」「画像フォルダ」は不要なので外す。使い方: node tools/build-web.js
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..');
const out = path.resolve(root, 'web-build');   // 公開リポジトリ(web/site)の外。置き場所が決まるまで、勝手に公開されない
require('./build-online.js');                       // online.html を最新にしてから取り込む

fs.rmSync(out, { recursive: true, force: true });
const copy = (rel) => {
  const dst = path.join(out, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(root, rel), dst);
};
['battle.html', 'deckbuilder.html', 'online.html', 'replays.html'].forEach(copy);
fs.readdirSync(path.join(root, 'css')).forEach(f => copy('css/' + f));
fs.readdirSync(path.join(root, 'js')).forEach(f => copy('js/' + f));
['cards-data.js', 'text-fixes.js', 'unimplemented-ids.js', 'image-names.js'].forEach(f => copy('data/' + f));

// メニュー: 画像設定(フォルダ選択)はブラウザ版では使えないので外す
let index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
index = index.replace(/\s*<div class="menu-card" onclick="location.href='images.html'">[\s\S]*?<\/div>\s*<\/div>/, '');
fs.writeFileSync(path.join(out, 'index.html'), index);
console.log('公開用フォルダを作りました:', out);
