// The phone-password window's only way to reach main.cjs: set it, or don't.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('remote', {
  setPassword: (password) => ipcRenderer.invoke('remote-password', password),
  cancel: () => ipcRenderer.invoke('remote-cancel'),
});
