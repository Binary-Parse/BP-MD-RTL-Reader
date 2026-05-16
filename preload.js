const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  closeWindow:    () => ipcRenderer.send('window-close'),
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  // Open Folder IPC bridge (Bug 1 / AC1)
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  readVault:  (folderPath) => ipcRenderer.invoke('fs:readVault', folderPath),
});
