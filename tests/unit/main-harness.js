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
    isDestroyed: vi.fn(() => false),
  };
  const mockWin = {
    loadFile: vi.fn(), close: vi.fn(), minimize: vi.fn(), maximize: vi.fn(),
    unmaximize: vi.fn(), isMaximized: vi.fn(() => false), isDestroyed: vi.fn(() => false),
    restore: vi.fn(), focus: vi.fn(), isMinimized: vi.fn(() => false),
    webContents: mockWebContents, _options: null,
  };
  const mockApp = {
    requestSingleInstanceLock: vi.fn(() => true),
    whenReady: vi.fn(() => Promise.resolve()),
    on: vi.fn(), quit: vi.fn(),
    getPath: vi.fn((name) => `/mock/userData/${name}`),
  };
  const crashReporter = { start: vi.fn() };
  const BrowserWindow = vi.fn(function (opts) { mockWin._options = opts; return mockWin; });
  BrowserWindow.getAllWindows = vi.fn(() => []);
  BrowserWindow.getFocusedWindow = vi.fn(() => mockWin);
  const ipcMain = { handle: vi.fn(), on: vi.fn() };
  const ipcRenderer = { send: vi.fn(), invoke: vi.fn(() => Promise.resolve()), on: vi.fn() };
  const contextBridge = { exposeInMainWorld: vi.fn() };
  const menuPopup = vi.fn();
  const Menu = { buildFromTemplate: vi.fn(() => ({ popup: menuPopup })), _popup: menuPopup };
  return {
    app: mockApp, BrowserWindow, ipcMain, ipcRenderer, contextBridge,
    shell: { openExternal: vi.fn() },
    dialog: { showOpenDialog: vi.fn(() => Promise.resolve({ canceled: true, filePaths: [] })) },
    clipboard: { writeText: vi.fn() },
    crashReporter, Menu, _mockWin: mockWin,
  };
}

export function buildMockFs(overrides = {}) {
  return {
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
    },
    appendFileSync: vi.fn(), mkdirSync: vi.fn(),
    existsSync: vi.fn(() => false), renameSync: vi.fn(),
    writeFileSync: vi.fn(), unlinkSync: vi.fn(),
    ...overrides,
  };
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
