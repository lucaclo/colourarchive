// The notes-in-words key window's only way to reach main.cjs: save the key,
// remove it, close, ask whether one is saved, or open the page that gives one.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('notesKey', {
  hasKey: () => ipcRenderer.invoke('notes-key-has'),
  save: (key) => ipcRenderer.invoke('notes-key-save', key),
  remove: () => ipcRenderer.invoke('notes-key-remove'),
  cancel: () => ipcRenderer.invoke('notes-key-cancel'),
  getKeyPage: () => ipcRenderer.invoke('notes-key-page'),
});
