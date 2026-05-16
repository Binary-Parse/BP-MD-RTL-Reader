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
  // Receives file content when the user double-clicked a .md file in Explorer
  // (file association) or dropped one on the macOS dock. The renderer wraps
  // this in addFile() to surface the content immediately.
  onOpenFile: (cb) => ipcRenderer.on('open-external-file', (_e, data) => cb(data)),
});
