// online.template.html の <!--BATTLE_MARKUP--> に、battle.html の盤面HTML
// (<!--ENGINE_MARKUP_START--> 〜 <!--ENGINE_MARKUP_END-->)を取り込んで online.html を作る。
// battle.html の盤面を変えたときは、これを再実行する(npm run package の前にも自動で走る)。
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..');
const battle = fs.readFileSync(path.join(root, 'battle.html'), 'utf8');
const m = battle.match(/<!--ENGINE_MARKUP_START-->([\s\S]*?)<!--ENGINE_MARKUP_END-->/);
if (!m) { console.error('battle.html に ENGINE_MARKUP の目印がありません'); process.exit(1); }
let markup = m[1].replace('🔍 対戦（手動プレイ）', '🌐 オンライン対戦');
const tpl = fs.readFileSync(path.join(root, 'online.template.html'), 'utf8');
if (!tpl.includes('<!--BATTLE_MARKUP-->')) { console.error('テンプレートに BATTLE_MARKUP がありません'); process.exit(1); }
fs.writeFileSync(path.join(root, 'online.html'), tpl.replace('<!--BATTLE_MARKUP-->', () => markup));
console.log('online.html を作りました');
