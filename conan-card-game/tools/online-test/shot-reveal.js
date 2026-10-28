// 「相手は手札を公開する」系(0360 バーボン等)の登場時効果が、2画面でどう見えるかを撮る: electron shot-reveal.js <出力フォルダ>
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
  const pass = 'rv-' + Math.random().toString(36).slice(2);
  await ev(W1, `document.getElementById('lobbyPass').value='${pass}';document.getElementById('lobbyName').value='A';document.getElementById('lobbyDeck').selectedIndex=0;document.getElementById('lobbyStart').click();1`);
  await sleep(1500);
  await ev(W2, `document.getElementById('lobbyPass').value='${pass}';document.getElementById('lobbyName').value='B';document.getElementById('lobbyDeck').selectedIndex=1;document.getElementById('lobbyStart').click();1`);
  for (let i = 0; i < 40; i++) { await sleep(500); if (await ev(W1, `document.getElementById('lobby').classList.contains('hidden')`) && await ev(W2, `document.getElementById('lobby').classList.contains('hidden')`)) break; }
  await sleep(2000);
  const H = (await ev(W1, `document.body.classList.contains('host')`)) ? W1 : W2, G = H === W1 ? W2 : W1;
  for (let k = 0; k < 2; k++) { const who = await ev(H, `mulliganPhase`); if (!who) break; await ev(who === 'self' ? H : G, `document.getElementById('mulliganConfirmBtn').click()`); await sleep(1400); }
  await sleep(1500);
  // ホスト側のターンにして、ホストの手札に 0360 を入れて登場させる(相手=ゲストの手札から選ぶ)
  const r = await ev(H, `(function(){
    const c = CARD_DATA.find(x => x.card_id === '0360'); const lowOnes = CARD_DATA.filter(x => x.card_type === 'キャラ' && x.level != null && x.level <= 7).slice(0, 5);
    match.turn.activeSide = 'self'; match.turn.phase = 'main'; match.self.case = Object.assign({}, match.self.case, { cardId: CARD_DATA.find(x => x.card_type === '事件' && x.color === '黒').id });
    match.self.hand.push({ cardId: c.id, uid: 'self-t360' });
    match.self.file = Array.from({ length: 8 }, () => ({ cardId: lowOnes[0].id, uid: 'f' + Math.random() }));
    match.self.partner = Object.assign({}, match.self.partner, { cardId: CARD_DATA.find(x => x.card_type === 'パートナー' && x.color === '黒').id });
    renderBoard(match);
    const chk = canPlayHandCard('self', 'self-t360'); playCard('self', 'self-t360'); return JSON.stringify(chk); })()`);
  console.log('PLAY', r);
  await sleep(4000);
  console.log('PEND', await ev(H, `typeof oppHandPickState !== 'undefined' && !!oppHandPickState`), await ev(H, `typeof choiceState !== 'undefined' && choiceState ? choiceState.title + '/' + choiceState.hint : 'nochoice'`));
  console.log('HAND before: opp', await ev(H, `match.opponent.hand.length`), 'choice:', await ev(H, `choiceState ? JSON.stringify({ t: choiceState.title, pub: !!choiceState.public, n: choiceState.items.length, ok: choiceState.items.filter(i => !i.disabled).length }) : 'none'`));
  console.log('G sees overlay:', await ev(G, `getComputedStyle(document.getElementById('choiceOverlay')).display + '/' + document.getElementById('choiceOverlay').className + '/' + document.querySelectorAll('#choiceCards .mulligan-card').length`));
  console.log('H banner:', await ev(H, `document.getElementById('onlineBanner').textContent`), '| G banner:', await ev(G, `document.getElementById('onlineBanner').textContent`));
  fs.writeFileSync(path.join(outDir, 'rv-h.png'), (await H.webContents.capturePage()).toPNG());
  fs.writeFileSync(path.join(outDir, 'rv-g.png'), (await G.webContents.capturePage()).toPNG());
  // 選ぶ側(ホスト)が選べるカードを1枚選んで決定 → 相手(ゲスト)の手札が1枚減る
  await ev(H, `(function(){ const c = document.querySelector('#choiceCards .mulligan-card:not(.dim)'); if (c) c.click(); })()`); await sleep(400);
  await ev(H, `(function(){ const b = Array.from(document.querySelectorAll('#choiceActions button')).find(x => x.textContent.includes('リムーブさせる')); if (b) b.click(); })()`); await sleep(1500);
  console.log('HAND after: opp', await ev(H, `match.opponent.hand.length`), 'remove', await ev(H, `match.opponent.remove.length`), 'choice:', await ev(H, `choiceState ? 'still' : 'closed'`));
  console.log('LOG tail:', await ev(G, `Array.from(document.querySelectorAll('#onlineLog .ln')).slice(-3).map(x => x.textContent).join(' // ')`));
  app.exit(0);
});
setTimeout(() => { console.log('TIMEOUT'); app.exit(1); }, 90000);
