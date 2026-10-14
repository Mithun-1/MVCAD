const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('mvcadDesktop', {
  updateState: () => ipcRenderer.invoke('mvcad:update-state'),
  checkForUpdates: () => ipcRenderer.invoke('mvcad:update-check'),
  downloadUpdate: () => ipcRenderer.invoke('mvcad:update-download'),
  installUpdate: () => ipcRenderer.invoke('mvcad:update-install'),
  onUpdate: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('mvcad:update-status', listener);
    return () => ipcRenderer.removeListener('mvcad:update-status', listener);
  },
});
