// デッキ作成画面の検索の動作確認: node_modules/electron/dist/electron.exe tools/online-test/deckfilter-main.js
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
app.whenReady().then(async () => {
  ipcMain.on('image-config', e => { e.returnValue = { dir: null, files: [] }; });
  const w = new BrowserWindow({ show: false, width: 1000, height: 900, webPreferences: { contextIsolation: true, preload: path.resolve(__dirname, '../../preload.js') } });
  const errs = []; w.webContents.on('console-message', (e, l, m) => { if (l >= 3) errs.push(m); });
  await w.loadFile(path.resolve(__dirname, '../../deckbuilder.html'));
  const ev = c => w.webContents.executeJavaScript(c);
  await ev(`document.querySelectorAll('.tab-btn')[2].click()`); await sleep(300);
  const n = () => ev(`document.querySelectorAll('#cardGrid .pool-card').length`);
  const type = v => ev(`(function(){ const i = document.getElementById('searchInput'); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event('input')); })()`);
  const chip = t => ev(`Array.from(document.querySelectorAll('#scopeChips .kw-chip, #kwChips .kw-chip')).find(b => b.textContent === ${JSON.stringify(t)}).click()`);
  console.log('all', await n());
  await type('少年探偵団'); console.log('名前のみ:', await n());
  await chip('特徴'); await chip('名前・番号'); console.log('特徴のみ 少年探偵団:', await n());
  await type('少年探偵団 科学者'); console.log('特徴のみ 2語:', await n());
  await type('登場時'); await chip('特徴'); await chip('効果文'); console.log('効果文のみ 登場時:', await n());
  await type(''); await chip('【疾風】'); console.log('キーワード疾風:', await n());
  await chip('【疾風】'); await chip('突撃'); console.log('キーワード突撃:', await n());
  await type('少年探偵団'); await chip('名前・番号'); await chip('特徴'); console.log('名前+特徴(どちらかに含まれればOK) 少年探偵団:', await n());
  console.log('errors:', errs.length, errs.slice(0, 2));
  app.exit(0);
});
setTimeout(() => app.exit(1), 60000);
