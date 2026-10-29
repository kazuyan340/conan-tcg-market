// オンライン対戦の2画面テスト: 同じPC上でホスト画面とゲスト画面を開き、パスで接続→マリガン→最初の数手を進める
// 使い方: electron duo-main.js <出力フォルダ>
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs'), path = require('path');
const outDir = process.argv[2];
const log = (...a) => console.log(...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const SEED = `(function(){
  const cards = (window.CARD_DATA||[]);
  const chars = cards.filter(c => c.card_type === '\u30ad\u30e3\u30e9' && c.level != null && c.level <= 3).slice(0, 14);
  const evs = cards.filter(c => c.card_type === '\u30a4\u30d9\u30f3\u30c8').slice(0, 6);
  const pool = [...chars, ...evs];
  const mk = (name, off) => { const list = []; let i = off;
    while (list.reduce((a,c)=>a+c.qty,0) < 40) { const c = pool[i % pool.length]; i++; const e = list.find(x=>x.id===c.id); if (e) { if (e.qty < 3) e.qty++; else continue; } else list.push({id:c.id, qty:1}); }
    return { id: name, name, cards: list, partnerCardId: (cards.find(c=>c.card_type==='\u30d1\u30fc\u30c8\u30ca\u30fc')||{}).id, caseCardId: (cards.find(c=>c.card_type==='\u4e8b\u4ef6')||{}).id }; };
  saveDecks([mk('HOST-DECK', 0), mk('GUEST-DECK', 5)]);
  return loadSavedDecks().length;
})()`;

async function shot(win, name){ const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(outDir, name), img.toPNG()); }
const ev = (win, code) => win.webContents.executeJavaScript(code);

app.whenReady().then(async () => {
  const dirs = {};   // webContents.id -> 画像フォルダ(環境変数 IMGDIR_A / IMGDIR_B があるときだけ使う)
  ipcMain.on('image-config', e => { const d = dirs[e.sender.id]; e.returnValue = d ? { dir: d, files: fs.readdirSync(d) } : { dir: null, files: [] }; });
  ipcMain.on('set-fullscreen', () => {});
  const mkWin = (x) => {
    const w = new BrowserWindow({ x, y: 0, width: +(process.env.WW||560), height: +(process.env.HH||980), show: false, useContentSize: true,
      webPreferences: { contextIsolation: true, preload: path.resolve(__dirname, '../../preload.js') } });
    return w;
  };
  const W1 = mkWin(0), W2 = mkWin(+(process.env.WW||560)+20);
  let H = W1, G = W2;
  if (process.env.IMGDIR_A) { dirs[W1.webContents.id] = process.env.IMGDIR_A; dirs[W2.webContents.id] = process.env.IMGDIR_B; }
  W1.webContents.on('console-message', (e, l, m) => { if (!/Security Warning|^%c/.test(m)) log('[W1]', String(m).slice(0, 240)); });
  W2.webContents.on('console-message', (e, l, m) => { if (!/Security Warning|^%c/.test(m)) log('[W2]', String(m).slice(0, 240)); });
  const file = path.resolve(__dirname, '../../online.html');
  await W1.loadFile(file); log('seed', await ev(W1, SEED));
  await W1.loadFile(file); await W2.loadFile(file);
  const pass = 'duo-' + Math.random().toString(36).slice(2);
  await ev(W1, `document.getElementById('lobbyPass').value='${pass}'; document.getElementById('lobbyName').value='コナン'; document.getElementById('lobbyDeck').selectedIndex=0; document.getElementById('lobbyStart').click(); 1`);
  await sleep(1500);
  await ev(W2, `document.getElementById('lobbyPass').value='${pass}'; document.getElementById('lobbyName').value='蘭'; document.getElementById('lobbyDeck').selectedIndex=1; document.getElementById('lobbyStart').click(); 1`);
  // ジャンケン: 1回目はあいこ、2回目はホストが勝って先攻になる
  await sleep(3000);
  const JW = (await ev(W1, `document.body.classList.contains('host')`)) ? [W1, W2] : [W2, W1];
  const jk = (w, i) => ev(w, `(function(){ const b = document.querySelectorAll('#jankenOverlay .jk-btns .btn')[${i}]; if (!b) return false; b.click(); return true; })()`);
  const jkTitle = w => ev(w, `(document.querySelector('#jankenOverlay .jk-title')||{}).textContent`);
  log('JK pick buttons:', await jk(JW[0], 0), await jk(JW[1], 0));
  await sleep(800); log('JK round1 titles:', await jkTitle(JW[0]), '/', await jkTitle(JW[1]));
  await sleep(2000);
  log('JK round2 picks:', await jk(JW[0], 2), await jk(JW[1], 0));
  await sleep(800); log('JK round2 titles:', await jkTitle(JW[0]), '/', await jkTitle(JW[1]));
  await sleep(1500);
  for (let i = 0; i < 40; i++) { await sleep(500); const st = await ev(W2, `document.getElementById('lobby').classList.contains('hidden')`); const st1 = await ev(W1, `document.getElementById('lobby').classList.contains('hidden')`); if (st && st1) break; }
  await sleep(1500);
  const r1 = await ev(W1, `document.body.classList.contains('host')`);
  H = r1 ? W1 : W2; G = r1 ? W2 : W1;
  log('engine host is', r1 ? 'W1' : 'W2');
  log('H lobby hidden:', await ev(H, `document.getElementById('lobby').classList.contains('hidden')`), ' G lobby hidden:', await ev(G, `document.getElementById('lobby').classList.contains('hidden')`));
  const INSTR = `(function(){ window.__fx = []; ['flyGhostCard','fadeDrawCard','animateCardEntry','playCutInEffect','playClashEffect'].forEach(n => { const o = window[n]; if (typeof o !== 'function') { window.__fx.push('MISSING:' + n); return; } window[n] = function(){ window.__fx.push(n); return o.apply(this, arguments); }; }); return window.__fx.length; })()`;
  await ev(H, INSTR); await ev(G, INSTR);
  await shot(H, 'h1.png'); await shot(G, 'g1.png');
  const report = async (tag) => { log(tag, 'H banner:', await ev(H, `document.getElementById('onlineBanner').textContent`), '| G banner:', await ev(G, `document.getElementById('onlineBanner').textContent`)); };
  await report('after-start');
  // マリガン: 先攻から順に「引き直さずに進める」
  for (let k = 0; k < 2; k++) {
    const who = await ev(H, `typeof mulliganPhase==='undefined'?null:mulliganPhase`);
    log('mulligan phase:', who);
    if (!who) break;
    const win = who === 'self' ? H : G;
    log(' click confirm on', who === 'self' ? 'H' : 'G', await ev(win, `(function(){ const b=document.getElementById('mulliganConfirmBtn'); if(!b) return 'nobtn'; b.click(); return 'clicked'; })()`));
    await sleep(1500);
  }
  await sleep(1500);
  await report('after-mulligan');
  const state = async () => JSON.parse(await ev(H, `JSON.stringify(match.turn?{a:match.turn.activeSide,p:match.turn.phase}:null)`));
  const waitMain = async (side) => { for (let i = 0; i < 50; i++) { const st = await state(); if (st && st.a === side && st.p === 'main') return true; await sleep(300); } return false; };
  const clickText = (win, sel, text) => ev(win, `(function(){ const b=Array.from(document.querySelectorAll(${JSON.stringify(sel)})).find(x=>x.textContent.includes(${JSON.stringify(text)})&&!x.disabled); if(!b) return false; b.click(); return true; })()`);
  // 本物のマウス入力(isTrusted=true)で押す
  const realClick = async (win, sel, text) => {
    const r = await ev(win, `(function(){ const b=Array.from(document.querySelectorAll(${JSON.stringify(sel)})).find(x=>x.textContent.includes(${JSON.stringify(text)})); if(!b) return null; const r=b.getBoundingClientRect(); return {x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2)}; })()`);
    if (!r) return false;
    win.webContents.sendInputEvent({ type: 'mouseMove', x: r.x, y: r.y });
    win.webContents.sendInputEvent({ type: 'mouseDown', x: r.x, y: r.y, button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseUp', x: r.x, y: r.y, button: 'left', clickCount: 1 });
    return true;
  };
  const tryPlay = async (win, side) => {
    const pick = JSON.parse(await ev(H, `(function(){ const hand = match.${side}.hand.filter(c => (CARD_BY_ID.get(c.cardId)||{}).card_type === 'キャラ'); const p = hand.map(c => { let r; try { r = canPlayHandCard('${side}', c.uid); } catch(e) { r = {ok:false}; } return { uid:c.uid, ok: !!(r && r.ok) }; }).find(i => i.ok); return JSON.stringify({ file: match.${side}.file.length, uid: p ? p.uid : null }); })()`));
    log('  playable:', JSON.stringify(pick));
    if (!pick.uid) return false;
    await ev(win, `document.querySelector('.zone[data-side="${side}"] .hand-row .hcard[data-uid="${pick.uid}"]').click()`);
    await sleep(1000);
    log('  menu:', await ev(win, `Array.from(document.querySelectorAll('.zone[data-side="${side}"] .hand-row button')).map(b=>b.textContent.trim()+(b.disabled?'(x)':'')).join('|')`), ' guestSees:', await ev(G, `Array.from(document.querySelectorAll('.zone[data-side="${side}"] .hand-row button')).map(b=>b.textContent.trim()).join('|')`));
    const ok = await clickText(win, `.zone[data-side="${side}"] .hand-row button`, '登場');
    await sleep(2000);
    const n = await ev(H, `match.${side}.field.length`);
    log('  played ->', ok, ' engine field =', n, ' | host DOM:', await ev(H, `document.querySelectorAll('.zone[data-side="${side}"] .field-row .char-card').length`), ' guest DOM:', await ev(G, `document.querySelectorAll('.zone[data-side="${side}"] .field-row .char-card').length`));
    return n > 0;
  };

  let st = await state(); log('start state:', JSON.stringify(st));
  await waitMain(st.a);
  if (st.a === 'opponent') {
    log('[T1 = guest turn] host real-click end-turn (should be blocked)');
    await realClick(H, '#turnBar button', 'ターン終了'); await sleep(1200);
    log('  active after host real click:', (await state()).a, '(expect opponent)  banner:', await ev(H, `document.getElementById('onlineBanner').textContent`));
    log('[T1] guest plays a card'); await tryPlay(G, 'opponent');
    log('[T1] guest ends turn'); await clickText(G, '#turnBar button', 'ターン終了');
    log('  -> host main?', await waitMain('self'));
  }
  log('[host turn] guest tries end-turn (should be ignored)');
  await clickText(G, '#turnBar button', 'ターン終了'); await sleep(1200);
  log('  active:', (await state()).a, '(expect self)');
  log('[host turn] host plays a card'); await tryPlay(H, 'self');
  await shot(H, 'h3.png'); await shot(G, 'g3.png');
  log('[host turn] host ends turn'); await realClick(H, '#turnBar button', 'ターン終了');
  log('  -> guest main?', await waitMain('opponent'));
  log('[guest turn] guest plays a card'); await tryPlay(G, 'opponent');
  await shot(H, 'h4.png'); await shot(G, 'g4.png');
  await report('end');
  // --- カード詳細: ゲストの番に、ゲストが手札メニューの「詳細」を押す / 場のカードを長押しする ---
  const detailShown = win => ev(win, `(function(){ const d=document.getElementById('cardDetail'); return d && d.style.display==='flex' ? d.querySelector('.cd-name').textContent : null; })()`);
  // 長押し(ゲストが自分の場のカードを650ms押す)
  const pos = await ev(G, `(function(){ const i=document.querySelector('.zone[data-side="opponent"] .field-row img')||document.querySelector('.zone[data-side="opponent"] .hand-row .hcard img'); if(!i) return null; const r=i.getBoundingClientRect(); return {x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2)}; })()`);
  G.webContents.sendInputEvent({ type: 'mouseMove', x: pos.x, y: pos.y });
  G.webContents.sendInputEvent({ type: 'mouseDown', x: pos.x, y: pos.y, button: 'left', clickCount: 1 });
  await sleep(700);
  G.webContents.sendInputEvent({ type: 'mouseUp', x: pos.x, y: pos.y, button: 'left', clickCount: 1 });
  await sleep(500);
  log('LONGPRESS -> guest panel:', await detailShown(G), '| host panel:', await detailShown(H), '| guest owner-op still ok? banner:', await ev(G, `document.getElementById('onlineBanner').textContent`));
  await shot(G, 'g6.png');
  log('NAMES host sees:', await ev(H, `match.self.deckName+' / '+match.opponent.deckName`), '| mulligan title was shown to each side as name');
  if (process.env.IMGDIR_A) {
    const srcs = async (win) => ev(win, `JSON.stringify(Array.from(document.querySelectorAll('.zone[data-side="self"] .field-row img, .zone[data-side="opponent"] .field-row img')).map(i=>i.getAttribute('src')))`);
    log('IMG host field srcs :', await srcs(H));
    log('IMG guest field srcs:', await srcs(G));
    log('IMG guest hidden hand imgs with src:', await ev(G, `document.querySelectorAll('.zone[data-side="self"] .hand-row .hcard img[src]').length`), '(expect 0)');
    log('IMG host DOM opp hand srcs shown?', await ev(H, `document.querySelectorAll('.zone[data-side="opponent"] .hand-row .hcard img[src]').length`), '(host view hides by CSS)');
  }
  const fxStat = async win => ev(win, `JSON.stringify({ fx: window.__fx.reduce((a, k) => (a[k] = (a[k] || 0) + 1, a), {}), logLines: document.querySelectorAll('#onlineLog .ln').length, logH: document.getElementById('onlineLog').style.height, logVis: getComputedStyle(document.getElementById('onlineLog')).display + '/' + document.getElementById('onlineLog').style.visibility, last: Array.from(document.querySelectorAll('#onlineLog .ln')).slice(-4).map(x => x.textContent) })`);
  log('FX host :', await fxStat(H));
  log('FX guest:', await fxStat(G));
  await shot(H, 'hfin.png'); await shot(G, 'gfin.png');
  app.exit(0);
});
setTimeout(() => { console.log('TIMEOUT'); app.exit(1); }, 120000);
