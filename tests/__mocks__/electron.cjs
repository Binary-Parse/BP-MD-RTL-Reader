/**
 * Vitest mock for the 'electron' module.
 * Provides enough surface for src/main/index.js and src/preload/index.js to load and be instrumented.
 */

const { vi } = require('vitest');

const mockIpcHandlers = {};
const mockIpcListeners = {};
const mockAppListeners = {};
const mockWindows = [];

const mockWebContents = {
  send: vi.fn(),
  on: vi.fn(),
  setWindowOpenHandler: vi.fn(),
  copy: vi.fn(),
  cut: vi.fn(),
  paste: vi.fn(),
  undo: vi.fn(),
  redo: vi.fn(),
  selectAll: vi.fn(),
  isDestroyed: vi.fn(() => false),
};

const mockWin = {
  loadFile: vi.fn(),
  loadURL: vi.fn(() => Promise.resolve()),
  close: vi.fn(),
  minimize: vi.fn(),
  maximize: vi.fn(),
  unmaximize: vi.fn(),
  isMaximized: vi.fn(() => false),
  isDestroyed: vi.fn(() => false),
  restore: vi.fn(),
  focus: vi.fn(),
  webContents: mockWebContents,
  _options: null,
};

const mockApp = {
  requestSingleInstanceLock: vi.fn(() => true),
  whenReady: vi.fn(() => Promise.resolve()),
  on: vi.fn((event, fn) => { mockAppListeners[event] = fn; }),
  quit: vi.fn(),
  getPath: vi.fn((name) => `/mock/userData/${name}`),
};

const crashReporter = {
  start: vi.fn(),
};

const BrowserWindow = vi.fn(function (opts) {
  mockWin._options = opts;
  mockWindows.push(mockWin);
  return mockWin;
});
BrowserWindow.getAllWindows = vi.fn(() => mockWindows);
BrowserWindow.getFocusedWindow = vi.fn(() => mockWin);

const ipcMain = {
  handle: vi.fn((name, fn) => { mockIpcHandlers[name] = fn; }),
  on: vi.fn((name, fn) => { mockIpcListeners[name] = fn; }),
};

const ipcRenderer = {
  send: vi.fn(),
  invoke: vi.fn(() => Promise.resolve()),
  on: vi.fn((name, cb) => { mockIpcListeners[name] = cb; }),
};

const contextBridge = {
  exposeInMainWorld: vi.fn(),
};

const shell = {
  openExternal: vi.fn(),
};

const dialog = {
  showOpenDialog: vi.fn(() => Promise.resolve({ canceled: true, filePaths: [] })),
};

module.exports = {
  app: mockApp,
  BrowserWindow,
  ipcMain,
  ipcRenderer,
  contextBridge,
  shell,
  dialog,
  crashReporter,
  // Re-export internals for test inspection
  _mockIpcHandlers: mockIpcHandlers,
  _mockIpcListeners: mockIpcListeners,
  _mockAppListeners: mockAppListeners,
  _mockWindows: mockWindows,
  _mockWin: mockWin,
};
