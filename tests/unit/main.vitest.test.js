/**
 * Vitest tests for main.js and preload.js with V8 coverage.
 *
 * Both files now expose an INJECTABLE SEAM (audit #3):
 *   - main.js     exports `bootstrap({ electron, fs, path, proc })`
 *   - preload.js  exports `setupBridge({ contextBridge, ipcRenderer })`
 * and only auto-run their real Electron bootstrap when loaded as the
 * Electron entry / preload (guarded inside each file). That lets these tests
 * drive the real code with plain mock objects — no Module._resolveFilename
 * hijack — so Stryker's per-test coverage can instrument both files and they
 * are now included in `stryker.config.json` `mutate`.
 */

import { describe, test, expect, vi, beforeAll, afterAll } from 'vitest';
import { bootstrap } from '../../main.js';
import { setupBridge } from '../../preload.js';

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
    isMinimized: vi.fn(() => false),
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
  const menuPopup = vi.fn();
  const Menu = { buildFromTemplate: vi.fn(() => ({ popup: menuPopup })), _popup: menuPopup };

  return {
    app: mockApp,
    BrowserWindow,
    ipcMain,
    ipcRenderer,
    contextBridge,
    shell: { openExternal: vi.fn() },
    dialog: { showOpenDialog: vi.fn(() => Promise.resolve({ canceled: true, filePaths: [] })) },
    crashReporter,
    Menu,
    _mockWin: mockWin,
  };
}

function buildMockFs(overrides = {}) {
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
    appendFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    existsSync: vi.fn(() => false),
    renameSync: vi.fn(),
    ...overrides,
  };
}

// A throwaway EventEmitter-ish process stub so process.on/emit inside bootstrap
// is isolated per test group and doesn't leak listeners onto the real process.
function buildMockProc(argv) {
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

// ── TESTS ──────────────────────────────────────────────────────────────────

describe('main.js — seam exposes bootstrap', () => {
  test('bootstrap is an exported function', () => {
    expect(typeof bootstrap).toBe('function');
  });
});

describe('main.js', () => {
  let mockElectron;
  let mockProc;

  beforeAll(async () => {
    mockElectron = buildMockElectron();
    mockProc = buildMockProc(['node', 'main.js']);
    bootstrap({ electron: mockElectron, fs: buildMockFs(), proc: mockProc });
    await new Promise(r => setTimeout(r, 50));
  });

  test('creates BrowserWindow with correct options', () => {
    expect(mockElectron.BrowserWindow).toHaveBeenCalled();
    const opts = mockElectron.BrowserWindow.mock.calls[0][0];
    expect(opts.width).toBe(1280);
    expect(opts.height).toBe(820);
    expect(opts.title).toBe('BP MD RTL Reader');
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

  test('loads index.html', () => {
    expect(mockElectron._mockWin.loadFile).toHaveBeenCalledWith('index.html');
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

  beforeAll(() => {
    mockElectron = buildMockElectron();
    setupBridge({ contextBridge: mockElectron.contextBridge, ipcRenderer: mockElectron.ipcRenderer });
  });

  // Helper: pull the live electronAPI object out of the captured
  // contextBridge.exposeInMainWorld call.
  function getApi() {
    return mockElectron.contextBridge.exposeInMainWorld.mock.calls[0][1];
  }

  test('exposes 8 electronAPI methods (incl. logError from #15)', () => {
    expect(mockElectron.contextBridge.exposeInMainWorld).toHaveBeenCalledWith('electronAPI', expect.any(Object));
    const api = getApi();
    expect(typeof api.closeWindow).toBe('function');
    expect(typeof api.minimizeWindow).toBe('function');
    expect(typeof api.maximizeWindow).toBe('function');
    expect(typeof api.openFolder).toBe('function');
    expect(typeof api.readVault).toBe('function');
    expect(typeof api.editCommand).toBe('function');
    expect(typeof api.onOpenFile).toBe('function');
    expect(typeof api.logError).toBe('function');
  });

  // ─ window controls (kills NoCoverage on preload.js L4-L6) ──────────
  test('closeWindow sends window-close IPC', () => {
    mockElectron.ipcRenderer.send.mockClear();
    getApi().closeWindow();
    expect(mockElectron.ipcRenderer.send).toHaveBeenCalledWith('window-close');
    expect(mockElectron.ipcRenderer.send).toHaveBeenCalledTimes(1);
  });

  test('minimizeWindow sends window-minimize IPC', () => {
    mockElectron.ipcRenderer.send.mockClear();
    getApi().minimizeWindow();
    expect(mockElectron.ipcRenderer.send).toHaveBeenCalledWith('window-minimize');
    expect(mockElectron.ipcRenderer.send).toHaveBeenCalledTimes(1);
  });

  test('maximizeWindow sends window-maximize IPC', () => {
    mockElectron.ipcRenderer.send.mockClear();
    getApi().maximizeWindow();
    expect(mockElectron.ipcRenderer.send).toHaveBeenCalledWith('window-maximize');
    expect(mockElectron.ipcRenderer.send).toHaveBeenCalledTimes(1);
  });

  // ─ invokes (kills L8, L9) ──────────────────────────────────────────
  test('openFolder invokes dialog:openFolder (no args)', () => {
    mockElectron.ipcRenderer.invoke.mockClear();
    getApi().openFolder();
    expect(mockElectron.ipcRenderer.invoke).toHaveBeenCalledWith('dialog:openFolder');
    expect(mockElectron.ipcRenderer.invoke).toHaveBeenCalledTimes(1);
  });

  test('readVault invokes fs:readVault with folderPath argument', () => {
    mockElectron.ipcRenderer.invoke.mockClear();
    getApi().readVault('/vault');
    expect(mockElectron.ipcRenderer.invoke).toHaveBeenCalledWith('fs:readVault', '/vault');
  });

  test('readVault passes through whatever folderPath is given (no normalisation)', () => {
    mockElectron.ipcRenderer.invoke.mockClear();
    getApi().readVault('\\\\server\\share');           // UNC
    getApi().readVault('//server/share');               // POSIX net
    getApi().readVault('C:\\Users\\Legend\\notes');     // local Windows
    const calls = mockElectron.ipcRenderer.invoke.mock.calls
      .filter(c => c[0] === 'fs:readVault')
      .map(c => c[1]);
    expect(calls).toEqual(['\\\\server\\share', '//server/share', 'C:\\Users\\Legend\\notes']);
  });

  // ─ editCommand (kills L13) ─────────────────────────────────────────
  test('editCommand sends edit:command with the given cmd string', () => {
    mockElectron.ipcRenderer.send.mockClear();
    getApi().editCommand('copy');
    expect(mockElectron.ipcRenderer.send).toHaveBeenCalledWith('edit:command', 'copy');
  });

  test('editCommand forwards each of the 6 valid cmd strings unchanged', () => {
    mockElectron.ipcRenderer.send.mockClear();
    const api = getApi();
    for (const cmd of ['copy', 'cut', 'paste', 'undo', 'redo', 'selectAll']) {
      api.editCommand(cmd);
    }
    const cmdsSent = mockElectron.ipcRenderer.send.mock.calls
      .filter(c => c[0] === 'edit:command')
      .map(c => c[1]);
    expect(cmdsSent).toEqual(['copy', 'cut', 'paste', 'undo', 'redo', 'selectAll']);
  });

  test('editCommand passes through unknown cmds (preload does not validate)', () => {
    mockElectron.ipcRenderer.send.mockClear();
    getApi().editCommand('bogus-cmd');
    expect(mockElectron.ipcRenderer.send).toHaveBeenCalledWith('edit:command', 'bogus-cmd');
  });

  // ─ onOpenFile (kills L17 callback path) ────────────────────────────
  test('onOpenFile registers callback and forwards data on event', () => {
    const cb = vi.fn();
    getApi().onOpenFile(cb);
    const handlerCall = mockElectron.ipcRenderer.on.mock.calls.find(c => c[0] === 'open-external-file');
    expect(handlerCall).toBeDefined();
    const handler = handlerCall[1];
    handler({}, { name: 'test.md', path: '/test.md', content: '# Hello' });
    expect(cb).toHaveBeenCalledWith({ name: 'test.md', path: '/test.md', content: '# Hello' });
  });

  test('onOpenFile DOES NOT leak the IpcRendererEvent to the callback', () => {
    const cb = vi.fn();
    getApi().onOpenFile(cb);
    const handlers = mockElectron.ipcRenderer.on.mock.calls
      .filter(c => c[0] === 'open-external-file').map(c => c[1]);
    const latest = handlers[handlers.length - 1];
    const fakeEvent = { sender: 'should-not-be-exposed' };
    latest(fakeEvent, { name: 'x.md' });
    // Callback must have been invoked with ONLY the payload, never with the event.
    expect(cb).toHaveBeenLastCalledWith({ name: 'x.md' });
    // Defensive: check none of the call args ever included an object with a .sender field
    for (const args of cb.mock.calls) {
      for (const a of args) {
        expect(a && typeof a === 'object' && 'sender' in a).toBeFalsy();
      }
    }
  });

  // ─ logError (kills L21) ────────────────────────────────────────────
  test('logError sends log:error with the given payload', () => {
    mockElectron.ipcRenderer.send.mockClear();
    const payload = { message: 'boom', stack: 'at foo:1', source: 'file.js', line: 42 };
    getApi().logError(payload);
    expect(mockElectron.ipcRenderer.send).toHaveBeenCalledWith('log:error', payload);
  });

  test('logError is fire-and-forget — uses send, not invoke', () => {
    mockElectron.ipcRenderer.send.mockClear();
    mockElectron.ipcRenderer.invoke.mockClear();
    getApi().logError({ message: 'x' });
    expect(mockElectron.ipcRenderer.send).toHaveBeenCalled();
    expect(mockElectron.ipcRenderer.invoke).not.toHaveBeenCalled();
  });

  test('logError passes any payload through unchanged (validation is main-side)', () => {
    mockElectron.ipcRenderer.send.mockClear();
    const api = getApi();
    api.logError(null);
    api.logError(undefined);
    api.logError('not-an-object');
    api.logError(42);
    api.logError({ message: 'real' });
    const payloads = mockElectron.ipcRenderer.send.mock.calls
      .filter(c => c[0] === 'log:error').map(c => c[1]);
    expect(payloads).toEqual([null, undefined, 'not-an-object', 42, { message: 'real' }]);
  });

  // ─ contextBridge.exposeInMainWorld arity ───────────────────────────
  test('contextBridge.exposeInMainWorld called exactly once with "electronAPI"', () => {
    expect(mockElectron.contextBridge.exposeInMainWorld).toHaveBeenCalledTimes(1);
    expect(mockElectron.contextBridge.exposeInMainWorld.mock.calls[0][0]).toBe('electronAPI');
  });
});

// ── IPC CONCURRENCY (audit #9) ─────────────────────────────────────────────
// main.js holds `allowedFolders` as a Set mutated by dialog:openFolder and read
// by fs:readVault. These tests exercise the handlers under parallel invocations
// to verify that:
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
  let openFolderHandler;
  let readVaultHandler;

  beforeAll(async () => {
    mockElectron = buildMockElectron();
    const mockFs = buildMockFs({
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
    });

    bootstrap({ electron: mockElectron, fs: mockFs, proc: buildMockProc(['node', 'main.js']) });
    await new Promise(r => setTimeout(r, 50));

    openFolderHandler = mockElectron.ipcMain.handle.mock.calls
      .find(c => c[0] === 'dialog:openFolder')[1];
    readVaultHandler = mockElectron.ipcMain.handle.mock.calls
      .find(c => c[0] === 'fs:readVault')[1];
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
// observability code.
//
// Scope:
//   - dialog:openFolder cancel path
//   - fs:readVault: invalid input, network paths, file/cumulative caps,
//     symlink escape detection, happy path with multiple files + BOM
//   - edit:command: all 6 commands + unknown + destroyed sender
//   - window-close/min/max (max twice — already-max vs not)
//   - crashReporter.start was invoked
//   - proc.on('uncaughtException'|'unhandledRejection') -> writeLog
//   - log:error IPC + rate limit + invalid-payload guard
//   - setWindowOpenHandler: http -> shell.openExternal, deny non-http

describe('main.js — handler behaviour (audit #1)', () => {
  let mockElectron;
  let mockFs;
  let mockProc;
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
    mockFs = buildMockFs({
      readFileSync: vi.fn(() => '﻿# Hello'), // includes BOM
    });

    mockProc = buildMockProc(['node', 'main.js']);
    bootstrap({ electron: mockElectron, fs: mockFs, proc: mockProc });
    await new Promise(r => setTimeout(r, 50));

    openFolder = getHandle('dialog:openFolder');
    readVault = getHandle('fs:readVault');
    editCmd = getOn('edit:command');
    logError = getOn('log:error');
    winClose = getOn('window-close');
    winMin = getOn('window-minimize');
    winMax = getOn('window-maximize');
  });

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

  test('proc.on("uncaughtException") path writes to log', () => {
    mockFs.appendFileSync.mockClear();
    const err = new Error('main boom');
    mockProc.emit('uncaughtException', err);
    expect(mockFs.appendFileSync).toHaveBeenCalled();
    const obj = JSON.parse(mockFs.appendFileSync.mock.calls.at(-1)[1]);
    expect(obj.source).toBe('main:uncaughtException');
    expect(obj.message).toBe('main boom');
  });

  test('proc.on("unhandledRejection") handles both Error and non-Error reasons', () => {
    mockFs.appendFileSync.mockClear();
    mockProc.emit('unhandledRejection', new Error('promise boom'));
    mockProc.emit('unhandledRejection', 'plain string reason');

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

// ── APP LIFECYCLE + FILE ASSOCIATION + LOG ROTATION (audit #1, follow-up) ─
// Covers the remaining uncovered branches in main.js:
//   - deliverPendingFile (guard, happy path, fs throws)
//   - did-finish-load handler invocation
//   - app.whenReady().then() — pendingFileToOpen seed from argv, createWindow,
//     activate handler registration
//   - app.on('activate') — recreates window when none
//   - app.on('open-file') — preventDefault + deliver path
//   - app.on('window-all-closed') — quits when platform !== 'darwin'
//   - app.on('second-instance') — focuses existing, restores if minimised
//   - rotateIfNeeded — actually fires its rename loop when size >= 1 MiB
//   - log:error — minute-window rollover with logDropped > 0 emits summary

describe('main.js — lifecycle + file-association + log rotation (audit #1)', () => {
  let mockElectron;
  let mockFs;
  let mockProc;
  let mockAppListeners;
  let didFinishLoadHandler;

  beforeAll(async () => {
    mockElectron = buildMockElectron();
    // buildMockElectron already exposes isMinimized; capture app.on listeners.
    mockAppListeners = {};
    mockElectron.app.on.mockImplementation((event, fn) => {
      mockAppListeners[event] = fn;
    });
    // Capture webContents.on('did-finish-load', cb) for later invocation.
    mockElectron._mockWin.webContents.on.mockImplementation((event, fn) => {
      if (event === 'did-finish-load') didFinishLoadHandler = fn;
    });

    mockFs = buildMockFs({
      readFileSync: vi.fn(() => '﻿# Pending'), // includes BOM
    });

    // Seed argv with a recognised .md path so app.whenReady continuation
    // sets pendingFileToOpen and the did-finish-load + deliverPendingFile path
    // is exercised end-to-end.
    mockProc = buildMockProc(['node', 'main.js', 'pending.md']);

    bootstrap({ electron: mockElectron, fs: mockFs, proc: mockProc });
    await new Promise(r => setTimeout(r, 50));
  });

  // ─ app.whenReady continuation ──────────────────────────────────────
  test('app.whenReady() runs createWindow and registers activate handler', () => {
    expect(mockElectron.BrowserWindow).toHaveBeenCalled();
    expect(mockAppListeners.activate).toBeInstanceOf(Function);
  });

  test('app.whenReady() seeds pendingFileToOpen from proc.argv .md path', () => {
    // Indirect assertion: triggering did-finish-load now should deliver the
    // pending file via webContents.send('open-external-file', ...).
    expect(typeof didFinishLoadHandler).toBe('function');
    mockElectron._mockWin.webContents.send.mockClear();
    didFinishLoadHandler();
    expect(mockElectron._mockWin.webContents.send).toHaveBeenCalledWith(
      'open-external-file',
      expect.objectContaining({ name: 'pending.md', content: '# Pending' /* BOM stripped */ })
    );
  });

  // ─ deliverPendingFile guards ───────────────────────────────────────
  test('deliverPendingFile: did-finish-load no-op when no pending file (already delivered above)', () => {
    // Previous test consumed the pending file. Another did-finish-load
    // tick must be a silent no-op (early-return on !pendingFileToOpen).
    mockElectron._mockWin.webContents.send.mockClear();
    didFinishLoadHandler();
    expect(mockElectron._mockWin.webContents.send).not.toHaveBeenCalled();
  });

  test('deliverPendingFile: silent catch when fs.readFileSync throws', () => {
    // Re-seed a pending file via open-file event, then make read throw.
    // Must ensure getAllWindows returns a window so deliverPendingFile
    // actually fires and consumes the throwing mockImplementationOnce
    // (otherwise the throw would leak into the next test).
    mockFs.readFileSync.mockImplementationOnce(() => { throw new Error('ENOENT'); });
    mockElectron.BrowserWindow.getAllWindows.mockReturnValueOnce([mockElectron._mockWin]);
    mockElectron._mockWin.webContents.send.mockClear();

    const openFileEvent = { preventDefault: vi.fn() };
    mockAppListeners['open-file'](openFileEvent, '/some/path.md');

    // preventDefault always called; send NOT called because readFileSync threw
    expect(openFileEvent.preventDefault).toHaveBeenCalled();
    expect(mockElectron._mockWin.webContents.send).not.toHaveBeenCalled();
  });

  // ─ app.on('activate') — recreates window when none ─────────────────
  test('app.on("activate") creates a new window when no windows are open', () => {
    mockElectron.BrowserWindow.getAllWindows.mockReturnValueOnce([]);
    const before = mockElectron.BrowserWindow.mock.calls.length;
    mockAppListeners.activate();
    expect(mockElectron.BrowserWindow.mock.calls.length).toBe(before + 1);
  });

  test('app.on("activate") does NOT create a window when one exists', () => {
    mockElectron.BrowserWindow.getAllWindows.mockReturnValueOnce([mockElectron._mockWin]);
    const before = mockElectron.BrowserWindow.mock.calls.length;
    mockAppListeners.activate();
    expect(mockElectron.BrowserWindow.mock.calls.length).toBe(before);
  });

  // ─ app.on('open-file') ─────────────────────────────────────────────
  test('app.on("open-file") with empty path is a no-op after preventDefault', () => {
    const ev = { preventDefault: vi.fn() };
    mockElectron._mockWin.webContents.send.mockClear();
    mockAppListeners['open-file'](ev, '');
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(mockElectron._mockWin.webContents.send).not.toHaveBeenCalled();
  });

  // ─ app.on('second-instance') — focus + restore + deliver ───────────
  test('app.on("second-instance"): existing window is focused and restored', () => {
    const win = mockElectron._mockWin;
    win.focus.mockClear();
    win.restore.mockClear();
    win.isMinimized.mockReturnValueOnce(true);
    mockElectron.BrowserWindow.getAllWindows.mockReturnValueOnce([win]);
    mockAppListeners['second-instance']({}, ['node', 'main.js']);
    expect(win.restore).toHaveBeenCalled();
    expect(win.focus).toHaveBeenCalled();
  });

  test('app.on("second-instance") with file arg in argv delivers the file', () => {
    const win = mockElectron._mockWin;
    win.webContents.send.mockClear();
    win.isMinimized.mockReturnValueOnce(false);
    mockElectron.BrowserWindow.getAllWindows.mockReturnValueOnce([win]);
    // realpathSync returns the path as-is; statSync says it's a 100-byte file.
    mockAppListeners['second-instance']({}, ['node', 'main.js', 'second.md']);
    expect(win.webContents.send).toHaveBeenCalledWith(
      'open-external-file',
      expect.objectContaining({ name: 'second.md' })
    );
  });

  test('app.on("second-instance") with no windows is a no-op', () => {
    mockElectron.BrowserWindow.getAllWindows.mockReturnValueOnce([]);
    expect(() => mockAppListeners['second-instance']({}, ['node', 'main.js'])).not.toThrow();
  });

  // ─ app.on('window-all-closed') ─────────────────────────────────────
  test('app.on("window-all-closed") quits when platform is not darwin', () => {
    mockProc.platform = 'win32';
    mockElectron.app.quit.mockClear();
    mockAppListeners['window-all-closed']();
    expect(mockElectron.app.quit).toHaveBeenCalled();
  });

  test('app.on("window-all-closed") does NOT quit on darwin', () => {
    mockProc.platform = 'darwin';
    mockElectron.app.quit.mockClear();
    mockAppListeners['window-all-closed']();
    expect(mockElectron.app.quit).not.toHaveBeenCalled();
    mockProc.platform = process.platform;
  });

  // ─ rotateIfNeeded — fires its rename loop ──────────────────────────
  test('writeLog triggers rotateIfNeeded when log file size exceeds 1 MiB', () => {
    // First make statSync claim the file is over the rotation cap, and pretend
    // the previous rotation files (.1, .2) exist so the loop body executes.
    mockFs.statSync.mockReturnValueOnce({ size: 2 * 1024 * 1024 });
    mockFs.existsSync.mockImplementation(() => true);
    mockFs.renameSync.mockClear();

    // Trigger writeLog by emitting uncaughtException (a path bound to writeLog
    // at top of bootstrap). Any one writeLog call goes through rotateIfNeeded.
    mockProc.emit('uncaughtException', new Error('trigger rotation'));

    // Expect a chain of renames:
    //   .2 -> .3, .1 -> .2, then the current file -> .1
    const renameTargets = mockFs.renameSync.mock.calls.map(c => c[1]);
    expect(renameTargets.some(t => /\.1$/.test(t))).toBe(true);
  });

  // ─ log:error minute-window rollover with summary ───────────────────
  test('log:error rollover writes a "dropped N" summary when window expires', () => {
    const logError = mockElectron.ipcMain.on.mock.calls.find(c => c[0] === 'log:error')[1];

    // Phase 1: fill the cap to overflow so logDropped > 0
    mockFs.appendFileSync.mockClear();
    for (let i = 0; i < 200; i++) logError({}, { message: `e${i}` });
    const writtenInPhase1 = mockFs.appendFileSync.mock.calls.length;
    expect(writtenInPhase1).toBeGreaterThan(0);
    expect(writtenInPhase1).toBeLessThanOrEqual(100); // cap enforced

    // Phase 2: jump Date.now() forward past 60s so the window rolls over.
    const realNow = Date.now;
    const spy = vi.spyOn(Date, 'now').mockReturnValue(realNow() + 70_000);
    mockFs.appendFileSync.mockClear();

    logError({}, { message: 'after rollover' });

    // After rollover we expect TWO writes: the "dropped N" summary, then the
    // new event itself.
    const linesAfter = mockFs.appendFileSync.mock.calls.map(c => JSON.parse(c[1]));
    expect(linesAfter.length).toBeGreaterThanOrEqual(2);
    expect(linesAfter.some(l => l.source === 'main:rateLimit' && /^dropped \d+/.test(l.message))).toBe(true);
    expect(linesAfter.some(l => l.message === 'after rollover')).toBe(true);

    spy.mockRestore();
  });
});

// ── RIGHT-CLICK CONTEXT MENU (Edit-menu fix) ───────────────────────────────
// main.js registers webContents.on('context-menu', …) and pops up a native
// role-based menu (undo/redo/cut/copy/paste/selectAll) gated by params.
describe('main.js — right-click context menu', () => {
  let mockElectron;
  let ctxHandler;

  beforeAll(async () => {
    mockElectron = buildMockElectron();
    // Capture the context-menu listener so we can invoke it directly.
    mockElectron._mockWin.webContents.on.mockImplementation((event, fn) => {
      if (event === 'context-menu') ctxHandler = fn;
    });

    bootstrap({ electron: mockElectron, fs: buildMockFs(), proc: buildMockProc(['node', 'main.js']) });
    await new Promise(r => setTimeout(r, 50));
  });

  test('registers a context-menu handler', () => {
    expect(typeof ctxHandler).toBe('function');
  });

  test('editable field → full edit menu with roles, enabled per editFlags', () => {
    mockElectron.Menu.buildFromTemplate.mockClear();
    mockElectron.Menu._popup.mockClear();
    ctxHandler({}, {
      isEditable: true,
      selectionText: 'sel',
      editFlags: { canUndo: true, canRedo: false, canCut: true, canCopy: true, canPaste: false, canSelectAll: true },
    });
    expect(mockElectron.Menu.buildFromTemplate).toHaveBeenCalledTimes(1);
    const tpl = mockElectron.Menu.buildFromTemplate.mock.calls[0][0];
    expect(tpl.filter(i => i.role).map(i => i.role)).toEqual(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']);
    const byRole = Object.fromEntries(tpl.filter(i => i.role).map(i => [i.role, i.enabled]));
    expect(byRole.undo).toBe(true);
    expect(byRole.redo).toBe(false);   // canRedo:false → disabled
    expect(byRole.paste).toBe(false);  // canPaste:false → disabled
    expect(mockElectron.Menu._popup).toHaveBeenCalledTimes(1);
  });

  test('non-editable WITH selection → Copy + Select All only', () => {
    mockElectron.Menu.buildFromTemplate.mockClear();
    mockElectron.Menu._popup.mockClear();
    ctxHandler({}, { isEditable: false, selectionText: 'hello', editFlags: { canCopy: true, canSelectAll: true } });
    const tpl = mockElectron.Menu.buildFromTemplate.mock.calls[0][0];
    expect(tpl.filter(i => i.role).map(i => i.role)).toEqual(['copy', 'selectAll']);
    expect(mockElectron.Menu._popup).toHaveBeenCalledTimes(1);
  });

  test('non-editable, no selection → no menu shown', () => {
    mockElectron.Menu.buildFromTemplate.mockClear();
    mockElectron.Menu._popup.mockClear();
    ctxHandler({}, { isEditable: false, selectionText: '   ', editFlags: {} });
    expect(mockElectron.Menu.buildFromTemplate).not.toHaveBeenCalled();
    expect(mockElectron.Menu._popup).not.toHaveBeenCalled();
  });
});
