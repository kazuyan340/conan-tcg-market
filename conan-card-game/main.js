const { app, BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');

function createWindow() {
  // ユーザーの画面が1200x900より小さいと、ウィンドウが画面からはみ出して
  // 盤面の下側(デッキなど)が物理的に画面外に隠れてしまうため、
  // 実際の作業領域(タスクバーなどを除いた表示可能な範囲)に収まるサイズに調整する
  const { width: workW, height: workH } = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.min(1200, workW);
  const height = Math.min(900, workH);

  const win = new BrowserWindow({
    width,
    height,
    autoHideMenuBar: true,
    title: '名探偵コナンTCG AI観戦ビューア',
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  if (width < 1200 || height < 900) win.maximize();

  win.loadFile(path.join(__dirname, 'index.html'));
  return win;
}

app.whenReady().then(() => {
  const win = createWindow();

  // リプレイ再生時だけ、タスクバーも隠れる全画面表示に自動で切り替える
  // (preload.js経由でレンダラーから安全に呼べるようにしたもの)
  ipcMain.on('set-fullscreen', (event, flag) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender) || win;
    if (senderWin && !senderWin.isDestroyed()) senderWin.setFullScreen(flag);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
