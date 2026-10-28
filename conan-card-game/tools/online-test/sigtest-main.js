const { app, BrowserWindow } = require('electron');
const path = require('path');
app.whenReady().then(() => {
  const pass = 'test-' + Math.random().toString(36).slice(2);
  ['A','B'].forEach((n, i) => {
    const w = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true } });
    w.webContents.on('console-message', (e, level, msg) => console.log(msg.slice ? msg.slice(0, 160) : msg));
    setTimeout(() => w.loadFile(path.join(__dirname, 'sigtest.html'), { query: { pass, n } }), i * 1500);
  });
  setTimeout(() => { console.log('TIMEOUT-EXIT'); app.exit(0); }, 60000);
});
