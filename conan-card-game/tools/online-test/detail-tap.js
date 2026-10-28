// 詳細パネルを開いて、本体の部分をタップして閉じるかを確かめる: electron detail-tap.js
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
app.whenReady().then(async () => {
  ipcMain.on('image-config', e => { e.returnValue = { dir: null, files: [] }; });
  ipcMain.on('set-fullscreen', () => {});
  const w = new BrowserWindow({ show: false, width: 560, height: 980, webPreferences: { contextIsolation: true, preload: path.resolve(__dirname, '../../preload.js') } });
  await w.loadFile(path.resolve(__dirname, '../../online.html'));
  const ev = c => w.webContents.executeJavaScript(c);
  await ev(`CardDetail.open(CARD_DATA[10].id)`);
  console.log('open:', await ev(`document.getElementById('cardDetail').style.display`));
  const r = await ev(`(function(){ const b = document.querySelector('#cardDetail .cd-text').getBoundingClientRect(); return { x: Math.round(b.x + b.width/2), y: Math.round(b.y + b.height/2) }; })()`);
  w.webContents.sendInputEvent({ type: 'mouseMove', x: r.x, y: r.y });
  w.webContents.sendInputEvent({ type: 'mouseDown', x: r.x, y: r.y, button: 'left', clickCount: 1 });
  w.webContents.sendInputEvent({ type: 'mouseUp', x: r.x, y: r.y, button: 'left', clickCount: 1 });
  await sleep(400);
  console.log('after tap on text:', await ev(`document.getElementById('cardDetail').style.display`));
  app.exit(0);
});
setTimeout(() => app.exit(1), 30000);
