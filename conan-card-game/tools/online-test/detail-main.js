const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
app.whenReady().then(async () => {
  ipcMain.on('image-config', e => { e.returnValue = { dir: null, files: [] }; });
  const w = new BrowserWindow({ show: false, width: 420, height: 900, webPreferences: { contextIsolation: true } });
  await w.loadFile(path.resolve('build-friend/deckbuilder.html')); await new Promise(r => setTimeout(r, 800));
  const ev = c => w.webContents.executeJavaScript(c), sleep = ms => new Promise(r => setTimeout(r, ms));
  await ev(`document.querySelectorAll('.tab-btn')[2].click()`); await sleep(300);
  await ev(`(function(){const i=document.getElementById('searchInput');i.value='江戸川コナン';i.dispatchEvent(new Event('input'));})()`); await sleep(300);
  const n = await ev(`document.querySelectorAll('#cardGrid .pool-card').length`);
  console.log('tiles', n);
  const out = [];
  for (let i = 0; i < Math.min(n, 12); i++) {
    await ev(`(function(){const t=document.querySelectorAll('#cardGrid .pool-card')[${i}]; const r=t.getBoundingClientRect(); t.scrollIntoView(); t.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));})()`);
    await sleep(100);
    out.push(await ev(`(document.querySelector('#cardDetail .cd-row:last-of-type b')||{}).textContent + ' | ' + (document.querySelector('#cardDetail .cd-text')||{}).textContent.slice(0,20) + ' | ' + document.querySelectorAll('#cardGrid .pool-card')[${i}].querySelector('img').getAttribute('src').length`));
    await ev(`window.CardDetail.close()`);
  }
  console.log(out.join('\n'));
  app.exit(0);
});
setTimeout(() => app.exit(1), 40000);
