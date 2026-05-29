const path = require('path');
const {
  parseFileArg,
  isAuthorizedPath,
  isNetworkPath,
  isTooManyFiles,
  isOversizedFile,
  wouldExceedCumulative,
  isSymlinkEscape,
  stripBOM,
  filterAndSortMdFiles,
} = require('./src/main-logic');

// ==== INJECTABLE BOOTSTRAP (audit #3) ====
// All Electron/fs side-effects live inside bootstrap() so the module can be
// imported (by Vitest/Stryker) WITHOUT running the real app and WITHOUT a
// Module._resolveFilename hijack. The real app entry calls bootstrap() with
// the live electron/fs/process at the bottom of this file (guarded by
// require.main === module), so runtime behaviour is identical to before.
//
// @param {object} deps
// @param {object} deps.electron - the 'electron' module (or a mock)
// @param {object} deps.fs       - the 'fs' module (or a mock)
// @param {object} [deps.proc]   - process-like object (argv/platform/on); defaults to global process
function bootstrap({ electron, fs, proc = process }) {
  const { app, BrowserWindow, ipcMain, shell, dialog, crashReporter, Menu } = electron;

  // ==== OBSERVABILITY ====
  // Local-only crash + error capture. NO data leaves the user's machine
  // (uploadToServer: false). Minidumps land in app.getPath('crashDumps');
  // JS errors land in <userData>/logs/bpmdrtlreader.log (rotated at 1 MiB, keep 3).
  crashReporter.start({ uploadToServer: false, submitURL: '' });

  const LOG_MAX_BYTES = 1024 * 1024;
  const LOG_KEEP = 3;
  let logFilePath = null;

  function ensureLogPath() {
    if (logFilePath) return logFilePath;
    const dir = path.join(app.getPath('userData'), 'logs');
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) { /* ignore */ }
    logFilePath = path.join(dir, 'bpmdrtlreader.log');
    return logFilePath;
  }

  function rotateIfNeeded(p) {
    try {
      const st = fs.statSync(p);
      if (st.size < LOG_MAX_BYTES) return;
      for (let i = LOG_KEEP - 1; i >= 1; i--) {
        const older = `${p}.${i + 1}`;
        const newer = `${p}.${i}`;
        if (fs.existsSync(newer)) fs.renameSync(newer, older);
      }
      fs.renameSync(p, `${p}.1`);
    } catch (_) { /* file doesn't exist yet, or rotation failed — ignore */ }
  }

  function writeLog(level, source, message, stack) {
    try {
      const p = ensureLogPath();
      rotateIfNeeded(p);
      const line = JSON.stringify({
        ts: new Date().toISOString(),
        level,
        source,
        message: String(message ?? '').slice(0, 4000),
        stack: stack ? String(stack).slice(0, 8000) : undefined,
      }) + '\n';
      fs.appendFileSync(p, line);
    } catch (_) { /* never let logging crash the process */ }
  }

  proc.on('uncaughtException', (err) => {
    writeLog('error', 'main:uncaughtException', err?.message, err?.stack);
  });
  proc.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    const stk = reason instanceof Error ? reason.stack : undefined;
    writeLog('error', 'main:unhandledRejection', msg, stk);
  });

  // ==== SECURITY: ALLOWLIST ====
  const allowedFolders = new Set();

  // ==== FILE ASSOCIATION ====
  let pendingFileToOpen = null;

  function deliverPendingFile(win) {
    if (!pendingFileToOpen || !win || win.isDestroyed()) return;
    const filePath = pendingFileToOpen;
    pendingFileToOpen = null;
    try {
      let content = fs.readFileSync(filePath, 'utf8');
      content = stripBOM(content);
      win.webContents.send('open-external-file', {
        name: path.basename(filePath),
        path: filePath,
        content
      });
    } catch (_) { /* silent */ }
  }

  // ==== IPC HANDLERS ====
  function registerIpcHandlers() {
    ipcMain.handle('dialog:openFolder', async () => {
      const win = BrowserWindow.getFocusedWindow();
      const result = await dialog.showOpenDialog(win, {
        properties: ['openDirectory'],
        title: 'Open Folder'
      });
      if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        return { canceled: true, folderPath: null };
      }
      allowedFolders.add(result.filePaths[0]);
      return { canceled: false, folderPath: result.filePaths[0] };
    });

    ipcMain.handle('fs:readVault', async (event, folderPath) => {
      if (!folderPath || typeof folderPath !== 'string') {
        throw new Error('Invalid folder path');
      }

      if (isNetworkPath(folderPath)) {
        return { error: 'network-path-not-allowed' };
      }

      if (!isAuthorizedPath(folderPath, allowedFolders)) {
        return { error: 'unauthorized-path' };
      }

      const entries = await fs.promises.readdir(folderPath, { withFileTypes: true });

      if (isTooManyFiles(entries.length)) {
        return { error: 'too-many-files' };
      }

      const mdFiles = filterAndSortMdFiles(entries);
      const results = [];
      let cumulativeBytes = 0;

      for (const name of mdFiles) {
        const fullPath = path.join(folderPath, name);

        const lstat = await fs.promises.lstat(fullPath);
        if (lstat.isSymbolicLink()) {
          const real = await fs.promises.realpath(fullPath);
          if (isSymlinkEscape(real, folderPath, path)) {
            continue;
          }
        }

        const stat = lstat.isSymbolicLink()
          ? await fs.promises.stat(fullPath)
          : lstat;
        if (isOversizedFile(stat.size)) {
          continue;
        }

        cumulativeBytes += stat.size;
        if (wouldExceedCumulative(cumulativeBytes, 0)) {
          return { error: 'cumulative-size-exceeded', partial: results };
        }

        let content = await fs.promises.readFile(fullPath, 'utf8');
        content = stripBOM(content);
        results.push({ name, relPath: name, content });
      }
      return results;
    });

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

    // Renderer-side errors (window.onerror, unhandledrejection) → local log.
    // Rate-limited (audit #27): a renderer error in a hot loop must not flood
    // the main process. Counter resets every minute; over-cap messages are
    // dropped, and a single "dropped N" summary is logged at the next rollover.
    const LOG_RATE_LIMIT_PER_MIN = 100;
    let logWindowStart = Date.now();
    let logCount = 0;
    let logDropped = 0;
    ipcMain.on('log:error', (_event, payload) => {
      if (!payload || typeof payload !== 'object') return;
      const now = Date.now();
      if (now - logWindowStart > 60_000) {
        if (logDropped > 0) {
          writeLog('warn', 'main:rateLimit',
            `dropped ${logDropped} renderer log entries (cap ${LOG_RATE_LIMIT_PER_MIN}/min)`);
        }
        logWindowStart = now;
        logCount = 0;
        logDropped = 0;
      }
      if (logCount >= LOG_RATE_LIMIT_PER_MIN) {
        logDropped++;
        return;
      }
      logCount++;
      writeLog('error', 'renderer', payload.message, payload.stack);
    });
  }

  function createWindow() {
    const win = new BrowserWindow({
      width: 1280,
      height: 820,
      minWidth: 800,
      minHeight: 600,
      title: 'BP MD RTL Reader',
      icon: path.join(__dirname, 'icon.ico'),
      backgroundColor: '#1A1713',
      frame: false,
      transparent: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'),
      },
    });

    win.loadFile('index.html');
    win.webContents.on('did-finish-load', () => deliverPendingFile(win));

    ipcMain.on('window-close',    () => win.close());
    ipcMain.on('window-minimize', () => win.minimize());
    ipcMain.on('window-maximize', () => win.isMaximized() ? win.unmaximize() : win.maximize());

    win.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('http')) shell.openExternal(url);
      return { action: 'deny' };
    });

    // ==== RIGHT-CLICK CONTEXT MENU ====
    // Native editing roles (undo/redo/cut/copy/paste/selectAll) run on the focused
    // element with correct timing — far more reliable than routing through IPC.
    // Items + enabled state come from Chromium via params.editFlags / isEditable,
    // so this works in the source textarea AND for copy in the live-preview div.
    win.webContents.on('context-menu', (_event, params) => {
      const f = params.editFlags || {};
      const template = [];
      if (params.isEditable) {
        template.push({ role: 'undo', enabled: !!f.canUndo });
        template.push({ role: 'redo', enabled: !!f.canRedo });
        template.push({ type: 'separator' });
        template.push({ role: 'cut', enabled: !!f.canCut });
        template.push({ role: 'copy', enabled: !!f.canCopy });
        template.push({ role: 'paste', enabled: !!f.canPaste });
        template.push({ type: 'separator' });
        template.push({ role: 'selectAll', enabled: !!f.canSelectAll });
      } else if (params.selectionText && params.selectionText.trim() !== '') {
        // Non-editable surface (e.g. live preview): offer Copy + Select All.
        template.push({ role: 'copy', enabled: !!f.canCopy });
        template.push({ role: 'selectAll', enabled: !!f.canSelectAll });
      }
      if (template.length === 0) return;
      Menu.buildFromTemplate(template).popup({ window: win });
    });

    return win;
  }

  // ==== SINGLE-INSTANCE LOCK ====
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  } else {
    app.on('second-instance', (_event, argv) => {
      const file = parseFileArg(argv, fs);
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
      pendingFileToOpen = parseFileArg(proc.argv, fs);
      registerIpcHandlers();
      createWindow();
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
      });
    });

    app.on('open-file', (event, filePath) => {
      event.preventDefault();
      if (!filePath) return;
      pendingFileToOpen = filePath;
      const wins = BrowserWindow.getAllWindows();
      if (wins.length > 0) deliverPendingFile(wins[0]);
    });
  }

  app.on('window-all-closed', () => {
    if (proc.platform !== 'darwin') app.quit();
  });

  return { createWindow, registerIpcHandlers };
}

module.exports = { bootstrap };

// ==== REAL APP ENTRY ====
// Only run the live bootstrap when this file is the Electron main entry point.
// Under Vitest/Stryker the file is imported as a dependency (require.main is the
// test runner, not this module), so the guard is false and nothing auto-runs —
// the tests drive bootstrap() with mock electron/fs instead.
// Stryker disable all — this entry guard fires ONLY in the real Electron main
// process (require.main === module is false under Vitest/Stryker), so the lines
// are unreachable by unit tests and their mutants are unkillable by definition.
// bootstrap() itself is fully mutation-tested via the injected-seam tests.
if (require.main === module) {
  bootstrap({ electron: require('electron'), fs: require('fs') });
}
// Stryker restore all
