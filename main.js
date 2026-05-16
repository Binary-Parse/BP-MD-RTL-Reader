const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// ==== SECURITY: ALLOWLIST ====
// JB1: Only paths that were returned by dialog:openFolder are allowed for
// fs:readVault. The renderer cannot pass arbitrary paths.
const allowedFolders = new Set();

// ==== FILE ASSOCIATION ====
// When the user double-clicks a .md file in Explorer (and Marqam is the
// registered handler) Windows launches the app with the file path as argv[1].
// Parse argv, validate the path is a real markdown file, read it in main
// process (trusted side), and queue it to be sent to the renderer once the
// window finishes loading.
let pendingFileToOpen = null;
const MAX_OPEN_FILE_BYTES = 10 * 1024 * 1024; // 10 MiB hard cap (same as readVault)

function parseFileArg(argv) {
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (typeof a !== 'string') continue;
    if (a.startsWith('-')) continue;                // skip flags like --inspect
    if (!/\.(md|markdown|txt)$/i.test(a)) continue; // only markdown extensions
    try {
      // Resolve to a real absolute path; rejects relative-traversal trickery.
      const real = fs.realpathSync(a);
      const stat = fs.statSync(real);
      if (!stat.isFile()) continue;
      if (stat.size > MAX_OPEN_FILE_BYTES) continue;
      return real;
    } catch (_) { continue; }
  }
  return null;
}

function deliverPendingFile(win) {
  if (!pendingFileToOpen || !win || win.isDestroyed()) return;
  const filePath = pendingFileToOpen;
  pendingFileToOpen = null;
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1); // strip BOM
    win.webContents.send('open-external-file', {
      name: path.basename(filePath),
      path: filePath,
      content
    });
  } catch (_) { /* silent — user just sees no file loaded */ }
}

// Resource bounds for fs:readVault (JB3)
const MAX_FILES_PER_DIR = 5000;
const MAX_FILE_BYTES    = 10 * 1024 * 1024;  // 10 MiB per file
const MAX_CUMULATIVE_BYTES = 100 * 1024 * 1024; // 100 MiB total

// ==== IPC HANDLERS ====
// Registered once at app.whenReady() — before createWindow() — so that
// macOS dock re-activation (which re-calls createWindow) never triggers
// the "attempted to register a second handler" fatal error.
function registerIpcHandlers() {
  // ==== OPEN FOLDER IPC ====
  // Returns { canceled: boolean, folderPath: string|null }
  ipcMain.handle('dialog:openFolder', async () => {
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: 'Open Folder'
    });
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return { canceled: true, folderPath: null };
    }
    // JB1: register the dialog-returned path in the allowlist
    allowedFolders.add(result.filePaths[0]);
    return { canceled: false, folderPath: result.filePaths[0] };
  });

  // ==== READ VAULT IPC ====
  // Returns [{ name, relPath, content }] for all .md/.markdown files in folderPath
  ipcMain.handle('fs:readVault', async (event, folderPath) => {
    if (!folderPath || typeof folderPath !== 'string') {
      throw new Error('Invalid folder path');
    }

    // JB2: Reject UNC/network paths (prevents SMB-auth hash leak, CWE-918)
    if (folderPath.startsWith('\\\\') || folderPath.startsWith('//')) {
      return { error: 'network-path-not-allowed' };
    }

    // JB1: Path must have been returned by dialog:openFolder — renderer cannot
    // supply arbitrary paths.
    if (!allowedFolders.has(folderPath)) {
      return { error: 'unauthorized-path' };
    }

    const entries = await fs.promises.readdir(folderPath, { withFileTypes: true });

    // JB3: cap file count to prevent DoS via enormous directories
    if (entries.length > MAX_FILES_PER_DIR) {
      return { error: 'too-many-files' };
    }

    const mdFiles = entries
      .filter(e => (e.isFile() || e.isSymbolicLink()) && /\.(md|markdown)$/i.test(e.name))
      .map(e => e.name)
      .sort((a, b) => a.localeCompare(b));

    const results = [];
    let cumulativeBytes = 0;

    for (const name of mdFiles) {
      const fullPath = path.join(folderPath, name);

      // JB4: Symlink/realpath escape check — skip files that resolve outside folderPath
      const lstat = await fs.promises.lstat(fullPath);
      if (lstat.isSymbolicLink()) {
        const real = await fs.promises.realpath(fullPath);
        const rel = path.relative(folderPath, real);
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
          continue; // symlink escape — skip silently
        }
      }

      // JB3: per-file size cap (use lstat size for symlinks already resolved above;
      // for regular files lstat and stat are equivalent)
      const stat = lstat.isSymbolicLink()
        ? await fs.promises.stat(fullPath)
        : lstat;
      if (stat.size > MAX_FILE_BYTES) {
        continue; // skip oversized files silently
      }

      // JB3: cumulative bytes cap
      cumulativeBytes += stat.size;
      if (cumulativeBytes > MAX_CUMULATIVE_BYTES) {
        return { error: 'cumulative-size-exceeded', partial: results };
      }

      let content = await fs.promises.readFile(fullPath, 'utf8');
      // Strip BOM if present (matches browser File API behavior)
      if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
      results.push({ name, relPath: name, content });
    }
    return results;
  });

  // ==== EDIT COMMAND IPC ====
  // Uses Chromium's native webContents methods so clipboard ops work whether
  // the user is in a source-mode textarea OR has text selected in the live
  // preview DIV. These target the focused editable inside the renderer without
  // depending on document.activeElement, which the menu click disrupts.
  ipcMain.on('edit:command', (event, cmd) => {
    const wc = event.sender;
    if (!wc || wc.isDestroyed()) return;
    try {
      if (cmd === 'copy')           wc.copy();
      else if (cmd === 'cut')       wc.cut();
      else if (cmd === 'paste')     wc.paste();
      else if (cmd === 'undo')      wc.undo();
      else if (cmd === 'redo')      wc.redo();
      else if (cmd === 'selectAll') wc.selectAll();
    } catch (_) { /* no-op */ }
  });
}

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

  // Once renderer is ready, deliver any file that was passed on the command
  // line. We listen for did-finish-load AND a renderer-side 'renderer-ready'
  // event so the file shows up regardless of which one fires first.
  win.webContents.on('did-finish-load', () => deliverPendingFile(win));

  // Window control IPC
  ipcMain.on('window-close',    () => win.close());
  ipcMain.on('window-minimize', () => win.minimize());
  ipcMain.on('window-maximize', () => win.isMaximized() ? win.unmaximize() : win.maximize());

  // Open external links in system browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ==== SINGLE-INSTANCE LOCK ====
// If the app is already running and the user double-clicks another .md, the
// OS launches a second process. We hand off the file to the existing window
// instead of opening a duplicate.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const file = parseFileArg(argv);
    const wins = BrowserWindow.getAllWindows();
    if (wins.length === 0) return;
    const win = wins[0];
    if (win.isMinimized()) win.restore();
    win.focus();
    if (file) {
      pendingFileToOpen = file;
      deliverPendingFile(win);
    }
  });

  app.whenReady().then(() => {
    pendingFileToOpen = parseFileArg(process.argv);
    registerIpcHandlers();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  // macOS: user dropped a .md file on the dock icon
  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    if (!filePath) return;
    pendingFileToOpen = filePath;
    const wins = BrowserWindow.getAllWindows();
    if (wins.length > 0) deliverPendingFile(wins[0]);
    // else: it'll be delivered when the window finishes loading
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
