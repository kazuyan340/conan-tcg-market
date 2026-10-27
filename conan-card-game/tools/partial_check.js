// 「効果文の一部しか実装されていないカード」を検出する共通モジュール。
//
// 方式：
//  1. battle.html からコメントを除いた「コード本体」を作り、正規表現の記号とキャプチャ部分を取り除く。
//  2. カードの効果文を文節(「、」「。」区切り)に分け、数字・［名前］・色タグ・キーワードを区切りにして
//     固定文言の断片にする。
//  3. どの断片も、コード本体に含まれなければ、その文節は実装されていないとみなす。
//
// ヒント検索なので、実際には実装済みなのに検出される(誤検出)ことがある。確認して問題なかったカードは
// tools/partial-verified.json (カードidの配列)に追加すると、検出対象から外れる。
// 使い方：
//   node tools/find_partial_cards2.js [--json out.json]   ... 検出結果を表示する
//   generate_unimplemented_ids.js が require して未実装一覧に加える

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const W = '§';

function loadCode() {
  let src = fs.readFileSync(path.join(ROOT, 'battle.html'), 'utf8');
  src = src.replace(/\/\*[\s\S]*?\*\//g, '');
  src = src.split('\n').map(l => l.replace(/^\s*\/\/.*$/, '').replace(/(^|[;{}),\s])\/\/ .*$/, '$1')).join('\n');
  return src;
}

// コード側：正規表現の記号とキャプチャを取り除き、固定文言だけが連続する形にする
function normCode(s) {
  const BS = '\\';
  return s
    .split(BS + 'n').join('')
    .replace(/\[\^[^\]]*\][+*?]?\??/g, W)           // [^］]+ 等のキャプチャ
    .split(BS + 'd+').join(W)                        // \d+
    .split(BS + 'd').join(W)
    .replace(/\$\{[^}]*\}/g, W)                      // テンプレート式
    .replace(/\(\?:|\)\?|\)\*|\)\+/g, '')
    .replace(/[()|^$?*+]/g, '')
    .split(BS).join('')
    .replace(/[\s　]/g, '');
}

// カード側：数字・［名前］・色タグ・キーワードを区切りにして、固定文言の断片に分ける
function fragmentsOf(clause) {
  return clause
    .replace(/[\s　]/g, '')
    .replace(/〚(?:カード名|特徴)?［[^］]*］〛/g, W)
    .replace(/［[^］]*］/g, W)
    .replace(/「[^」]*」/g, W)
    .replace(/【(?:赤|青|黄|緑|白|黒)(?:(?:＆|or)(?:赤|青|黄|緑|白|黒))*】/g, W)
    .replace(/〚(?:突撃|迅速|ブレット|捜査[X\d]*)(?:［[^］]*］)?〛/g, W)
    .replace(/\d+/g, W)
    .split(W)
    .map(f => f.replace(/^[、。・：]+|[、。・：]+$/g, ''))
    .filter(f => f.length >= 6);
}
function stripLine(line) {
  return line
    .replace(/[（(][^）)]*[）)]/g, '')   // 注釈
    .replace(/^(?:【[^】]*】)+/, '')      // 先頭のタグ
    .trim();
}
function clausesOf(line) {
  return stripLine(line).split('。').flatMap(sen => sen.split('、')).map(x => x.replace(/^[・\s]+/, '').trim()).filter(x => x.length >= 6);
}

function loadVerified() {
  try { return new Set(JSON.parse(fs.readFileSync(path.join(__dirname, 'partial-verified.json'), 'utf8'))); }
  catch (e) { return new Set(); }
}

// cardData: CARD_DATA の配列。戻り値: [{ id, card_num, name, type, bad: [{ line, miss: [...] }] }]
function findPartialCards(cardData, opts) {
  const o = opts || {};
  const code = normCode(loadCode());
  const verified = loadVerified();
  const covered = clause => fragmentsOf(clause).every(f => code.includes(f) || (f.length >= 9 && (code.includes(f.slice(1)) || code.includes(f.slice(0, -1)))));
  const out = [];
  for (const c of cardData) {
    if (!c.ability_text) continue;
    if (verified.has(c.id)) continue;
    if (o.skipIds && o.skipIds.has(c.id)) continue;
    const text = c.ability_text.replace(/\r/g, '');
    if (c.card_type === 'パートナー' && /事件解決/.test(text) && /アシスト/.test(text) && text.split('\n').length === 2) continue;
    const bad = [];
    text.split('\n').forEach(l => {
      const miss = clausesOf(l).filter(cl => !covered(cl));
      if (miss.length) bad.push({ line: l.trim(), miss });
    });
    if (bad.length) out.push({ id: c.id, card_num: c.card_num, name: c.name, type: c.card_type, bad });
  }
  return out;
}

module.exports = { findPartialCards };
