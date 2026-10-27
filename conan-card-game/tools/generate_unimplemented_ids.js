// battle.htmlの中の「カード効果を判定している正規表現／文字列チェック」を
// ソースから自動抽出し、全カードの ability_text を照らし合わせて、
// 「どの行にもマッチが見つからなかったカード」を data/unimplemented-ids.json に書き出す。
//
// あくまでヒューリスティック(ヒント検索)であり、完璧な判定ではない:
// - マッチが見つかれば「実装済みの可能性が高い」というだけで、本当に正しく動くかは保証しない
// - 逆に見つからなくても、同じ効果を少し違う書き方で判定しているコードがあれば誤検出になりうる
// 新しいカード効果を実装するたびに `node tools/generate_unimplemented_ids.js` を再実行すること。
//
// 使い方: conan-card-game ディレクトリで `node tools/generate_unimplemented_ids.js`

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BATTLE_HTML = path.join(ROOT, 'battle.html');
const CARDS_DATA = path.join(ROOT, 'data', 'cards-data.js');
const OUT_PATH = path.join(ROOT, 'data', 'unimplemented-ids.js');

global.window = global;
require(CARDS_DATA);
require(path.join(ROOT, 'data', 'text-fixes.js'));
const CARD_DATA = window.CARD_DATA;

const src = fs.readFileSync(BATTLE_HTML, 'utf8');

// ---- 1. battle.html からパターンを抜き出す ----
const regexLiterals = [];
function extractRegexLiteralsAfter(marker) {
  let idx = 0;
  while (true) {
    const pos = src.indexOf(marker, idx);
    if (pos === -1) break;
    let i = pos + marker.length;
    while (/\s/.test(src[i] || '')) i++;
    if (src[i] !== '/') { idx = pos + marker.length; continue; }
    const start = i;
    i++;
    let inClass = false;
    while (i < src.length) {
      const ch = src[i];
      if (ch === '\\') { i += 2; continue; }
      if (ch === '[') inClass = true;
      else if (ch === ']') inClass = false;
      else if (ch === '/' && !inClass) break;
      i++;
    }
    const end = i;
    let j = end + 1;
    while (/[a-z]/.test(src[j] || '')) j++;
    regexLiterals.push(src.slice(start, j));
    idx = j;
  }
}
extractRegexLiteralsAfter('.match(');
extractRegexLiteralsAfter('re: ');
extractRegexLiteralsAfter(' = '); // const re = /pattern/; style
extractRegexLiteralsAfter('.test('); // /pattern/.test(text) は逆順なので拾えないが、test(/pattern/) 形式は拾う
// /pattern/.test(...) の形式(正規表現が先に来る)も拾う
{
  const testRe = /(\/(?:\\.|\[(?:\\.|[^\]\\])*\]|[^\/\\\n\[])+\/[a-z]*)\.test\(/g;
  let tm;
  while ((tm = testRe.exec(src))) regexLiterals.push(tm[1]);
}

const includeStrings = [];
const incRe = /\.includes\(\s*(['"])((?:\\.|(?!\1).)*)\1\s*\)/g;
let m;
while ((m = incRe.exec(src))) includeStrings.push(m[2]);
const eqRe = /===\s*(['"])((?:\\.|(?!\1).)*?)\1/g;
while ((m = eqRe.exec(src))) {
  if (/[　-ヿ一-鿿]/.test(m[2])) includeStrings.push(m[2]);
}
// Drop bracket-tag-only strings (condition gates, not effect proof)
const filteredIncludeStrings = includeStrings.filter(
  s => s.replace(/(?:【[^】]*】|〚[^〛]*〛)/g, '').trim().length > 0
);

// ---- 2. 正規表現をコンパイル(「残り全部キャプチャ」系の検出専用パターンは除外) ----
const CATCHALL_TAIL = /\(\.[*+]\)\$?$|\(\[\^\\n\]\*\)\$?$/;
const compiledLine = [];
const compiledFull = [];
for (const lit of regexLiterals) {
  const mm = lit.match(/^\/(.*)\/([a-z]*)$/s);
  if (!mm) continue;
  let [, body, flags] = mm;
  if (CATCHALL_TAIL.test(body)) continue;
  const lineFlags = flags.replace('g', '');
  try {
    compiledLine.push(new RegExp(body, lineFlags));
    compiledFull.push(new RegExp(body, flags.includes('g') ? flags : flags + 'g'));
  } catch (e) { /* skip unparsable */ }
}

const PARTNER_BASE_TEXT =
  '【解決編】【事件解決】【スリープ】：自分の証拠が事件レベルの数以上ある場合、ゲームに勝利する。\n' +
  '【アシスト】【スリープ】：FILEエリアに移動する。自分のFILEエリアにカードが7枚以上ある場合、事件を解決編にする。';

function stripLeadingTags(line) {
  let s = line.replace(/^(?:【[^】]*】)+/, '');
  s = s.replace(/^[（(][^）)]*[）)]/, '');
  return s;
}
function stripTrailingParen(line) {
  return line.replace(/[（(][^）)]*[）)]\s*$/, '').trim();
}

function lineIsCovered(fullText, line) {
  const trimmed = line.trim();
  if (!trimmed) return true;
  const stripped = stripLeadingTags(trimmed);
  if (stripped === '' || /^〚[^〛]+〛(?:[（(][^）)]*[）)])?\s*$/.test(stripped)) return true;
  const core = stripTrailingParen(trimmed) || trimmed;
  const coreStripped = stripTrailingParen(stripped) || stripped;

  for (const s of filteredIncludeStrings) {
    if (!s) continue;
    if (trimmed === s || stripped === s) return true;
    if (s.length >= 10 && (trimmed.includes(s) || s.includes(core) || s.includes(coreStripped))) return true;
  }
  // 注釈（括弧書き）を除いた行でも判定する(コード側は注釈を除いた本文で照合している効果がある)
  const plain = trimmed.replace(/（[^）]*）/g, '');
  const plainStripped = stripLeadingTags(plain);
  for (const re of compiledLine) {
    try { if (re.test(trimmed) || re.test(stripped) || re.test(plain) || re.test(plainStripped)) return true; } catch (e) {}
  }
  for (const re of compiledFull) {
    re.lastIndex = 0;
    let mm; let guard = 0;
    while ((mm = re.exec(fullText)) && guard++ < 30) {
      if (mm[0].length < 10) { if (mm[0].length === 0) re.lastIndex++; continue; }
      if (mm[0].includes(core) || mm[0].includes(coreStripped) || core.includes(mm[0]) || coreStripped.includes(mm[0])) return true;
    }
  }
  return false;
}

// デバッグ用：DEBUG_CARD_ID=0262 node tools/generate_unimplemented_ids.js のように
// card_idを指定して実行すると、そのカードの行ごとの判定結果だけを表示する
if (process.env.DEBUG_CARD_ID || process.env.DEBUG_ID) {
  const c = process.env.DEBUG_ID
    ? CARD_DATA.find(x => x.id === Number(process.env.DEBUG_ID))
    : CARD_DATA.find(x => x.card_id === process.env.DEBUG_CARD_ID);
  if (c && c.ability_text) {
    const text = c.ability_text.replace(/\r/g, '');
    text.split('\n').forEach(line => {
      console.log(lineIsCovered(text, line) ? 'COVERED' : 'MISSING', '::', line);
    });
  } else {
    console.log('card not found or has no ability_text:', process.env.DEBUG_CARD_ID);
  }
  process.exit(0);
}

// LIST_MISSING=出力先.json を付けて実行すると、行全体がどのパターンにも当たらないカード(=一度も実装されていない行)を
// カードごとに書き出して終了する(未実装の効果文を洗い出して実装するための作業用)
if (process.env.LIST_MISSING) {
  const out = {};
  for (const c of CARD_DATA) {
    if (!c.ability_text) continue;
    const text = c.ability_text.replace(/\r/g, '');
    if (c.card_type === 'パートナー' && text.trim() === PARTNER_BASE_TEXT.trim()) continue;
    const missing = text.split('\n').map(l => l.trim()).filter(l => l && !lineIsCovered(text, l));
    if (missing.length) out[c.id] = missing;
  }
  fs.writeFileSync(process.env.LIST_MISSING, JSON.stringify(out, null, 1));
  console.log('行が未処理のカード:', Object.keys(out).length);
  process.exit(0);
}

const results = [];
for (const c of CARD_DATA) {
  if (!c.ability_text) { results.push({ id: c.id, implemented: true }); continue; }
  const text = c.ability_text.replace(/\r/g, '');
  if (c.card_type === 'パートナー' && text.trim() === PARTNER_BASE_TEXT.trim()) {
    results.push({ id: c.id, implemented: true });
    continue;
  }
  let allCovered = true;
  for (const rawLine of text.split('\n')) {
    if (!rawLine.trim()) continue;
    if (!lineIsCovered(text, rawLine)) { allCovered = false; break; }
  }
  results.push({ id: c.id, implemented: allCovered });
}

// 効果文の一部しか実装されていないカードも、未実装と同じ扱いにする(tools/partial_check.js)。
// 確認して実装済みと分かったカードは tools/partial-verified.json に追加すると対象外になる
const { findPartialCards } = require('./partial_check.js');
const partialIds = new Set(findPartialCards(CARD_DATA).map(p => p.id));
const baseUnimplemented = new Set(results.filter(r => !r.implemented).map(r => r.id));
const unimplementedIds = results.filter(r => !r.implemented || partialIds.has(r.id)).map(r => r.id);
console.log(`  (うち一部のみ実装: ${[...partialIds].filter(id => !baseUnimplemented.has(id)).length})`);
fs.writeFileSync(OUT_PATH, `window.UNIMPLEMENTED_CARD_IDS = ${JSON.stringify(unimplementedIds)};\n`);
console.log(`total cards: ${CARD_DATA.length}, unimplemented: ${unimplementedIds.length}`);
console.log(`wrote ${OUT_PATH}`);
