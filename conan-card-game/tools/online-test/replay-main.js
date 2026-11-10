// CPU対戦の動作確認: electron cpu-main.js <outdir> [秒数] [first=opponent|self]
const { app, BrowserWindow } = require('electron');
const path = require('path'), fs = require('fs');
const outDir = process.argv[2], secs = +(process.argv[3] || 40), first = process.argv[4] || 'opponent', aiT = process.argv[5] || 'control';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SEED = fs.readFileSync(path.join(__dirname, 'duo-main.js'), 'utf8').match(/const SEED = `([\s\S]*?)`;/)[1];
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1500, height: 900, show: false, useContentSize: true,
    webPreferences: { contextIsolation: true, preload: path.resolve(__dirname, '../../preload.js') } });
  const errs = [];
  win.webContents.on('console-message', (e, l, msg) => { if (l >= 3 || /cpu/.test(msg)) errs.push(String(msg).slice(0, 200)); });
  await win.loadFile(path.resolve(__dirname, '../../battle.html'));
  await win.webContents.executeJavaScript(SEED);
  await win.loadFile(path.resolve(__dirname, '../../battle.html'));
  await win.webContents.executeJavaScript(`(function(){
    window.CPU_PRESET_DECKS = loadSavedDecks().slice(1);
    document.getElementById('cpuModeChk').checked = true; document.getElementById('cpuModeChk').dispatchEvent(new Event('change')); document.getElementById('cpuTypeSelect').value = '${aiT}';
    document.getElementById('firstPlayerSelect').value = '${first}';
    document.getElementById('selfDeckSelect').value = '0'; document.getElementById('oppDeckSelect').value = '0';
    document.getElementById('startBtn').click();
    // 人間側の代わり: マリガンはそのまま、ターンは何もせず終了
    window.__human = setInterval(() => {
      if (!match || match.gameOver) return;
      if (mulliganPhase === 'self') { document.getElementById('mulliganConfirmBtn').click(); return; }
      if (match.turn && match.turn.activeSide === 'self' && match.turn.phase === 'main' && !choiceState && !actionState && !contactState && !handDiscardState) { try { endTurn(); } catch (e) {} }
    }, 700);
  })()`);
  await sleep(15000);
  fs.mkdirSync(outDir, { recursive: true });
  for (const portrait of [false, true]) {
    await win.webContents.executeJavaScript(`(function(){ clearInterval(window.__human); const m = match; try { localStorage.setItem('conanTcgReplayPortrait', '${portrait ? 1 : 0}'); } catch (e) {} replayPortrait = ${portrait}; replayFlip = ${portrait}; startReplay({ self: m.config.self, opponent: m.config.opponent, firstPlayer: m.firstPlayer, events: m.events.slice() }); for (let i = 0; i < 30; i++) { try { replayNext(); } catch (e) {} } })()`);
    await sleep(1500);
    fs.writeFileSync(path.join(outDir, 'replay-' + (portrait ? 'p' : 'l') + '.png'), (await win.webContents.capturePage()).toPNG());
    console.log(portrait, await win.webContents.executeJavaScript(`document.getElementById('replayFlipBtn').textContent + ' ' + document.body.className + ' ' + document.querySelector('.table').style.transform`));
  }
  console.log('ERRS', JSON.stringify(errs.slice(0, 8)));
  app.exit(0);
});
