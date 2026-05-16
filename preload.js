const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  closeWindow:    () => ipcRenderer.send('window-close'),
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  // Open Folder IPC bridge (Bug 1 / AC1)
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  readVault:  (folderPath) => ipcRenderer.invoke('fs:readVault', folderPath),
  // Edit command bridge — delegates clipboard/undo/redo to Chromium's native
  // webContents.copy/cut/paste/undo/redo/selectAll which operate on the focused
  // editable regardless of JS-side focus juggling caused by the menu opening.
  editCommand: (cmd) => ipcRenderer.send('edit:command', cmd),
});
