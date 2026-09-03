const path = require('path');
const {
  parseFileArg,
  parseFileArgs,
  shouldResetChrome,
  isNetworkPath,
  isTooManyFiles,
  isOversizedFile,
  isAuthorizedPath,
  wouldExceedCumulative,
  isSymlinkEscape,
  filterAndSortMdFiles,
} = require('./main-logic');
const { classifyNavigation, isExternallyOpenable } = require('./navigation');
const { buildContextMenuTemplate, labelsForLocale } = require('./context-menu');
const { createDocumentStore, atomicWriteFile } = require('./document-store');
const { createCapabilityRegistry } = require('./capabilities');
const { createSettingsStore, clampWindowBounds, migrate, resetChromeSettings } = require('./settings');
const { compareVersions } = require('./version');
const { APP_RENDERER_URL } = require('./protocol');
const { createIpcController } = require('./ipc-controller');
const { createProtocolController } = require('./protocol-controller');
const { createWindowController } = require('./window-controller');
const { createPinnedGithubFetch } = require('./github-tls');
const crypto = require('crypto');

// ==== INJECTABLE BOOTSTRAP (audit #3) ====
// All Electron/fs side-effects live inside bootstrap() so the module can be
// imported (by Vitest/Stryker) WITHOUT running the real app and WITHOUT a
// Module._resolveFilename hijack. The real app entry calls bootstrap() with
// the live electron/fs/process at the bottom of this file (guarded by
// process.versions.electron), so runtime behaviour is identical to before.
//
// @param {object} deps
// @param {object} deps.electron - the 'electron' module (or a mock)
// @param {object} deps.fs       - the 'fs' module (or a mock)
// @param {object} [deps.proc]   - process-like object (argv/platform/on); defaults to global process
function bootstrap({ electron, fs, proc = process, fetchFn = createPinnedGithubFetch() }) {
  const { app, BrowserWindow, ipcMain, shell, dialog, crashReporter, Menu, clipboard, screen, session, protocol } = electron;
  const rootDir = path.resolve(__dirname, '..', '..');

  // T-AI2: the bpmd:// asset scheme must be declared privileged BEFORE app `ready`
  // (so it behaves as a standard, secure, fetch-able scheme that the CSP img-src
  // allow-lists). The handler itself is attached after ready (registerBpmdProtocol).
  if (protocol && typeof protocol.registerSchemesAsPrivileged === 'function') {
    protocol.registerSchemesAsPrivileged([
      { scheme: 'bpmd', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
      { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
    ]);
  }

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

  // ==== SECURITY: MAIN-OWNED CAPABILITIES ====
  // Native-picker paths are stored only in a main-owned registry. The renderer sees
  // opaque IDs and therefore cannot mint authority through settings or IPC payloads.
  let capabilityRegistry = null;
  let ipcController = null;
  // protocolController is built once ipcController exists (it needs getOpenVault /
  // listOpenVaultRoots) — see the app.whenReady() block below.
  let protocolController = null;

  // ==== DOCUMENT STORE (T-AI1) ====
  // Transactional repository: atomic, encoding-preserving, conflict-aware writes.
  const docStore = createDocumentStore({ fs, path, crypto });

  // ==== PERSISTENT SETTINGS (T-B5 / T-F8) ====
  // Versioned, fail-safe settings store under <userData>/settings.json. Loaded
  // on app.whenReady (so app.getPath('userData') is valid); the renderer reads
  // and writes it via settings:get / settings:set; window geometry is persisted
  // on window close / app quit and restored (clamped to a visible display) on
  // the next launch (EC-D1/EC-D2).
  let settingsStore = null;
  let currentSettings = null;
  const approvedCloseWindows = new WeakSet();

  function windowForEvent(event) {
    if (BrowserWindow && typeof BrowserWindow.fromWebContents === 'function' && event && event.sender) {
      return BrowserWindow.fromWebContents(event.sender) || null;
    }
    return BrowserWindow.getFocusedWindow();
  }

  // Capture the live window geometry into settings and flush to disk. Never
  // throws — a persistence failure must not block window close or app quit.
  function persistWindowState(win) {
    if (!win || win.isDestroyed()) return;
    try {
      const b = win.getNormalBounds();
      const window = { x: b.x, y: b.y, w: b.width, h: b.height, maximized: win.isMaximized() };
      currentSettings = migrate({ ...currentSettings, window });
      settingsStore.save(currentSettings);
    } catch (_) { /* never let persistence block teardown */ }
  }

  // ==== FILE ASSOCIATION ====
  let pendingFilesToOpen = [];

  // v1.2: deliver EVERY pending CLI/open-with/second-instance file (parseFileArgs),
  // and report failures to the renderer instead of swallowing them — the app used to
  // open with no file and no message when the CLI-supplied path could not be read.
  // window-controller invokes this from did-finish-load.
  function deliverPendingFiles(win) {
    if (!win || win.isDestroyed()) return 0;
    const files = pendingFilesToOpen;
    pendingFilesToOpen = [];
    let delivered = 0;
    for (const filePath of files) {
      try {
        const capability = capabilityRegistry.grantDocument(filePath);
        const snapshot = ipcController.readDocumentCapability(capability.id);
        if (!snapshot.error) {
          win.webContents.send('open-external-file', snapshot);
          delivered++;
        } else {
          win.webContents.send('open-external-file', { error: snapshot.error, name: path.basename(filePath) });
        }
      } catch (_) {
        win.webContents.send('open-external-file', { error: 'read-failed', name: path.basename(filePath) });
      }
    }
    return delivered;
  }

  // ==== IPC HANDLERS ====
  ipcController = createIpcController({
    app,
    BrowserWindow,
    ipcMain,
    dialog,
    session,
    fs,
    path,
    docStore,
    atomicWriteFile,
    approvedCloseWindows,
    windowForEvent,
    writeLog,
    getCapabilityRegistry: () => capabilityRegistry,
    getSettingsStore: () => settingsStore,
    getCurrentSettings: () => currentSettings,
    setCurrentSettings: (value) => { currentSettings = value; },
    isNetworkPath,
    isOversizedFile,
    isTooManyFiles,
    isAuthorizedPath,
    wouldExceedCumulative,
    isSymlinkEscape,
    filterAndSortMdFiles,
    migrate,
    compareVersions,
    fetchFn,
    shell,
    clipboard,
  });

  protocolController = createProtocolController({
    protocol,
    fs,
    path,
    rootDir,
    isAuthorizedPath,
    getOpenVault: (vaultId) => ipcController.getOpenVault(vaultId),
    listOpenVaultRoots: () => ipcController.listOpenVaultRoots(),
  });

  function registerIpcHandlers() {
    return ipcController.registerIpcHandlers();
  }

  const windowController = createWindowController({
    BrowserWindow,
    clipboard,
    screen,
    shell,
    path,
    rootDir,
    appRendererUrl: APP_RENDERER_URL,
    approvedCloseWindows,
    getCurrentSettings: () => currentSettings,
    persistWindowState,
    closeVaultWatcher: () => ipcController.closeVaultWatcher(),
    deliverPendingFiles,
    clampWindowBounds,
    isPackaged: !!app.isPackaged,
    classifyNavigation,
    isExternallyOpenable,
    buildContextMenuTemplate,
    buildContextMenuLabels: () => labelsForLocale(currentSettings && currentSettings.uiLocale),
    writeLog,
    ipcMain, crypto, Menu,
  });

  function createWindow() {
    return windowController.createWindow();
  }

  // T-F19: the chrome escape hatch the main process owns. Load-merge-save, never a bare
  // partial object -- save() runs migrate(), which would default recents, lastSession,
  // window and theme away. On a second instance it persists for the next launch rather
  // than forcing the live window to adopt it (that would need new IPC or a reload).
  function applyChromeResetIfAsked(argv) {
    if (!shouldResetChrome(argv) || !settingsStore) return;
    currentSettings = resetChromeSettings(currentSettings);
    settingsStore.save(currentSettings);
    writeLog('info', 'main:reset-chrome', 'chrome visibility restored by --reset-chrome');
  }

  // ==== SINGLE-INSTANCE LOCK ====
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  } else {
    app.on('second-instance', (_event, argv) => {
      const files = parseFileArgs(argv, fs);
      const wins = BrowserWindow.getAllWindows();
      if (wins.length === 0) return;
      const win = wins[0];
      applyChromeResetIfAsked(argv);   // relaunching is what a stuck user tries first
      if (win.isMinimized()) win.restore();
      win.focus();
      if (files.length > 0) {
        pendingFilesToOpen = pendingFilesToOpen.concat(files);
        deliverPendingFiles(win);
      }
    });

    app.whenReady().then(() => {
      // Load persisted settings now that userData path is valid (EC-D1: corrupt
      // file degrades to defaults rather than crashing).
      settingsStore = createSettingsStore({ fs, path, userDataDir: app.getPath('userData') });
      capabilityRegistry = createCapabilityRegistry({ fs, path, userDataDir: app.getPath('userData') });
      currentSettings = settingsStore.load();
      applyChromeResetIfAsked(proc.argv);   // before createWindow, so it opens with chrome
      pendingFilesToOpen = parseFileArgs(proc.argv, fs);
      windowController.installApplicationMenu(proc.platform);
      registerIpcHandlers();
      protocolController.registerAppProtocol();
      protocolController.registerBpmdProtocol();
      const win = createWindow();
      // v1.2: pending CLI files ride did-finish-load (window-controller); if the
      // renderer is slow, deliver on the next tick so early files aren't dropped.
      if (pendingFilesToOpen.length > 0 && win) {
        win.webContents.on('did-finish-load', () => deliverPendingFiles(win));
      }
      // EC-D2 follow-up (T-F19): a display can vanish mid-session and strand the
      // window off-screen, where an auto-hidden title bar leaves no drag region.
      windowController.watchDisplays();
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
      });
    });

    app.on('open-file', (event, filePath) => {
      event.preventDefault();
      if (!filePath) return;
      const validated = parseFileArg(['electron', filePath], fs);
      if (!validated) return;
      pendingFilesToOpen = pendingFilesToOpen.concat([validated]);
      const wins = BrowserWindow.getAllWindows();
      if (wins.length > 0) deliverPendingFiles(wins[0]);
    });
  }

  // Persist window geometry on quit (in addition to per-window close). Settings
  // changed by the renderer are already flushed eagerly via settings:set.
  app.on('before-quit', () => {
    const wins = BrowserWindow.getAllWindows();
    if (wins.length > 0) persistWindowState(wins[0]);
    ipcController.closeVaultWatcher();
  });

  app.on('window-all-closed', () => {
    ipcController.closeVaultWatcher();
    if (proc.platform !== 'darwin') app.quit();
  });

  return { createWindow, registerIpcHandlers };
}

module.exports = { bootstrap };

// ==== REAL APP ENTRY ====
// Run only inside the Electron main process. Playwright's Electron harness
// preloads an instrumentation module, so require.main is not reliably this
// file there; process.versions.electron remains the authoritative runtime
// discriminator. Plain Node/Vitest/Stryker imports do not expose that value.
// Stryker disable all — this guard is unreachable in the Node unit runner.
if (process.versions && process.versions.electron) {
  bootstrap({ electron: require('electron'), fs: require('fs') });
}
// Stryker restore all
