// CPU対戦の動作確認: electron cpu-main.js <outdir> [秒数] [first=opponent|self]
const { app, BrowserWindow } = require('electron');
const path = require('path'), fs = require('fs');
const outDir = process.argv[2], secs = +(process.argv[3] || 40), first = process.argv[4] || 'opponent', aiT = process.argv[5] || 'control';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SEED = fs.readFileSync(path.join(__dirname, 'duo-main.js'), 'utf8').match(/const SEED = `([\s\S]*?)`;/)[1];
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 430, height: 900, show: false, useContentSize: true,
    webPreferences: { contextIsolation: true } });
  const errs = []; console.log('start');
  win.webContents.on('console-message', (e, l, msg) => { if (l >= 3 || /cpu/.test(msg)) errs.push(String(msg).slice(0, 200)); });
  await win.loadFile(path.resolve(__dirname, '../../online.html'));
  await win.webContents.executeJavaScript(SEED);
  await win.loadFile(path.resolve(__dirname, '../../online.html'));
  await win.loadFile(path.resolve(__dirname, '../../online.html'));
  await win.webContents.executeJavaScript(`(function(){
    document.getElementById('lobbyName').value='テスト';
    document.getElementById('cpuType').value='${aiT}';
    document.getElementById('cpuStart').click();
    window.__human = setInterval(() => {
      if (!match || match.gameOver) return;
      if (hiramekiState && hiramekiState.side === 'self') { declineHirameki(); return; }
      if (mulliganPhase === 'self') { document.getElementById('mulliganConfirmBtn').click(); return; }
      if (match.turn && match.turn.activeSide === 'self' && match.turn.phase === 'main' && !choiceState && !actionState && !contactState && !handDiscardState) { try { endTurn(); } catch (e) {} }
    }, 700);
  })()`);
  const snap = `(function(){ const m = match; return JSON.stringify({ turn: m.turn && m.turn.turnNumber, active: m.turn && m.turn.activeSide, phase: m.turn && m.turn.phase, over: m.gameOver,
    cpu: { hand: m.opponent.hand.length, field: m.opponent.field.map(c => defOfInst(c).name + (c.sleeping ? '(s)' : '')), ev: m.opponent.evidence.length, file: m.opponent.file.length, rm: m.opponent.remove.length },
    me: { hand: m.self.hand.length, field: m.self.field.length, ev: m.self.evidence.length },
    pending: ['choiceState','handDiscardState','evidencePickState','deckPeekState','actionState','contactState','mulliganPhase'].filter(k => { try { return !!eval(k); } catch (e) { return false; } }) }); })()`;
  for (let t = 0; t < secs; t += 5) { await sleep(5000); console.log(await win.webContents.executeJavaScript(snap)); }
  console.log('STUCK', await win.webContents.executeJavaScript(`JSON.stringify({vis:[...document.querySelectorAll('[id]')].filter(e=>/overlay|panel/i.test(e.id) && getComputedStyle(e).display!=='none' && e.offsetParent!==null).map(e=>e.id), txt:(document.getElementById('actionHintBar')||{}).textContent, turn: match.turn, ev: match.events.slice(-4).map(e=>e.type)})`));
  console.log('LOG', await win.webContents.executeJavaScript(`JSON.stringify(match.events.filter(e => e.side === 'opponent' && /play|declare|caseDecl|handDiscard|deckMill|remove/i.test(e.type)).slice(-60).map(e => e.type + ':' + (e.uid ? (CARD_BY_ID.get(uidToCardId(e.uid)) || {}).name : '')))`));
  console.log('DBG', await win.webContents.executeJavaScript(`JSON.stringify({dp: deckPeekState && {step: deckPeekState.step, side: deckPeekState.side, actor: deckPeekState.actor, dest: deckPeekState.destination, rev: (deckPeekState.revealedUids||[]).length, mand: deckPeekState.mandatory, forceRemove: deckPeekState.forceRemove, pending: deckPeekState.pendingUid, chosen: deckPeekState.chosenUid}, ov: document.getElementById('deckPeekOverlay').style.display, btns: [...document.querySelectorAll('#deckPeekOverlay button')].map(b => b.id + ':' + b.style.display + ':' + b.textContent)})`));
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'cpu.png'), (await win.webContents.capturePage()).toPNG());
  console.log('ERRS', JSON.stringify(errs.slice(0, 8)));
  app.exit(0);
});
