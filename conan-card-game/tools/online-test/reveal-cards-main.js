// 「相手は手札を公開する」を持つ全カード(0360/0827/0703/0149/0064)を、ホストの画面で出して、公開の選択画面が出るかを確かめる
// 使い方: electron reveal-cards-main.js <出力フォルダ>
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
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
  const pass = 'rc-' + Math.random().toString(36).slice(2);
  await ev(W1, `document.getElementById('lobbyPass').value='${pass}';document.getElementById('lobbyName').value='A';document.getElementById('lobbyDeck').selectedIndex=0;document.getElementById('lobbyStart').click();1`);
  await sleep(1500);
  await ev(W2, `document.getElementById('lobbyPass').value='${pass}';document.getElementById('lobbyName').value='B';document.getElementById('lobbyDeck').selectedIndex=1;document.getElementById('lobbyStart').click();1`);
  for (let i = 0; i < 40; i++) { await sleep(500); if (await ev(W1, `document.getElementById('lobby').classList.contains('hidden')`) && await ev(W2, `document.getElementById('lobby').classList.contains('hidden')`)) break; }
  await sleep(2000);
  const H = (await ev(W1, `document.body.classList.contains('host')`)) ? W1 : W2, G = H === W1 ? W2 : W1;
  for (let k = 0; k < 2; k++) { const who = await ev(H, `mulliganPhase`); if (!who) break; await ev(who === 'self' ? H : G, `document.getElementById('mulliganConfirmBtn').click()`); await sleep(1400); }
  await sleep(1500);
  for (const no of ['0360', '0827', '0703', '0149', '0064']) {
    const r = JSON.parse(await ev(H, `(function(){
      try { clearUiForTest && clearUiForTest(); } catch (e) {}
      const c = CARD_DATA.find(x => x.card_id === '${no}');
      const col = ((c.color || '黒').match(/[赤青黄緑白黒]/) || ['黒'])[0];
      const cs = CARD_DATA.find(x => x.card_type === '事件' && x.color === col), pt = CARD_DATA.find(x => x.card_type === 'パートナー' && x.color === col);
      choiceState = null; document.getElementById('choiceOverlay').style.display = 'none';
      match.turn.activeSide = 'self'; match.turn.phase = 'main'; match.turn.playedCardThisTurn = false; match.turn.declaredAbilityUids = [];
      match.self.case = Object.assign({}, match.self.case, { cardId: cs.id });
      match.self.partner = Object.assign({}, match.self.partner, { cardId: pt.id });
      match.self.field = []; match.self.hand = match.self.hand.filter(h => !h.uid.startsWith('self-t'));
      match.self.hand.push({ cardId: c.id, uid: 'self-t${no}' });
      match.self.file = Array.from({ length: 9 }, () => ({ cardId: c.id, uid: 'f' + Math.random() }));
      while (match.opponent.hand.length < 5) match.opponent.hand.push({ cardId: c.id, uid: 'opp-x' + Math.random() });
      renderBoard(match);
      const chk = canPlayHandCard('self', 'self-t${no}'); if (!chk.ok) return JSON.stringify({ chk });
      if ('${no}' === '0064') { playCard('self', 'self-t${no}'); return JSON.stringify({ played: true }); }
      playCard('self', 'self-t${no}'); return JSON.stringify({ played: true }); })()`));
    await sleep(4000);
    let info = await ev(H, `choiceState ? JSON.stringify({ t: choiceState.title, pub: !!choiceState.public, n: choiceState.items.length, ok: choiceState.items.filter(i => !i.disabled).length }) : 'none'`);
    if (no === '0064' && info === 'none') {
      // 推理したとき: 現場の 0064 で推理する
      await ev(H, `(function(){ const u = match.self.field.find(c => defOfInst(c).card_id === '0064'); if (u) { u.sleeping = false; u.justEntered = false; match.turn.declaredAbilityUids = []; performReason('self', 'char', u.uid); } })()`);
      await sleep(3500);
      info = await ev(H, `choiceState ? JSON.stringify({ t: choiceState.title, pub: !!choiceState.public, n: choiceState.items.length, ok: choiceState.items.filter(i => !i.disabled).length }) : 'none'`);
    }
    const g = await ev(G, `getComputedStyle(document.getElementById('choiceOverlay')).display + '/' + document.querySelectorAll('#choiceCards .mulligan-card').length`);
    const pre = info;
    await ev(H, `(function(){ const b = Array.from(document.querySelectorAll('#choiceActions button')).find(x => /閉じる|選ばない/.test(x.textContent)); if (b) b.click(); })()`);
    await sleep(1200);
    const next = await ev(H, `choiceState ? choiceState.title + '/' + choiceState.items.length : 'none'`);
    console.log('   after close ->', next);
    console.log(no, JSON.stringify(r), '| host choice:', info, '| guest overlay/cards:', g);
  }
  app.exit(0);
});
setTimeout(() => { console.log('TIMEOUT'); app.exit(1); }, 120000);
