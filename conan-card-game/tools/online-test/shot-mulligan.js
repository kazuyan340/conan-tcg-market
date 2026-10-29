// マリガン画面と山札を見る画面の見た目を撮る: electron shot-mulligan.js <出力フォルダ>
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs'), path = require('path');
const outDir = process.argv[2] || '.';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ev = (w, c) => w.webContents.executeJavaScript(c);
const SEED = `(function(){ const cards = window.CARD_DATA||[]; const pool = cards.filter(c => c.card_type === '\u30ad\u30e3\u30e9' && c.level != null && c.level <= 3).slice(0, 14);
  const mk = (name, off) => { const list = []; let i = off; while (list.reduce((a,c)=>a+c.qty,0) < 40) { const c = pool[i % pool.length]; i++; const e = list.find(x=>x.id===c.id); if (e) { if (e.qty < 3) e.qty++; else continue; } else list.push({id:c.id, qty:1}); }
    return { id: name, name, cards: list, partnerCardId: (cards.find(c=>c.card_type==='\u30d1\u30fc\u30c8\u30ca\u30fc')||{}).id, caseCardId: (cards.find(c=>c.card_type==='\u4e8b\u4ef6')||{}).id }; };
  saveDecks([mk('A', 0), mk('B', 5)]); return 1; })()`;
app.whenReady().then(async () => {
  ipcMain.on('image-config', e => { e.returnValue = { dir: null, files: [] }; });
  ipcMain.on('set-fullscreen', () => {});
  const mk = x => new BrowserWindow({ x, y: 0, width: 560, height: 980, show: false, useContentSize: true, webPreferences: { contextIsolation: true, preload: path.resolve(__dirname, '../../preload.js') } });
  const W1 = mk(0), W2 = mk(580), file = path.resolve(__dirname, '../../online.html');
  await W1.loadFile(file); await ev(W1, SEED); await W1.loadFile(file); await W2.loadFile(file);
  const pass = 'mg-' + Math.random().toString(36).slice(2);
  await ev(W1, `window.__skipJanken=true; document.getElementById('lobbyPass').value='${pass}';document.getElementById('lobbyName').value='A';document.getElementById('lobbyDeck').selectedIndex=0;document.getElementById('lobbyStart').click();1`);
  await sleep(1500);
  await ev(W2, `window.__skipJanken=true; document.getElementById('lobbyPass').value='${pass}';document.getElementById('lobbyName').value='B';document.getElementById('lobbyDeck').selectedIndex=1;document.getElementById('lobbyStart').click();1`);
  for (let i = 0; i < 40; i++) { await sleep(500); if (await ev(W1, `document.getElementById('lobby').classList.contains('hidden')`) && await ev(W2, `document.getElementById('lobby').classList.contains('hidden')`)) break; }
  await sleep(2000);
  const H = (await ev(W1, `document.body.classList.contains('host')`)) ? W1 : W2, G = H === W1 ? W2 : W1;
  const who = await ev(H, `mulliganPhase`); const A = who === 'self' ? H : G;
  fs.writeFileSync(path.join(outDir, 'mg-mulligan.png'), (await A.webContents.capturePage()).toPNG());
  // 山札を見る画面(6枚)と、カード選択の画面を、ホストで開いて撮る
  await ev(H, `document.getElementById('mulliganConfirmBtn').click()`); await sleep(1200);
  await ev(G, `document.getElementById('mulliganConfirmBtn') && document.getElementById('mulliganConfirmBtn').click()`); await sleep(1500);
  await ev(H, `openChoice({ title: '効果', hint: 'カードを選んでください', min: 0, max: 2, confirmText: '決定', skipText: '選ばない', items: match.self.hand.map((c, i) => ({ key: c.uid, cardId: c.cardId, tagSide: 'self' })).concat(match.opponent.hand.slice(0, 3).map(c => ({ key: c.uid, cardId: c.cardId, tagSide: 'opponent' }))) })`);
  await sleep(900);
  fs.writeFileSync(path.join(outDir, 'mg-choice.png'), (await H.webContents.capturePage()).toPNG());
  app.exit(0);
});
setTimeout(() => { console.log('TIMEOUT'); app.exit(1); }, 90000);
