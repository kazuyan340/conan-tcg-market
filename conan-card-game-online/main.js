const { app, BrowserWindow, screen, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// ---- カード画像フォルダの設定 ----
// 画像はアプリに同梱せず、ユーザーが公式サイトからダウンロードして置いたフォルダを指定して読み込む。
// フォルダの場所は userData/settings.json に保存する。
const IMAGE_EXT = /\.(jpe?g|png|webp|gif)$/i;
function settingsPath(){ return path.join(app.getPath('userData'), 'settings.json'); }
function readSettings(){
  try { return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')); } catch (e) { return {}; }
}
function writeSettings(obj){
  try { fs.mkdirSync(path.dirname(settingsPath()), { recursive: true }); fs.writeFileSync(settingsPath(), JSON.stringify(obj, null, 2)); } catch (e) {}
}
function scanImageDir(dir){
  if (!dir) return [];
  try { return fs.readdirSync(dir).filter(f => IMAGE_EXT.test(f)); } catch (e) { return []; }
}
function imageConfig(){
  const dir = readSettings().imageDir || null;
  return { dir, files: scanImageDir(dir) };
}

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
  ipcMain.on('image-config', (event) => { event.returnValue = imageConfig(); });
  ipcMain.handle('pick-image-dir', async (event) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender) || win;
    const r = await dialog.showOpenDialog(senderWin, { title: 'カード画像のフォルダを選択', properties: ['openDirectory'], defaultPath: readSettings().imageDir || undefined });
    if (r.canceled || !r.filePaths[0]) return imageConfig();
    writeSettings(Object.assign(readSettings(), { imageDir: r.filePaths[0] }));
    return imageConfig();
  });
  ipcMain.handle('clear-image-dir', async () => {
    const st = readSettings(); delete st.imageDir; writeSettings(st);
    return imageConfig();
  });
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
