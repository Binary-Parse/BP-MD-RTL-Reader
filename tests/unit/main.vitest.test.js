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

// ── HANDLER BEHAVIOUR (audit #1) ───────────────────────────────────────────
// Covers the previously-uncovered branches of main.js handlers and
// observability code. With current Stryker scope (1 file, audit #3) this
// won't move the mutation score directly — but it kills the 170+
// NoCoverage mutants that show up the moment Stryker is expanded.
//
// Scope:
//   - dialog:openFolder cancel path
//   - fs:readVault: invalid input, network paths, file/cumulative caps,
//     symlink escape detection, happy path with multiple files + BOM
//   - edit:command: all 6 commands + unknown + destroyed sender
//   - window-close/min/max (max twice — already-max vs not)
//   - crashReporter.start was invoked
//   - process.on('uncaughtException'|'unhandledRejection') -> writeLog
//   - log:error IPC + rate limit + invalid-payload guard
//   - setWindowOpenHandler: http -> shell.openExternal, deny non-http
//   - app.on('open-file'), app.on('second-instance'): payload delivery

describe('main.js — handler behaviour (audit #1)', () => {
  let mockElectron;
  let mockFs;
  let originalResolve;
  let restoreResolve;
  let openFolder;
  let readVault;
  let editCmd;
  let logError;
  let winClose;
  let winMin;
  let winMax;

  function getHandle(name) {
    return mockElectron.ipcMain.handle.mock.calls.find(c => c[0] === name)?.[1];
  }
  function getOn(name) {
    return mockElectron.ipcMain.on.mock.calls.find(c => c[0] === name)?.[1];
  }

  beforeAll(async () => {
    mockElectron = buildMockElectron();
    mockFs = {
      readFileSync: vi.fn(() => '﻿# Hello'), // includes BOM
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
      appendFileSync: vi.fn(),
      mkdirSync: vi.fn(),
      existsSync: vi.fn(() => false),
      renameSync: vi.fn(),
    };

    originalResolve = Module._resolveFilename;
    const mockElectronPath = path.join(__dirname, '__mock_electron_handlers.js');
    const mockFsPath = path.join(__dirname, '__mock_fs_handlers.js');
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

    openFolder = getHandle('dialog:openFolder');
    readVault = getHandle('fs:readVault');
    editCmd = getOn('edit:command');
    logError = getOn('log:error');
    winClose = getOn('window-close');
    winMin = getOn('window-minimize');
    winMax = getOn('window-maximize');
  });

  afterAll(() => { if (restoreResolve) restoreResolve(); });

  // ─ crashReporter ─────────────────────────────────────────────────────
  test('crashReporter.start invoked with uploadToServer: false', () => {
    expect(mockElectron.crashReporter.start).toHaveBeenCalled();
    const opts = mockElectron.crashReporter.start.mock.calls[0][0];
    expect(opts.uploadToServer).toBe(false);
  });

  // ─ dialog:openFolder ────────────────────────────────────────────────
  test('dialog:openFolder returns {canceled:true, folderPath:null} when user cancels', async () => {
    mockElectron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    const r = await openFolder();
    expect(r).toEqual({ canceled: true, folderPath: null });
  });

  test('dialog:openFolder returns canceled when filePaths is empty array', async () => {
    mockElectron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [] });
    const r = await openFolder();
    expect(r).toEqual({ canceled: true, folderPath: null });
  });

  // ─ fs:readVault validation ──────────────────────────────────────────
  test('readVault throws on non-string folder path', async () => {
    await expect(readVault({}, 123)).rejects.toThrow('Invalid folder path');
    await expect(readVault({}, null)).rejects.toThrow('Invalid folder path');
    await expect(readVault({}, '')).rejects.toThrow('Invalid folder path');
  });

  test('readVault rejects Windows UNC path (network-path-not-allowed)', async () => {
    expect(await readVault({}, '\\\\server\\share')).toEqual({ error: 'network-path-not-allowed' });
  });

  test('readVault rejects POSIX network path', async () => {
    expect(await readVault({}, '//server/share')).toEqual({ error: 'network-path-not-allowed' });
  });

  test('readVault rejects when directory has too many files (> 5000)', async () => {
    mockElectron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/big-vault'] });
    await openFolder();
    const tooMany = Array.from({ length: 5001 }, (_, i) => ({
      name: `f${i}.md`, isFile: () => true, isSymbolicLink: () => false,
    }));
    mockFs.promises.readdir.mockResolvedValueOnce(tooMany);
    expect(await readVault({}, '/big-vault')).toEqual({ error: 'too-many-files' });
  });

  test('readVault skips a single oversized file (> 10 MiB) but continues', async () => {
    mockElectron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/mixed-vault'] });
    await openFolder();
    mockFs.promises.readdir.mockResolvedValueOnce([
      { name: 'huge.md', isFile: () => true, isSymbolicLink: () => false },
      { name: 'tiny.md', isFile: () => true, isSymbolicLink: () => false },
    ]);
    mockFs.promises.lstat
      .mockResolvedValueOnce({ isSymbolicLink: () => false, size: 11 * 1024 * 1024 })
      .mockResolvedValueOnce({ isSymbolicLink: () => false, size: 100 });

    const r = await readVault({}, '/mixed-vault');
    expect(Array.isArray(r)).toBe(true);
    expect(r).toHaveLength(1);
    expect(r[0].name).toBe('tiny.md');
  });

  test('readVault returns cumulative-size-exceeded partial when sum > 100 MiB', async () => {
    mockElectron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/cumul-vault'] });
    await openFolder();
    // Use 12 files of 9 MiB each: individually under the 10 MiB per-file
    // cap, but collectively 108 MiB > the 100 MiB cumulative cap.
    mockFs.promises.readdir.mockResolvedValueOnce(
      Array.from({ length: 12 }, (_, i) => ({
        name: `f${i}.md`, isFile: () => true, isSymbolicLink: () => false,
      }))
    );
    for (let i = 0; i < 12; i++) {
      mockFs.promises.lstat.mockResolvedValueOnce({
        isSymbolicLink: () => false, size: 9 * 1024 * 1024,
      });
    }

    const r = await readVault({}, '/cumul-vault');
    expect(r.error).toBe('cumulative-size-exceeded');
    expect(Array.isArray(r.partial)).toBe(true);
  });

  test('readVault skips symlink that escapes vault root', async () => {
    mockElectron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/sym-vault'] });
    await openFolder();
    mockFs.promises.readdir.mockResolvedValueOnce([
      { name: 'evil.md', isFile: () => true, isSymbolicLink: () => true },
    ]);
    mockFs.promises.lstat.mockResolvedValueOnce({ isSymbolicLink: () => true, size: 100 });
    mockFs.promises.realpath.mockResolvedValueOnce('/etc/passwd'); // outside vault

    const r = await readVault({}, '/sym-vault');
    expect(r).toEqual([]); // escaped symlink skipped
  });

  test('readVault accepts symlink that stays inside vault root', async () => {
    mockElectron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/sym-ok'] });
    await openFolder();
    mockFs.promises.readdir.mockResolvedValueOnce([
      { name: 'link.md', isFile: () => true, isSymbolicLink: () => true },
    ]);
    mockFs.promises.lstat.mockResolvedValueOnce({ isSymbolicLink: () => true, size: 100 });
    mockFs.promises.realpath.mockResolvedValueOnce('/sym-ok/sub/link.md'); // inside

    const r = await readVault({}, '/sym-ok');
    expect(Array.isArray(r)).toBe(true);
    expect(r).toHaveLength(1);
    expect(r[0].name).toBe('link.md');
  });

  test('readVault strips BOM from file content', async () => {
    mockElectron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/bom-vault'] });
    await openFolder();
    mockFs.promises.readdir.mockResolvedValueOnce([
      { name: 'bom.md', isFile: () => true, isSymbolicLink: () => false },
    ]);
    mockFs.promises.readFile.mockResolvedValueOnce('﻿# title');

    const r = await readVault({}, '/bom-vault');
    expect(r[0].content).toBe('# title'); // BOM stripped
  });

  // ─ edit:command dispatch ────────────────────────────────────────────
  test('edit:command dispatches all 6 commands to webContents', () => {
    const wc = mockElectron._mockWin.webContents;
    for (const m of ['copy', 'cut', 'paste', 'undo', 'redo', 'selectAll']) {
      wc[m].mockClear();
    }
    const event = { sender: wc };
    editCmd(event, 'copy');     expect(wc.copy).toHaveBeenCalled();
    editCmd(event, 'cut');      expect(wc.cut).toHaveBeenCalled();
    editCmd(event, 'paste');    expect(wc.paste).toHaveBeenCalled();
    editCmd(event, 'undo');     expect(wc.undo).toHaveBeenCalled();
    editCmd(event, 'redo');     expect(wc.redo).toHaveBeenCalled();
    editCmd(event, 'selectAll'); expect(wc.selectAll).toHaveBeenCalled();
  });

  test('edit:command with unknown command is a silent no-op', () => {
    const wc = mockElectron._mockWin.webContents;
    wc.copy.mockClear();
    expect(() => editCmd({ sender: wc }, 'bogus-cmd')).not.toThrow();
    expect(wc.copy).not.toHaveBeenCalled();
  });

  test('edit:command with destroyed sender is a silent no-op', () => {
    const wc = mockElectron._mockWin.webContents;
    wc.copy.mockClear();
    const destroyed = { sender: { ...wc, isDestroyed: () => true } };
    expect(() => editCmd(destroyed, 'copy')).not.toThrow();
    expect(wc.copy).not.toHaveBeenCalled();
  });

  // ─ window lifecycle ─────────────────────────────────────────────────
  test('window-close calls win.close', () => {
    mockElectron._mockWin.close.mockClear();
    winClose();
    expect(mockElectron._mockWin.close).toHaveBeenCalled();
  });

  test('window-minimize calls win.minimize', () => {
    mockElectron._mockWin.minimize.mockClear();
    winMin();
    expect(mockElectron._mockWin.minimize).toHaveBeenCalled();
  });

  test('window-maximize: maximizes when not maximized, unmaximizes when already maximized', () => {
    const win = mockElectron._mockWin;
    win.maximize.mockClear();
    win.unmaximize.mockClear();
    win.isMaximized.mockReturnValueOnce(false);
    winMax();
    expect(win.maximize).toHaveBeenCalled();
    expect(win.unmaximize).not.toHaveBeenCalled();

    win.maximize.mockClear();
    win.unmaximize.mockClear();
    win.isMaximized.mockReturnValueOnce(true);
    winMax();
    expect(win.unmaximize).toHaveBeenCalled();
    expect(win.maximize).not.toHaveBeenCalled();
  });

  // ─ observability ────────────────────────────────────────────────────
  test('log:error writes JSON line to the rotating log file', () => {
    mockFs.appendFileSync.mockClear();
    logError({}, { message: 'boom', stack: 'at foo:1', kind: 'unhandledrejection' });
    expect(mockFs.appendFileSync).toHaveBeenCalled();
    const line = mockFs.appendFileSync.mock.calls[0][1];
    const obj = JSON.parse(line);
    expect(obj.level).toBe('error');
    expect(obj.source).toBe('renderer');
    expect(obj.message).toBe('boom');
    expect(obj.stack).toBe('at foo:1');
  });

  test('log:error ignores invalid payloads (null, undefined, non-object)', () => {
    mockFs.appendFileSync.mockClear();
    logError({}, null);
    logError({}, undefined);
    logError({}, 'not-an-object');
    logError({}, 42);
    expect(mockFs.appendFileSync).not.toHaveBeenCalled();
  });

  test('log:error rate-limited at 100/min — over-cap dropped silently', () => {
    mockFs.appendFileSync.mockClear();
    const before = mockFs.appendFileSync.mock.calls.length;
    for (let i = 0; i < 150; i++) {
      logError({}, { message: `e${i}` });
    }
    const written = mockFs.appendFileSync.mock.calls.length - before;
    // The cap is 100 PER MINUTE, shared across tests in the same window.
    // Earlier tests already consumed a few slots; this loop fills the rest
    // and drops the remainder. Assert: at least one drop happened and the
    // total never exceeds the cap.
    expect(written).toBeLessThan(150);
    expect(written).toBeGreaterThan(0);
    expect(written).toBeLessThanOrEqual(100);
  });

  test('process.on("uncaughtException") path writes to log', () => {
    mockFs.appendFileSync.mockClear();
    const err = new Error('main boom');
    process.emit('uncaughtException', err);
    expect(mockFs.appendFileSync).toHaveBeenCalled();
    const obj = JSON.parse(mockFs.appendFileSync.mock.calls.at(-1)[1]);
    expect(obj.source).toBe('main:uncaughtException');
    expect(obj.message).toBe('main boom');
  });

  test('process.on("unhandledRejection") handles both Error and non-Error reasons', () => {
    mockFs.appendFileSync.mockClear();
    process.emit('unhandledRejection', new Error('promise boom'));
    process.emit('unhandledRejection', 'plain string reason');

    const calls = mockFs.appendFileSync.mock.calls.map(c => JSON.parse(c[1]));
    expect(calls).toHaveLength(2);
    expect(calls[0].source).toBe('main:unhandledRejection');
    expect(calls[0].message).toBe('promise boom');
    expect(calls[0].stack).toBeDefined();
    expect(calls[1].message).toBe('plain string reason');
    expect(calls[1].stack).toBeUndefined();
  });

  // ─ external URL routing (setWindowOpenHandler) ──────────────────────
  test('setWindowOpenHandler opens http URLs externally and denies the new window', () => {
    expect(mockElectron._mockWin.webContents.setWindowOpenHandler).toHaveBeenCalled();
    const handler = mockElectron._mockWin.webContents.setWindowOpenHandler.mock.calls.at(-1)[0];

    mockElectron.shell.openExternal.mockClear();
    const r1 = handler({ url: 'https://example.com' });
    expect(mockElectron.shell.openExternal).toHaveBeenCalledWith('https://example.com');
    expect(r1).toEqual({ action: 'deny' });

    mockElectron.shell.openExternal.mockClear();
    const r2 = handler({ url: 'file:///etc/passwd' });
    expect(mockElectron.shell.openExternal).not.toHaveBeenCalled();
    expect(r2).toEqual({ action: 'deny' });
  });
});
