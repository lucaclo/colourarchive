// The start window's only way to reach main.cjs: three buttons and a feed of
// what to show. The archive window gets no preload at all.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('archive', {
  choose: (kind) => ipcRenderer.invoke('choose', kind),
  retry: () => ipcRenderer.invoke('retry'),
  showLog: () => ipcRenderer.invoke('show-log'),
  onState: (fn) => ipcRenderer.on('state', (_e, state) => fn(state)),
});
