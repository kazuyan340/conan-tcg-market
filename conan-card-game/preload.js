const { contextBridge, ipcRenderer } = require('electron');

// リプレイ再生時だけ、タスクバーも隠れる全画面表示に自動で切り替えるための
// 最小限のブリッジ(contextIsolation:trueのままメインプロセスの機能を安全に呼ぶ)
contextBridge.exposeInMainWorld('electronAPI', {
  setFullscreen: (flag) => ipcRenderer.send('set-fullscreen', !!flag),
  // カード画像フォルダ(ページ読み込み時に同期で取得し、画像の探索に使う)
  imageConfig: ipcRenderer.sendSync('image-config'),
  pickImageDir: () => ipcRenderer.invoke('pick-image-dir'),
  clearImageDir: () => ipcRenderer.invoke('clear-image-dir'),
});
