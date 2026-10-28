// 使い方: electron shot-main.js <html> <幅> <高さ> <実行するJS(ファイル)> <出力PNG> [待ち時間ms]
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), path = require('path');
const [html, w, h, jsFile, out, wait] = process.argv.slice(2);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: +w, height: +h, show: false, useContentSize: true,
    webPreferences: { contextIsolation: true, ...(/^https?:/.test(html) || process.env.NOPRELOAD ? {} : { preload: path.resolve(__dirname, '../../preload.js') }) } });
  win.webContents.on('console-message', (e, l, msg) => console.log('[page]', String(msg).slice(0, 300)));
  win.webContents.on('render-process-gone', () => console.log('RENDER GONE'));
  if (/^https?:/.test(html)) await win.loadURL(html); else await win.loadFile(path.resolve(html));
  if (jsFile && jsFile !== '-') {
    try { const r = await win.webContents.executeJavaScript(fs.readFileSync(jsFile, 'utf8')); if (r !== undefined) console.log('[result]', JSON.stringify(r).slice(0, 2000)); }
    catch (e) { console.log('[js error]', e.message); }
  }
  await new Promise(r => setTimeout(r, +(wait || 1500)));
  const img = await win.webContents.capturePage();
  fs.writeFileSync(out, img.toPNG());
  console.log('saved', out, img.getSize());
  app.exit(0);
});
