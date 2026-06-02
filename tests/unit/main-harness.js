/**
 * main-harness.js — shared mock builders for main.js/preload.js unit + mutation
 * tests. NOT a test file (no `.test.` suffix) so vitest does not collect it.
 *
 * main.js exposes bootstrap({ electron, fs, proc }) and preload.js exposes
 * setupBridge({ contextBridge, ipcRenderer }) (audit #3 seam), so tests drive
 * the real code with these plain mocks — no Module._cache hijack.
 */
import { vi } from 'vitest';

export function buildMockElectron() {
  const mockWebContents = {
    send: vi.fn(),
    on: vi.fn(),
    setWindowOpenHandler: vi.fn(),
    copy: vi.fn(), cut: vi.fn(), paste: vi.fn(),
    undo: vi.fn(), redo: vi.fn(), selectAll: vi.fn(),
    copyImageAt: vi.fn(), downloadURL: vi.fn(), replaceMisspelling: vi.fn(),
    session: { addWordToSpellCheckerDictionary: vi.fn() },
    printToPDF: vi.fn(() => Promise.resolve(Buffer.from('%PDF-1.4 mock'))), // T-B6
    isDestroyed: vi.fn(() => false),
  };
  const mockWin = {
    loadFile: vi.fn(), loadURL: vi.fn(() => Promise.resolve()), close: vi.fn(), minimize: vi.fn(), maximize: vi.fn(),
    unmaximize: vi.fn(), isMaximized: vi.fn(() => false), isDestroyed: vi.fn(() => false),
    restore: vi.fn(), focus: vi.fn(), isMinimized: vi.fn(() => false),
    on: vi.fn(),
    getBounds: vi.fn(() => ({ x: 0, y: 0, width: 1280, height: 820 })),
    getNormalBounds: vi.fn(() => ({ x: 0, y: 0, width: 1280, height: 820 })),
    webContents: mockWebContents, _options: null,
  };
  const mockApp = {
    requestSingleInstanceLock: vi.fn(() => true),
    whenReady: vi.fn(() => Promise.resolve()),
    on: vi.fn(), quit: vi.fn(),
    getPath: vi.fn((name) => `/mock/userData/${name}`),
    getVersion: vi.fn(() => '1.0.0'), // T-Q6
  };
  const crashReporter = { start: vi.fn() };
  const BrowserWindow = vi.fn(function (opts) { mockWin._options = opts; return mockWin; });
  BrowserWindow.getAllWindows = vi.fn(() => []);
  BrowserWindow.getFocusedWindow = vi.fn(() => mockWin);
  const ipcMain = { handle: vi.fn(), on: vi.fn() };
  // Isolated offline session for the T-B6 offscreen PDF window: records the registered
  // onBeforeRequest filter so tests can drive it with sample URLs.
  const pdfSession = { webRequest: { onBeforeRequest: vi.fn() } };
  const session = { fromPartition: vi.fn(() => pdfSession), _pdfSession: pdfSession };
  const ipcRenderer = { send: vi.fn(), invoke: vi.fn(() => Promise.resolve()), on: vi.fn() };
  const contextBridge = { exposeInMainWorld: vi.fn() };
  const menuPopup = vi.fn();
  const Menu = { buildFromTemplate: vi.fn(() => ({ popup: menuPopup })), _popup: menuPopup };
  return {
    app: mockApp, BrowserWindow, ipcMain, ipcRenderer, contextBridge,
    shell: { openExternal: vi.fn() },
    dialog: {
      showOpenDialog: vi.fn(() => Promise.resolve({ canceled: true, filePaths: [] })),
      showSaveDialog: vi.fn(() => Promise.resolve({ canceled: true, filePath: undefined })), // T-B6
    },
    clipboard: { writeText: vi.fn() },
    screen: { getAllDisplays: vi.fn(() => [{ x: 0, y: 0, width: 1920, height: 1080 }]) },
    crashReporter, Menu, session, _mockWin: mockWin, _pdfSession: pdfSession,
  };
}

export function buildMockFs(overrides = {}) {
  const fs = {
    readFileSync: vi.fn(() => '# Hello'),
    realpathSync: vi.fn((p) => p),
    statSync: vi.fn(() => ({ isFile: () => true, size: 100 })),
    promises: {
      readdir: vi.fn(() => Promise.resolve([])),
      lstat: vi.fn(() => Promise.resolve({ isSymbolicLink: () => false, size: 100 })),
      realpath: vi.fn((p) => Promise.resolve(p)),
      stat: vi.fn(() => Promise.resolve({ size: 100 })),
      readFile: vi.fn(() => Promise.resolve('content')),
      mkdir: vi.fn(() => Promise.resolve()),
      writeFile: vi.fn(() => Promise.resolve()), // T-B6 temp html + PDF bytes → disk
      unlink: vi.fn(() => Promise.resolve()),    // T-B6 temp html cleanup
    },
    appendFileSync: vi.fn(), mkdirSync: vi.fn(),
    existsSync: vi.fn(() => false), renameSync: vi.fn(),
    writeFileSync: vi.fn(), unlinkSync: vi.fn(),
    ...overrides,
  };
  // T-B9: fs.watch mock that captures the listener so tests can simulate a disk change.
  if (!fs.watch) {
    fs.watch = vi.fn((root, opts, cb) => { fs._watchRoot = root; fs._watchOpts = opts; fs._watchCb = cb; fs._watchClose = vi.fn(); return { close: fs._watchClose }; });
  }
  return fs;
}

// EventEmitter-ish process stub so process.on/emit inside bootstrap is isolated
// per test and doesn't leak listeners onto the real process.
export function buildMockProc(argv) {
  const listeners = {};
  return {
    argv,
    platform: process.platform,
    on: (event, fn) => { (listeners[event] ||= []).push(fn); },
    emit: (event, ...args) => {
      for (const fn of listeners[event] || []) fn(...args);
      return (listeners[event] || []).length > 0;
    },
    _listeners: listeners,
  };
}
