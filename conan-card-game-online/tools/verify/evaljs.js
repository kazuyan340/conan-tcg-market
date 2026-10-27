// 使い方: electron evaljs.js <アプリのフォルダ> <userData> <式を書いたJSファイル>
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), path = require('path');
app.setPath('userData', process.argv[3]);
const expr = fs.readFileSync(process.argv[4], 'utf8');
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false });
  await w.loadFile(path.join(process.argv[2], 'battle.html'));
  await new Promise(r => setTimeout(r, 600));
  let out;
  try { out = await w.webContents.executeJavaScript('(async () => {' + expr + '})()'); } catch (e) { out = 'ERR ' + e.message; }
  console.log('EVAL_OUT ' + JSON.stringify(out));
  app.quit();
});
