const { contextBridge, ipcRenderer } = require('electron');

// リプレイ再生時だけ、タスクバーも隠れる全画面表示に自動で切り替えるための
// 最小限のブリッジ(contextIsolation:trueのままメインプロセスの機能を安全に呼ぶ)
contextBridge.exposeInMainWorld('electronAPI', {
  setFullscreen: (flag) => ipcRenderer.send('set-fullscreen', !!flag),
});
