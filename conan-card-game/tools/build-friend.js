// 配布用(友達に渡す)ビルド: カード画像(公式の版権画像)を含めず、画像は各自のフォルダから読み込む版を作る。
// 元は自分用の版(このフォルダ)と同じソースで、次の点だけ変える:
//   ・data/images を含めない
//   ・js/image-mode.js を false にする(画像は「画像設定」で選んだフォルダから読む)
//   ・data/image-names.js(公式サイトの画像ファイル名の対応表)を作って入れる
// 使い方: node tools/build-friend.js        → build-friend/ に配布用のソースを作り、dist-friend/ に exe を作る
//        node tools/build-friend.js --no-pack  → build-friend/ だけ作る(exe は作らない)
const fs = require('fs'), path = require('path'), cp = require('child_process');
const root = path.resolve(__dirname, '..');
const stage = path.join(root, 'build-friend');
const out = path.join(root, 'dist-friend');
const noPack = process.argv.includes('--no-pack');

// 含めないもの(先頭一致。root からの相対パス)
const SKIP = ['node_modules', 'dist', 'dist-friend', 'build-friend', 'data/images', 'tools/online-test', 'tools/verify/scenario/.ud',
  'project_notes.md', 'claude_code_instructions.md', '.git'];
const skip = rel => SKIP.some(s => rel === s || rel.startsWith(s + '/')) || /(^|\/)data\/[^/]*bak_/.test(rel) || /\/\._/.test('/' + rel);

function copyTree(src, dst, rel){
  for (const name of fs.readdirSync(src)) {
    const r = rel ? rel + '/' + name : name;
    if (skip(r)) continue;
    const s = path.join(src, name), d = path.join(dst, name);
    const st = fs.statSync(s);
    if (st.isDirectory()) { fs.mkdirSync(d, { recursive: true }); copyTree(s, d, r); }
    else fs.copyFileSync(s, d);
  }
}

fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
copyTree(root, stage, '');
fs.writeFileSync(path.join(stage, 'js', 'image-mode.js'),
  '// 配布用ビルド: 画像はアプリに同梱せず、画像設定で選んだフォルダから読み込む\nwindow.BUNDLED_IMAGES = false;\n');
// 公式サイトの画像ファイル名の対応表(画像そのものは含めない)
const r = cp.spawnSync('python', [path.join(root, 'tools', 'build_image_names.py')], { cwd: root, encoding: 'utf8' });
if (r.status !== 0) { console.error('image-names.js の生成に失敗しました', r.stderr); process.exit(1); }
fs.copyFileSync(path.join(root, 'data', 'image-names.js'), path.join(stage, 'data', 'image-names.js'));
// 配布用では prepackage(online.html の生成)は済んでいるので外す
const pj = JSON.parse(fs.readFileSync(path.join(stage, 'package.json'), 'utf8'));
delete pj.scripts.prepackage;
fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify(pj, null, 2));
console.log('build-friend/ を作りました(画像なし)');

if (noPack) process.exit(0);
const electronVersion = require(path.join(root, 'node_modules', 'electron', 'package.json')).version;
const pack = cp.spawnSync(process.execPath, [path.join(root, 'node_modules', 'electron-packager', 'bin', 'electron-packager.js'), stage, 'ConanTCGViewer',
  '--platform=win32', '--arch=x64', '--out=' + out, '--overwrite', '--electron-version=' + electronVersion], { stdio: 'inherit' });
if (pack.status !== 0) process.exit(pack.status || 1);
console.log('配布用の exe:', path.join(out, 'ConanTCGViewer-win32-x64'));
