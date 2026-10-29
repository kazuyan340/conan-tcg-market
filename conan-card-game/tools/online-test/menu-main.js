// 演出がゲストの画面にも出るかを確かめる: ホストでカットイン演出を呼び、ゲストの画面に出た瞬間を撮る
// 使い方: electron fx-main.js <出力フォルダ>
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
  const pass = 'fx-' + Math.random().toString(36).slice(2);
  await ev(W1, `window.__skipJanken=true; document.getElementById('lobbyPass').value='${pass}';document.getElementById('lobbyName').value='A';document.getElementById('lobbyDeck').selectedIndex=0;document.getElementById('lobbyStart').click();1`);
  await sleep(1500);
  await ev(W2, `window.__skipJanken=true; document.getElementById('lobbyPass').value='${pass}';document.getElementById('lobbyName').value='B';document.getElementById('lobbyDeck').selectedIndex=1;document.getElementById('lobbyStart').click();1`);
  for (let i = 0; i < 40; i++) { await sleep(500); if (await ev(W1, `document.getElementById('lobby').classList.contains('hidden')`) && await ev(W2, `document.getElementById('lobby').classList.contains('hidden')`)) break; }
  await sleep(2000);
  const H = (await ev(W1, `document.body.classList.contains('host')`)) ? W1 : W2, G = H === W1 ? W2 : W1;
  for (let k = 0; k < 2; k++) { const who = await ev(H, `typeof mulliganPhase==='undefined'?null:mulliganPhase`); if (!who) break; await ev(who === 'self' ? H : G, `(function(){ const b=document.getElementById('mulliganConfirmBtn'); if (b) b.click(); })()`); await sleep(1500); }
  await sleep(1500);
  // メニュー: 自分の手札をクリック→相手の画面にメニューが見えないこと
  const vis = (w, side) => ev(w, `Array.from(document.querySelectorAll('.zone[data-side="${side}"] .deck-menu')).map(m => getComputedStyle(m).display + '/' + (m.offsetParent ? 'shown' : 'hidden')).join(',')`);
  const turnSide = await ev(H, `match.turn.activeSide`);
  const mineSel = turnSide === 'self' ? H : G, otherW = mineSel === H ? G : H, mySide = mineSel === H ? 'self' : 'opponent';
  await ev(mineSel, `document.querySelector('.zone[data-side="${mySide}"] .hand-row .hcard').click()`);
  await sleep(1500);
  console.log('actor', mineSel === H ? 'host' : 'guest', 'own menus:', await vis(mineSel, mySide), '| other screen:', await vis(otherW, mySide));
  await ev(mineSel, `document.querySelector('.zone[data-side="${mySide}"] .hand-row .hcard').click()`);
  app.exit(0);
});
setTimeout(() => { console.log('TIMEOUT'); app.exit(1); }, 90000);
