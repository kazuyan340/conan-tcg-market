// オンライン対戦の長時間テスト: 同じPCでホスト画面とゲスト画面を立て、決着(または上限ターン)まで自動で遊ばせる。
// 止まった場面(STUCK)と、ホストのエンジンとゲストの画面がずれた場面(DESYNC)を記録する。
// 使い方: electron soak-main.js <出力フォルダ>   環境変数: SEED_N(デッキの乱数の種, 既定1) MAX_TURNS(既定30) MAX_SEC(既定240)
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs'), path = require('path');
const outDir = process.argv[2] || '.';
const SEED_N = +(process.env.SEED_N || 1), MAX_TURNS = +(process.env.MAX_TURNS || 30), MAX_SEC = +(process.env.MAX_SEC || 240);
const log = (...a) => console.log(...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const problems = [];
const note = (kind, msg) => { problems.push(kind + ' ' + msg); log('!!', kind, msg); };

const SEED = `(function(){
  let s = ${SEED_N} * 2654435761 % 4294967296;
  const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const cards = (window.CARD_DATA||[]);
  const COLS = ['赤','青','黄','緑','白','黒'];
  const mk = (name) => { const list = []; let n = 0, guard = 0;
    const col = COLS[Math.floor(rnd() * COLS.length)];
    const chars = cards.filter(c => c.card_type === 'キャラ' && c.level != null && c.level <= 5 && c.color === col);
    const evs = cards.filter(c => c.card_type === 'イベント' && c.level != null && c.level <= 4 && c.color === col);
    const pool = chars.concat(chars, evs);
    while (n < 40 && guard++ < 5000) { const c = pool[Math.floor(rnd() * pool.length)]; const e = list.find(x => x.id === c.id); if (e) { if (e.qty < 3) { e.qty++; n++; } } else { list.push({ id: c.id, qty: 1 }); n++; } }
    const pc = cards.filter(c => c.card_type === 'パートナー'), cc = cards.filter(c => c.card_type === '事件' && c.color === col);
    return { id: name, name, cards: list, partnerCardId: pc[Math.floor(rnd() * pc.length)].id, caseCardId: cc[Math.floor(rnd() * cc.length)].id }; };
  saveDecks([mk('HOST-DECK'), mk('GUEST-DECK')]);
  return loadSavedDecks().length;
})()`;

const ev = (win, code) => win.webContents.executeJavaScript(code);

app.whenReady().then(async () => {
  ipcMain.on('image-config', e => { e.returnValue = { dir: null, files: [] }; });
  ipcMain.on('set-fullscreen', () => {});
  const mkWin = x => new BrowserWindow({ x, y: 0, width: 560, height: 980, show: false, useContentSize: true,
    webPreferences: { contextIsolation: true, preload: path.resolve(__dirname, '../../preload.js') } });
  const W1 = mkWin(0), W2 = mkWin(580);
  for (const [n, w] of [['W1', W1], ['W2', W2]]) w.webContents.on('console-message', (e, l, m) => { if (l >= 3 && !/Security Warning|^%c/.test(m)) note('CONSOLE-' + n, String(m).slice(0, 240)); });
  for (const [n, w] of [['W1', W1], ['W2', W2]]) w.webContents.on('render-process-gone', () => note('CRASH', n));
  const file = path.resolve(__dirname, '../../online.html');
  await W1.loadFile(file); await ev(W1, SEED);
  await W1.loadFile(file); await W2.loadFile(file);
  const pass = 'soak-' + Math.random().toString(36).slice(2);
  await ev(W1, `window.__skipJanken=true; document.getElementById('lobbyPass').value='${pass}'; document.getElementById('lobbyName').value='コナン'; document.getElementById('lobbyDeck').selectedIndex=0; document.getElementById('lobbyStart').click(); 1`);
  await sleep(1500);
  await ev(W2, `window.__skipJanken=true; document.getElementById('lobbyPass').value='${pass}'; document.getElementById('lobbyName').value='蘭'; document.getElementById('lobbyDeck').selectedIndex=1; document.getElementById('lobbyStart').click(); 1`);
  for (let i = 0; i < 40; i++) { await sleep(500); const a = await ev(W1, `document.getElementById('lobby').classList.contains('hidden')`), b = await ev(W2, `document.getElementById('lobby').classList.contains('hidden')`); if (a && b) break; }
  await sleep(1500);
  const r1 = await ev(W1, `document.body.classList.contains('host')`);
  const H = r1 ? W1 : W2, G = r1 ? W2 : W1;
  const winOf = side => side === 'self' ? H : G;
  log('seed', SEED_N, 'host =', r1 ? 'W1' : 'W2');

  const realClickAt = async (win, x, y) => {
    win.webContents.sendInputEvent({ type: 'mouseMove', x, y });
    win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
  };
  // セレクタに合う、押せる要素(textを含む)の中心を実際のマウス入力で押す
  const realClick = async (win, sel, text, idx) => {
    const r = await ev(win, `(function(){ const l = Array.from(document.querySelectorAll(${JSON.stringify(sel)})).filter(x => !x.disabled && x.getClientRects().length > 0 && (${JSON.stringify(text || '')} === '' || x.textContent.includes(${JSON.stringify(text || '')}))); const b = l[${idx || 0}]; if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
    if (!r) return false;
    await realClickAt(win, r.x, r.y); return true;
  };
  const hostState = () => ev(H, `(function(){
    const names = { choiceState, handDiscardState, evidencePickState, deckPeekState, partnerRemoveState, hiramekiSleepState, switchState, oppHandPickState, contactState, hiramekiState, freePlayChoiceState, actionEndSwapState, kaitoActionEndState, keywordGrantChoiceState, bonusEvidenceState, sleepForOppDiscardState, sleepCostState, lpBuffChoiceState, apBuffState, mrReplaceState, mulliganPhase, actionState, disguiseReactState, misleadState };
    const pend = Object.keys(names).filter(k => !!names[k]);
    const m = match;
    return JSON.stringify({ over: !!m.gameOver, turn: m.turn ? m.turn.turnNumber : 0, act: m.turn ? m.turn.activeSide : null, phase: m.turn ? m.turn.phase : null, pend,
      sig: ['self','opponent'].map(s => [m[s].hand.length, m[s].field.map(c => c.cardId + (c.sleeping?'s':'')).join(','), m[s].evidence.length, m[s].file.length, m[s].remove.length, m[s].deckPile.length].join('/')).join('|') + '#' + m.events.length });
  })()`).then(JSON.parse);
  const banner = win => ev(win, `document.getElementById('onlineBanner').textContent`);

  // ホストのエンジンの数字と、ゲスト画面に出ている枚数を比べる
  const compare = async tag => {
    const eng = JSON.parse(await ev(H, `JSON.stringify(['self','opponent'].map(s => ({ field: match[s].field.length, hand: match[s].hand.length, ev: match[s].evidence.length })))`));
    const dom = side => ({ field: `.zone[data-side="${side}"] .field-row .char-card`, hand: `.zone[data-side="${side}"] .hand-row .hcard`, ev: `.zone[data-side="${side}"] .evidence-row .ev-card, .zone[data-side="${side}"] .evidence-area .ev-card` });
    for (const [i, side] of ['self', 'opponent'].entries()) {
      for (const k of ['field', 'hand']) {
        const g = await ev(G, `document.querySelectorAll(${JSON.stringify(dom(side)[k])}).length`);
        if (g !== eng[i][k]) note('DESYNC', `${tag} ${side}.${k}: engine ${eng[i][k]} / guest画面 ${g}`);
      }
    }
  };

  // マリガン
  for (let k = 0; k < 2; k++) {
    const st = await hostState(); const who = await ev(H, `mulliganPhase`);
    if (!who) break;
    await ev(winOf(who), `(function(){ const b = document.getElementById('mulliganConfirmBtn'); if (b) b.click(); })()`);
    await sleep(1500);
  }
  await sleep(1500);

  const t0 = Date.now();
  let last = '', same = 0, lastTurn = 0, acted = 0;
  const stats = { action: 0, noguard: 0 }, triedMovers = new Set();
  const logEvery = {};
  while (Date.now() - t0 < MAX_SEC * 1000) {
    const st = await hostState();
    if (st.over) { log('GAME OVER at turn', st.turn); break; }
    if (st.turn > MAX_TURNS) { log('reached max turns', MAX_TURNS); break; }
    if (st.turn !== lastTurn) { lastTurn = st.turn; await sleep(600); await compare('turn' + st.turn); }
    const sig = JSON.stringify([st.turn, st.act, st.phase, st.pend, st.sig]);
    if (sig === last) same++; else { same = 0; last = sig; }
    if (same >= 8) {
      const bh = await banner(H), bg = await banner(G);
      note('STUCK', `turn${st.turn} act=${st.act} phase=${st.phase} pend=${st.pend.join(',')} | H:${bh} | G:${bg}`);
      await ev(H, `(function(){ try { const c = (typeof choiceState !== 'undefined' && choiceState) ? JSON.stringify({title: choiceState.title, hint: choiceState.hint, n: choiceState.items.length, min: choiceState.min, max: choiceState.max, items: choiceState.items.slice(0, 8).map(i => i.key + ':' + (i.disabled ? 'X' : 'o') + (i.label ? i.label : '')) }) : 'none'; console.error('CHOICE ' + c); } catch (e) {} })()`);
      note('DETAIL', await ev(H, `JSON.stringify({ dp: typeof deckPeekState !== 'undefined' && deckPeekState ? { step: deckPeekState.step, pend: deckPeekState.pendingUid, ord: deckPeekState.orderedUids, rev: (deckPeekState.revealedUids||[]).length, mand: deckPeekState.mandatory } : null, vis: Array.from(document.querySelectorAll('#deckPeekOverlay button, #deckPeekCards .mulligan-card')).map(e => e.id + '/' + e.className + '/' + e.getClientRects().length + '/' + e.textContent.slice(0,6)) })`));
      {
        const probe = win => ev(win, `(function(){ const o = document.getElementById('deckPeekOverlay'); if (!o) return 'no overlay'; return JSON.stringify({ disp: getComputedStyle(o).display, btns: Array.from(o.querySelectorAll('button')).map(b => { const r = b.getBoundingClientRect(); const el = document.elementFromPoint(r.x + r.width/2, r.y + r.height/2); return b.textContent.slice(0, 8) + '|vis' + b.getClientRects().length + '|dis' + b.disabled + '|top=' + (el ? el.tagName + '.' + el.className + '#' + el.id : null) + '|in=' + (el && o.contains(el)); }), cards: o.querySelectorAll('.mulligan-card').length }); })()`);
        note('PROBE-H', await probe(H)); note('PROBE-G', await probe(G));
        note('CHOICESTATE', await ev(H, `JSON.stringify(choiceState ? { title: choiceState.title, hint: String(choiceState.hint).slice(0, 80), n: choiceState.items.length, min: choiceState.min, max: choiceState.max, owner: (typeof currentActorSide === 'function' ? currentActorSide() : null) } : null)`));
        {
          const items = await ev(H, `JSON.stringify(choiceState ? choiceState.items.map(i => i.key + (i.disabled ? 'X' : '') + '/' + (i.cardId != null)) : null)`);
          note('ITEMS', items);
          const act = bh.includes('あなたの操作') ? H : G;
          const before = await ev(H, `choiceState ? choiceState.selected.length : -1`);
          const hit = await realClick(act, '#choiceCards .mulligan-card:not(.dim)', '');
          await sleep(700);
          const after = await ev(H, `choiceState ? choiceState.selected.length : -1`);
          note('CLICKTEST', JSON.stringify({ hit, before, after, detail: await ev(act, `getComputedStyle(document.getElementById('cardDetail')).display`), btns: await ev(act, `Array.from(document.querySelectorAll('#choiceActions button')).map(b => b.textContent + '/' + b.getClientRects().length).join('|')`) }));
        }
        note('OVERLAYS', await ev(H, `JSON.stringify(Array.from(document.querySelectorAll('.mulligan-overlay')).map(o => o.id + ':' + o.style.display))`));
        note('OVERLAYS-G', await ev(G, `JSON.stringify(Array.from(document.querySelectorAll('.mulligan-overlay')).map(o => o.id + ':' + o.style.display))`));
      }
      try { const img = await H.webContents.capturePage(); fs.writeFileSync(path.join(outDir, `stuck-h-${SEED_N}.png`), img.toPNG()); const img2 = await G.webContents.capturePage(); fs.writeFileSync(path.join(outDir, `stuck-g-${SEED_N}.png`), img2.toPNG()); } catch (e) {}
      break;
    }
    // 操作する側 = 「あなたの操作です」と出ている画面
    const bh = await banner(H), bg = await banner(G);
    const actor = bh.includes('あなたの操作') ? 'self' : bg.includes('あなたの操作') ? 'opponent' : null;
    if (!actor) { await sleep(400); continue; }
    const aw = winOf(actor);
    const choiceOpen = await ev(aw, `document.getElementById('choiceOverlay').style.display !== 'none'`);
    if (choiceOpen) {
      // 選択ダイアログ: ボタンがあれば先頭の押せるもの、カードなら最小枚数ぶん選んで確定
      if (await realClick(aw, '#choiceCards .choice-option-btn', '')) { await sleep(500); continue; }
      const need = await ev(H, `choiceState ? Math.max(choiceState.min || 0, 0) : 0`);
      const sel = await ev(H, `choiceState ? choiceState.selected.length : 0`);
      if (sel < Math.max(need, 1) && await realClick(aw, '#choiceCards .mulligan-card:not(.dim):not(.selected)', '')) { await sleep(400); continue; }
      if (await realClick(aw, '#choiceActions button', '')) { await sleep(500); continue; }
      await sleep(400); continue;
    }
    const as = JSON.parse(await ev(H, `JSON.stringify(typeof actionState !== 'undefined' && actionState ? { step: actionState.step, side: actionState.side, opp: actionState.oppSide } : null)`));
    if (as && as.step === 'target') {
      const o = as.opp;
      const hit = await ev(aw, `(function(){ const c = document.querySelector('.zone[data-side="${o}"] .field-row .char-card'); if (c) { c.click(); return 'char'; } const k = document.querySelector('.zone[data-side="${o}"] .case-slot'); if (k) { k.click(); return 'case'; } return null; })()`);
      stats.action++; await sleep(900); continue;
    }
    if (as && as.step === 'guard') {
      if (await realClick(aw, 'button', 'ガードしない')) { stats.noguard++; await sleep(900); continue; }
    }
    await ev(aw, `(function(){ const d = document.getElementById('cardDetail'); const c = d && d.querySelector('.cd-close'); if (c && d.style.display === 'flex') c.click(); })()`);
    if (st.pend.includes('deckPeekState')) {
      stats.peek = (stats.peek || 0) + 1;
      const OV = '#deckPeekOverlay';
      let hit = false;
      for (const t of ['この順番で戻す', '手札に加える', 'はい']) if (!hit && await realClick(aw, OV + ' button', t)) hit = true;
      if (hit) { await sleep(700); continue; }
      if (await realClick(aw, OV + ' .mulligan-card:not(.dim):not(.selected)', '')) { await sleep(600); continue; }
      if (await realClick(aw, OV + ' button', '手札に加えない')) { await sleep(700); continue; }
      if (await realClick(aw, OV + ' button', '')) { await sleep(700); continue; }
    }
    if (st.pend.includes('misleadState') || st.pend.includes('disguiseReactState')) {
      if (await realClick(aw, 'button', '使用しない') || await realClick(aw, 'button', 'しない') || await realClick(aw, 'button', 'パス')) { stats.reactSkip = (stats.reactSkip || 0) + 1; await sleep(800); continue; }
    }
    if (st.pend.includes('contactState')) {
      await ev(aw, `(function(){ const c = document.querySelector('#cardDetail .cd-close'); if (c && document.getElementById('cardDetail').style.display === 'flex') c.click(); })()`);
      if (await realClick(aw, 'button', 'パス')) { stats.contactPass = (stats.contactPass || 0) + 1; await sleep(900); continue; }
    }
    if (st.pend.length) { await sleep(400); continue; }
    if (st.phase !== 'main') { await sleep(400); continue; }
    // 場のキャラで推理かアクション(できるものがあれば)
    const mover = await ev(H, `(function(){ for (const c of match.${actor}.field) { if (c.sleeping || c.stunned) continue; return c.uid; } return null; })()`);
    if (mover && !triedMovers.has(st.turn + ':' + mover)) {
      triedMovers.add(st.turn + ':' + mover);
      await ev(aw, `(function(){ const e = document.querySelector('.zone[data-side="${actor}"] .field-row .char-card[data-uid="${mover}"]'); if (e) e.click(); })()`);
      await sleep(600);
      const used = await ev(aw, `(function(){ const bs = Array.from(document.querySelectorAll('.card-action-menu button')).filter(b => !b.disabled); const r = bs.find(b => b.textContent.startsWith('推理')); const a = bs.find(b => b.textContent === 'アクション'); const b = (st_turn_even ? (a || r) : (r || a)); if (!b) return null; b.click(); return b.textContent.slice(0, 2); })()`.replace('st_turn_even', String(st.turn % 2 === 0)));
      if (used) { stats[used] = (stats[used] || 0) + 1; await sleep(900); continue; }
      await ev(aw, `document.body.click()`);
    }
    // 手札から出せるカードを1枚出す(なければターン終了)
    const side = actor;
    const pick = await ev(H, `(function(){ const hand = match.${side}.hand; for (const c of hand) { let r; try { r = canPlayHandCard('${side}', c.uid); } catch (e) { r = null; } if (r && r.ok) return c.uid; } return null; })()`);
    if (pick && acted < 400) {
      acted++;
      await ev(aw, `(function(){ const e = document.querySelector('.zone[data-side="${side}"] .hand-row .hcard[data-uid="${pick}"]'); if (e) e.click(); })()`);
      await sleep(700);
      const ok = await ev(aw, `(function(){ const b = Array.from(document.querySelectorAll('.zone[data-side="${side}"] .hand-row button')).find(x => /登場|使用|セット/.test(x.textContent) && !x.disabled); if (!b) return false; b.click(); return true; })()`);
      await sleep(900);
      if (!ok) { await ev(aw, `document.body.click()`); await realClick(aw, '#turnBar button', 'ターン終了'); await sleep(600); }
      continue;
    }
    await realClick(aw, '#turnBar button', 'ターン終了'); await sleep(900);
  }
  const fin = await hostState();
  const evStats = JSON.parse(await ev(H, `JSON.stringify(match.events.reduce((a, e) => (a[e.type] = (a[e.type] || 0) + 1, a), {}))`));
  log('EVENTS', JSON.stringify(evStats)); log('STATS', JSON.stringify(stats));
  log('WINNER', await ev(H, `JSON.stringify(match.winner || match.result || null)`));
  log('FINAL', JSON.stringify({ turn: fin.turn, over: fin.over, acted, sec: Math.round((Date.now() - t0) / 1000) }));
  await compare('final');
  fs.writeFileSync(path.join(outDir, `soak-${SEED_N}.txt`), problems.join('\n') + '\nFINAL ' + JSON.stringify(fin) + '\n');
  log(problems.length ? 'PROBLEMS: ' + problems.length : 'NO PROBLEMS');
  app.exit(0);
});
setTimeout(() => { console.log('TIMEOUT'); app.exit(1); }, (MAX_SEC + 90) * 1000);
