/**
 * Node.js native assert tests for main.js.
 * Run: node tests/unit/main.assert.test.js
 */

const assert = require('assert');
const Module = require('module');
const path = require('path');

(async () => {
  // ==== MOCKS ====
  const ipcHandlers = {};
  const ipcListeners = {};
  const appListeners = {};
  let windows = [];
  let appQuitCalled = false;
  let singleInstanceLock = true;

  const mockWin = {
    loadFile: (f) => { mockWin._loadedFile = f; },
    close: () => { mockWin._closed = true; },
    minimize: () => { mockWin._minimized = true; },
    maximize: () => { mockWin._maximized = true; },
    unmaximize: () => { mockWin._unmaximized = true; },
    isMaximized: () => mockWin._isMaximized,
    isDestroyed: () => false,
    restore: () => { mockWin._restored = true; },
    focus: () => { mockWin._focused = true; },
    webContents: {
      send: (...args) => { mockWin._sent = args; },
      on: () => {},
      setWindowOpenHandler: () => {},
      copy: () => { mockWin._copied = true; },
      cut: () => { mockWin._cut = true; },
      paste: () => { mockWin._pasted = true; },
      undo: () => { mockWin._undone = true; },
      redo: () => { mockWin._redone = true; },
      selectAll: () => { mockWin._selectAll = true; },
      isDestroyed: () => false,
    },
    _isMaximized: false,
  };

  const mockElectron = {
    app: {
      requestSingleInstanceLock: () => singleInstanceLock,
      whenReady: () => Promise.resolve(),
      on: (event, fn) => { appListeners[event] = fn; },
      quit: () => { appQuitCalled = true; },
    },
    BrowserWindow: function (opts) {
      mockWin._options = opts;
      windows.push(mockWin);
      return mockWin;
    },
    ipcMain: {
      handle: (name, fn) => { ipcHandlers[name] = fn; },
      on: (name, fn) => { ipcListeners[name] = fn; },
    },
    shell: { openExternal: (url) => { mockWin._openedUrl = url; } },
    dialog: {
      showOpenDialog: () => Promise.resolve({ canceled: true, filePaths: [] }),
    },
  };
  mockElectron.BrowserWindow.getAllWindows = () => windows;
  mockElectron.BrowserWindow.getFocusedWindow = () => mockWin;

  const mockFs = {
    readFileSync: () => '# Hello',
    realpathSync: (p) => p,
    statSync: () => ({ isFile: () => true, size: 100 }),
    promises: {
      readdir: () => Promise.resolve([]),
      lstat: () => Promise.resolve({ isSymbolicLink: () => false, size: 100 }),
      realpath: (p) => Promise.resolve(p),
      stat: () => Promise.resolve({ size: 100 }),
      readFile: () => Promise.resolve('content'),
    },
  };

  const mockMainLogic = {
    parseFileArg: () => null,
    isAuthorizedPath: () => true,
    isNetworkPath: () => false,
    isTooManyFiles: () => false,
    isOversizedFile: () => false,
    wouldExceedCumulative: () => false,
    isSymlinkEscape: () => false,
    stripBOM: (s) => s,
    filterAndSortMdFiles: (entries) => entries.filter(e => e.name.endsWith('.md')).map(e => e.name),
  };

  // ==== HIJACK MODULE RESOLUTION ====
  const originalResolve = Module._resolveFilename;
  const mockElectronPath = path.join(__dirname, '__mock_electron.js');
  const mockFsPath = path.join(__dirname, '__mock_fs.js');
  const mockMainLogicPath = path.resolve(__dirname, '../../src/main-logic.js');

  Module._cache[mockElectronPath] = { id: 'electron', exports: mockElectron, loaded: true };
  Module._cache[mockFsPath] = { id: 'fs', exports: mockFs, loaded: true };
  Module._cache[mockMainLogicPath] = { id: mockMainLogicPath, exports: mockMainLogic, loaded: true };

  Module._resolveFilename = function(request, parent, isMain) {
    if (request === 'electron') return mockElectronPath;
    if (request === 'fs') return mockFsPath;
    if (request === './src/main-logic') return mockMainLogicPath;
    if (request.endsWith('src/main-logic')) return mockMainLogicPath;
    return originalResolve(request, parent, isMain);
  };

  // ==== LOAD MAIN.JS ====
  const mainJsPath = require.resolve('../../main.js');
  delete Module._cache[mainJsPath];
  require('../../main.js');

  // Wait for app.whenReady() Promise callbacks to execute
  await new Promise(r => setImmediate(r));

  // Restore
  Module._resolveFilename = originalResolve;

  // ==== ASSERTIONS ====

  assert.strictEqual(singleInstanceLock, true, 'app requests single instance lock');
  assert.strictEqual(appQuitCalled, false, 'app does not quit when lock obtained');

  assert.ok(ipcHandlers['dialog:openFolder'], 'dialog:openFolder handler registered');
  assert.ok(ipcHandlers['fs:readVault'], 'fs:readVault handler registered');
  assert.ok(ipcListeners['edit:command'], 'edit:command listener registered');
  assert.ok(ipcListeners['window-close'], 'window-close listener registered');
  assert.ok(ipcListeners['window-minimize'], 'window-minimize listener registered');
  assert.ok(ipcListeners['window-maximize'], 'window-maximize listener registered');

  assert.ok(mockWin._options, 'BrowserWindow was created');
  assert.strictEqual(mockWin._options.width, 1280, 'width is 1280');
  assert.strictEqual(mockWin._options.height, 820, 'height is 820');
  assert.strictEqual(mockWin._options.frame, false, 'frame is false');
  assert.strictEqual(mockWin._options.title, 'Marqam', 'title is Marqam');
  assert.strictEqual(mockWin._options.webPreferences.nodeIntegration, false, 'nodeIntegration false');
  assert.strictEqual(mockWin._options.webPreferences.contextIsolation, true, 'contextIsolation true');

  assert.strictEqual(mockWin._loadedFile, 'marqam.html', 'loads marqam.html');

  ipcListeners['window-close']();
  assert.ok(mockWin._closed, 'window-close calls win.close');

  ipcListeners['window-minimize']();
  assert.ok(mockWin._minimized, 'window-minimize calls win.minimize');

  mockWin._isMaximized = false;
  ipcListeners['window-maximize']();
  assert.ok(mockWin._maximized, 'window-maximize calls win.maximize when not maximized');

  mockWin._isMaximized = true;
  ipcListeners['window-maximize']();
  assert.ok(mockWin._unmaximized, 'window-maximize calls win.unmaximize when maximized');

  const event = { sender: mockWin.webContents };
  ipcListeners['edit:command'](event, 'copy');
  assert.ok(mockWin._copied, 'edit:command copy calls wc.copy');

  ipcListeners['edit:command'](event, 'cut');
  assert.ok(mockWin._cut, 'edit:command cut calls wc.cut');

  ipcListeners['edit:command'](event, 'paste');
  assert.ok(mockWin._pasted, 'edit:command paste calls wc.paste');

  ipcListeners['edit:command'](event, 'undo');
  assert.ok(mockWin._undone, 'edit:command undo calls wc.undo');

  ipcListeners['edit:command'](event, 'redo');
  assert.ok(mockWin._redone, 'edit:command redo calls wc.redo');

  ipcListeners['edit:command'](event, 'selectAll');
  assert.ok(mockWin._selectAll, 'edit:command selectAll calls wc.selectAll');

  assert.doesNotThrow(() => ipcListeners['edit:command'](event, 'unknown'), 'unknown command does not throw');

  const destroyedEvent = { sender: { ...mockWin.webContents, isDestroyed: () => true } };
  mockWin._copied = false;
  ipcListeners['edit:command'](destroyedEvent, 'copy');
  assert.strictEqual(mockWin._copied, false, 'destroyed sender is no-op');

  console.log('✅ All main.js assertions passed (17 tests)');
})();
