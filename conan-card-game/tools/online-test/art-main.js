const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path'), fs = require('fs');
app.whenReady().then(async () => {
  ipcMain.on('image-config', e => { e.returnValue = { dir: null, files: [] }; });
  const w = new BrowserWindow({ show: false, width: 420, height: 900, webPreferences: { contextIsolation: true } });
  await w.loadFile(path.resolve('build-friend/deckbuilder.html')); await new Promise(r => setTimeout(r, 800));
  const ev = c => w.webContents.executeJavaScript(c), sleep = ms => new Promise(r => setTimeout(r, ms));
  await ev(`document.querySelectorAll('.tab-btn')[2].click()`); await sleep(300);
  await ev(`(function(){const i=document.getElementById('searchInput');i.value='江戸川コナン';i.dispatchEvent(new Event('input'));})()`); await sleep(300);
  await ev(`document.getElementById('cardGrid').scrollIntoView()`); await sleep(200);
  fs.writeFileSync('C:/Users/kazuyan/AppData/Local/Temp/claude/c--Users-kazuyan-Desktop-------conan/f4002012-0f44-4068-bcd0-5db7b527a39f/scratchpad/art1.png', (await w.webContents.capturePage()).toPNG());
  await ev(`document.querySelectorAll('#cardGrid .pool-card')[5].dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))`); await sleep(300);
  fs.writeFileSync('C:/Users/kazuyan/AppData/Local/Temp/claude/c--Users-kazuyan-Desktop-------conan/f4002012-0f44-4068-bcd0-5db7b527a39f/scratchpad/art2.png', (await w.webContents.capturePage()).toPNG());
  app.exit(0);
});
setTimeout(() => app.exit(1), 30000);
