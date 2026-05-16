const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 800,
    minHeight: 600,
    title: 'Marqam',
    icon: path.join(__dirname, 'icon.ico'),
    backgroundColor: '#1A1713',   // matches the app's dark border/outer bg
    frame: false,
    transparent: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  win.loadFile('marqam.html');

  // Window control IPC
  ipcMain.on('window-close',    () => win.close());
  ipcMain.on('window-minimize', () => win.minimize());
  ipcMain.on('window-maximize', () => win.isMaximized() ? win.unmaximize() : win.maximize());

  // Open external links in system browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });

  // ==== OPEN FOLDER IPC ====
  // Returns { canceled: boolean, folderPath: string|null }
  ipcMain.handle('dialog:openFolder', async (event) => {
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: 'Open Folder'
    });
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return { canceled: true, folderPath: null };
    }
    return { canceled: false, folderPath: result.filePaths[0] };
  });

  // Returns [{ name, relPath, content }] for all .md/.markdown files in folderPath
  ipcMain.handle('fs:readVault', async (event, folderPath) => {
    if (!folderPath || typeof folderPath !== 'string') {
      throw new Error('Invalid folder path');
    }
    const entries = await fs.promises.readdir(folderPath, { withFileTypes: true });
    const mdFiles = entries
      .filter(e => e.isFile() && /\.(md|markdown)$/i.test(e.name))
      .map(e => e.name)
      .sort((a, b) => a.localeCompare(b));

    const results = [];
    for (const name of mdFiles) {
      const fullPath = path.join(folderPath, name);
      let content = await fs.promises.readFile(fullPath, 'utf8');
      // Strip BOM if present (matches browser File API behavior)
      if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
      results.push({ name, relPath: name, content });
    }
    return results;
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
