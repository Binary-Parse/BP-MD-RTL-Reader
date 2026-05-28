/**
 * Vitest tests for main.js and preload.js with V8 coverage.
 * Uses vi.mock() for ESM + Module._resolveFilename hijack for CJS require().
 */

import { describe, test, expect, vi, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';
import Module from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── HOISTED ESM MOCKS ──────────────────────────────────────────────────────
vi.mock('fs', () => ({
  readFileSync: vi.fn(() => '# Hello'),
  realpathSync: vi.fn((p) => p),
  statSync: vi.fn(() => ({ isFile: () => true, size: 100 })),
  promises: {
    readdir: vi.fn(() => Promise.resolve([])),
    lstat: vi.fn(() => Promise.resolve({ isSymbolicLink: () => false, size: 100 })),
    realpath: vi.fn((p) => Promise.resolve(p)),
    stat: vi.fn(() => Promise.resolve({ size: 100 })),
    readFile: vi.fn(() => Promise.resolve('content')),
  },
}));

// Note: we do NOT mock src/main-logic.js here.
// main.js loads it via CJS require(), which bypasses Vitest's ESM mock system.
// Mocking it globally would poison main-logic.test.js's dynamic import.
// The real main-logic.js executes and is instrumented normally.

// ── CJS MOCK FACTORY ───────────────────────────────────────────────────────
function buildMockElectron() {
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
    on: vi.fn(),
    quit: vi.fn(),
    getPath: vi.fn((name) => `/mock/userData/${name}`),
  };

  const crashReporter = {
    start: vi.fn(),
  };

  const BrowserWindow = vi.fn(function (opts) {
    mockWin._options = opts;
    return mockWin;
  });
  BrowserWindow.getAllWindows = vi.fn(() => []);
  BrowserWindow.getFocusedWindow = vi.fn(() => mockWin);

  const ipcMain = { handle: vi.fn(), on: vi.fn() };
  const ipcRenderer = { send: vi.fn(), invoke: vi.fn(() => Promise.resolve()), on: vi.fn() };
  const contextBridge = { exposeInMainWorld: vi.fn() };

  return {
    app: mockApp,
    BrowserWindow,
    ipcMain,
    ipcRenderer,
    contextBridge,
    shell: { openExternal: vi.fn() },
    dialog: { showOpenDialog: vi.fn(() => Promise.resolve({ canceled: true, filePaths: [] })) },
    crashReporter,
    _mockWin: mockWin,
  };
}

// ── TESTS ──────────────────────────────────────────────────────────────────

describe('main.js', () => {
  let mockElectron;
  let originalResolve;
  let restoreResolve;

  beforeAll(async () => {
    mockElectron = buildMockElectron();

    // Hijack CJS module resolution for 'electron'
    originalResolve = Module._resolveFilename;
    const mockElectronPath = path.join(__dirname, '__mock_electron_main.js');
    Module._cache[mockElectronPath] = { id: 'electron', exports: mockElectron, loaded: true };

    Module._resolveFilename = function(request, parent, isMain) {
      if (request === 'electron') return mockElectronPath;
      return originalResolve(request, parent, isMain);
    };
    restoreResolve = () => { Module._resolveFilename = originalResolve; };

    // Load main.js via CJS require so side-effects execute against mocks
    const require = createRequire(import.meta.url);
    const mainPath = require.resolve('../../main.js');
    delete require.cache[mainPath];
    require(mainPath);

    // Wait for app.whenReady() promise chain
    await new Promise(r => setTimeout(r, 50));
  });

  afterAll(() => {
    if (restoreResolve) restoreResolve();
  });

  test('creates BrowserWindow with correct options', () => {
    expect(mockElectron.BrowserWindow).toHaveBeenCalled();
    const opts = mockElectron.BrowserWindow.mock.calls[0][0];
    expect(opts.width).toBe(1280);
    expect(opts.height).toBe(820);
    expect(opts.title).toBe('Marqam');
    expect(opts.frame).toBe(false);
    expect(opts.webPreferences.nodeIntegration).toBe(false);
    expect(opts.webPreferences.contextIsolation).toBe(true);
  });

  test('registers IPC handlers', () => {
    expect(mockElectron.ipcMain.handle).toHaveBeenCalledWith('dialog:openFolder', expect.any(Function));
    expect(mockElectron.ipcMain.handle).toHaveBeenCalledWith('fs:readVault', expect.any(Function));
  });

  test('registers IPC listeners', () => {
    expect(mockElectron.ipcMain.on).toHaveBeenCalledWith('edit:command', expect.any(Function));
    expect(mockElectron.ipcMain.on).toHaveBeenCalledWith('window-close', expect.any(Function));
    expect(mockElectron.ipcMain.on).toHaveBeenCalledWith('window-minimize', expect.any(Function));
    expect(mockElectron.ipcMain.on).toHaveBeenCalledWith('window-maximize', expect.any(Function));
  });

  test('loads marqam.html', () => {
    expect(mockElectron._mockWin.loadFile).toHaveBeenCalledWith('marqam.html');
  });

  test('window-close calls win.close', () => {
    const win = mockElectron._mockWin;
    win.close.mockClear();
    const handlers = mockElectron.ipcMain.on.mock.calls.filter(c => c[0] === 'window-close');
    expect(handlers.length).toBeGreaterThan(0);
    handlers[handlers.length - 1][1](); // call latest registered handler
    expect(win.close).toHaveBeenCalled();
  });
});

describe('preload.js', () => {
  let mockElectron;
  let originalResolve;
  let restoreResolve;

  beforeAll(() => {
    mockElectron = buildMockElectron();

    originalResolve = Module._resolveFilename;
    const mockElectronPath = path.join(__dirname, '__mock_electron_preload.js');
    Module._cache[mockElectronPath] = { id: 'electron', exports: mockElectron, loaded: true };

    Module._resolveFilename = function(request, parent, isMain) {
      if (request === 'electron') return mockElectronPath;
      return originalResolve(request, parent, isMain);
    };
    restoreResolve = () => { Module._resolveFilename = originalResolve; };

    const require = createRequire(import.meta.url);
    const preloadPath = require.resolve('../../preload.js');
    delete require.cache[preloadPath];
    require(preloadPath);
  });

  afterAll(() => {
    if (restoreResolve) restoreResolve();
  });

  test('exposes 7 electronAPI methods', () => {
    expect(mockElectron.contextBridge.exposeInMainWorld).toHaveBeenCalledWith('electronAPI', expect.any(Object));
    const api = mockElectron.contextBridge.exposeInMainWorld.mock.calls[0][1];
    expect(typeof api.closeWindow).toBe('function');
    expect(typeof api.minimizeWindow).toBe('function');
    expect(typeof api.maximizeWindow).toBe('function');
    expect(typeof api.openFolder).toBe('function');
    expect(typeof api.readVault).toBe('function');
    expect(typeof api.editCommand).toBe('function');
    expect(typeof api.onOpenFile).toBe('function');
  });

  test('closeWindow sends window-close IPC', () => {
    const api = mockElectron.contextBridge.exposeInMainWorld.mock.calls[0][1];
    api.closeWindow();
    expect(mockElectron.ipcRenderer.send).toHaveBeenCalledWith('window-close');
  });

  test('readVault invokes fs:readVault', () => {
    const api = mockElectron.contextBridge.exposeInMainWorld.mock.calls[0][1];
    api.readVault('/vault');
    expect(mockElectron.ipcRenderer.invoke).toHaveBeenCalledWith('fs:readVault', '/vault');
  });

  test('onOpenFile registers callback and forwards data', () => {
    const api = mockElectron.contextBridge.exposeInMainWorld.mock.calls[0][1];
    const cb = vi.fn();
    api.onOpenFile(cb);

    const handlerCall = mockElectron.ipcRenderer.on.mock.calls.find(c => c[0] === 'open-external-file');
    expect(handlerCall).toBeDefined();

    const handler = handlerCall[1];
    handler({}, { name: 'test.md', path: '/test.md', content: '# Hello' });
    expect(cb).toHaveBeenCalledWith({ name: 'test.md', path: '/test.md', content: '# Hello' });
  });
});

// ── IPC CONCURRENCY (audit #9) ─────────────────────────────────────────────
// main.js holds `allowedFolders` as a module-level Set mutated by
// dialog:openFolder and read by fs:readVault. These tests exercise the
// handlers under parallel invocations to verify that:
//   - concurrent openFolder calls don't lose paths (Set.add is atomic in JS)
//   - readVault racing with openFolder produces deterministic results
//     (authorised or unauthorised, never a partial / inconsistent state)
//   - unauthorised paths stay rejected even under load
// JavaScript is single-threaded, but async/await interleaving between an
// `await` and the next sync line is the equivalent of a race window. These
// tests are the regression net for any future change that adds a remove
// path or makes openFolder's await-then-Set.add no longer atomic.

describe('main.js — IPC concurrency (audit #9)', () => {
  let mockElectron;
  let originalResolve;
  let restoreResolve;
  let openFolderHandler;
  let readVaultHandler;

  beforeAll(async () => {
    mockElectron = buildMockElectron();

    // CJS-require mock for 'fs' — readVault runs fs.promises.* on the
    // injected path; the real fs would throw ENOENT. Always returns an
    // empty directory so a successful readVault yields [].
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
        mkdir: () => Promise.resolve(undefined),
      },
      appendFileSync: () => undefined,
      mkdirSync: () => undefined,
      existsSync: () => false,
      renameSync: () => undefined,
    };

    originalResolve = Module._resolveFilename;
    const mockElectronPath = path.join(__dirname, '__mock_electron_concurrency.js');
    const mockFsPath = path.join(__dirname, '__mock_fs_concurrency.js');
    Module._cache[mockElectronPath] = { id: 'electron', exports: mockElectron, loaded: true };
    Module._cache[mockFsPath] = { id: 'fs', exports: mockFs, loaded: true };
    Module._resolveFilename = function (request, parent, isMain) {
      if (request === 'electron') return mockElectronPath;
      if (request === 'fs') return mockFsPath;
      return originalResolve(request, parent, isMain);
    };
    restoreResolve = () => { Module._resolveFilename = originalResolve; };

    const require = createRequire(import.meta.url);
    const mainPath = require.resolve('../../main.js');
    delete require.cache[mainPath];
    require(mainPath);
    await new Promise(r => setTimeout(r, 50));

    openFolderHandler = mockElectron.ipcMain.handle.mock.calls
      .find(c => c[0] === 'dialog:openFolder')[1];
    readVaultHandler = mockElectron.ipcMain.handle.mock.calls
      .find(c => c[0] === 'fs:readVault')[1];
  });

  afterAll(() => {
    if (restoreResolve) restoreResolve();
  });

  test('parallel dialog:openFolder calls both add their paths', async () => {
    let n = 0;
    mockElectron.dialog.showOpenDialog.mockImplementation(() =>
      Promise.resolve({ canceled: false, filePaths: [`/parallel-vault-${++n}`] })
    );

    const [a, b] = await Promise.all([openFolderHandler(), openFolderHandler()]);
    expect(a.canceled).toBe(false);
    expect(b.canceled).toBe(false);
    expect([a.folderPath, b.folderPath].sort()).toEqual(
      ['/parallel-vault-1', '/parallel-vault-2']
    );

    // Both paths must now pass the allowlist check.
    const r1 = await readVaultHandler({}, a.folderPath);
    const r2 = await readVaultHandler({}, b.folderPath);
    expect(r1).not.toMatchObject({ error: 'unauthorized-path' });
    expect(r2).not.toMatchObject({ error: 'unauthorized-path' });
  });

  test('cancelled openFolder does NOT pollute allowedFolders', async () => {
    mockElectron.dialog.showOpenDialog.mockResolvedValueOnce({
      canceled: true,
      filePaths: [],
    });
    const r = await openFolderHandler();
    expect(r).toEqual({ canceled: true, folderPath: null });

    // A path that was never added must remain unauthorised.
    expect(await readVaultHandler({}, '/never-added-vault')).toMatchObject({
      error: 'unauthorized-path',
    });
  });

  test('10 parallel readVault calls on same allowlisted folder all succeed', async () => {
    mockElectron.dialog.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: ['/concurrent-vault'],
    });
    await openFolderHandler();

    const results = await Promise.all(
      Array.from({ length: 10 }, () => readVaultHandler({}, '/concurrent-vault'))
    );
    for (const r of results) {
      expect(Array.isArray(r)).toBe(true);
      expect(r).toEqual([]);
    }
  });

  test('readVault racing with openFolder is deterministic', async () => {
    mockElectron.dialog.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: ['/race-vault'],
    });

    const [openResult, readResult] = await Promise.all([
      openFolderHandler(),
      readVaultHandler({}, '/race-vault'),
    ]);

    expect(openResult).toEqual({ canceled: false, folderPath: '/race-vault' });

    // readResult is one of:
    //   1. [] (run after openFolder finished its Set.add)
    //   2. { error: 'unauthorized-path' } (run before)
    // Anything else = race-condition bug.
    const isAuthorised = Array.isArray(readResult) && readResult.length === 0;
    const isRejected = readResult && readResult.error === 'unauthorized-path';
    expect(isAuthorised || isRejected).toBe(true);
  });

  test('readVault rejects unauthorised path even under load', async () => {
    let n = 0;
    mockElectron.dialog.showOpenDialog.mockImplementation(() =>
      Promise.resolve({ canceled: false, filePaths: [`/load-vault-${++n}`] })
    );
    await Promise.all(Array.from({ length: 5 }, () => openFolderHandler()));

    expect(await readVaultHandler({}, '/totally-not-allowed')).toMatchObject({
      error: 'unauthorized-path',
    });
  });
});
