/**
 * Vitest tests for src/main/index.js and src/preload/index.js with V8 coverage.
 *
 * Both files now expose an INJECTABLE SEAM (audit #3):
 *   - src/main/index.js     exports `bootstrap({ electron, fs, path, proc })`
 *   - src/preload/index.js  exports `setupBridge({ contextBridge, ipcRenderer })`
 * and only auto-run their real Electron bootstrap when loaded as the
 * Electron entry / preload (guarded inside each file). That lets these tests
 * drive the real code with plain mock objects — no Module._resolveFilename
 * hijack — so Stryker's per-test coverage can instrument both files and they
 * are now included in `stryker.config.json` `mutate`.
 */

import { describe, test, expect, vi, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { bootstrap } from '../../src/main/index.js';
import { setupBridge } from '../../src/preload/index.js';

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
    dialog: {
      showOpenDialog: vi.fn(() => Promise.resolve({ canceled: true, filePaths: [] })),
      showSaveDialog: vi.fn(() => Promise.resolve({ canceled: true })),
    },
    clipboard: { writeText: vi.fn() },
    crashReporter,
    Menu,
    _mockWin: mockWin,
  };
}

function buildMockFs(overrides = {}) {
  return {
    readFileSync: vi.fn(() => '# Hello'),
    realpathSync: vi.fn((p) => /^[\\/]/.test(String(p)) ? p : `/abs/${p}`),
    statSync: vi.fn((p) => {
      const file = /\.(md|markdown|txt)$/i.test(String(p));
      return { isFile: () => file, isDirectory: () => !file, size: 100, mtimeMs: 123 };
    }),
    promises: {
      readdir: vi.fn(() => Promise.resolve([])),
      lstat: vi.fn(() => Promise.resolve({ isSymbolicLink: () => false, isFile: () => true, size: 100 })),
      realpath: vi.fn((p) => Promise.resolve(p)),
      stat: vi.fn(() => Promise.resolve({ isFile: () => true, size: 100 })),
      readFile: vi.fn(() => Promise.resolve('content')),
      mkdir: vi.fn(() => Promise.resolve()),
      writeFile: vi.fn(() => Promise.resolve()),
      unlink: vi.fn(() => Promise.resolve()),
    },
    appendFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    existsSync: vi.fn(() => false),
    renameSync: vi.fn(),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
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

describe('src/main/index.js — seam exposes bootstrap', () => {
  test('bootstrap is an exported function', () => {
    expect(typeof bootstrap).toBe('function');
  });
});

describe('src/main/index.js', () => {
  let mockElectron;
  let mockProc;

  beforeAll(async () => {
    mockElectron = buildMockElectron();
    mockProc = buildMockProc(['node', 'src/main/index.js']);
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
    expect(mockElectron.ipcMain.on).toHaveBeenCalledWith('window-close-confirmed', expect.any(Function));
    expect(mockElectron.ipcMain.on).toHaveBeenCalledWith('window-minimize', expect.any(Function));
    expect(mockElectron.ipcMain.on).toHaveBeenCalledWith('window-maximize', expect.any(Function));
  });

  test('loads index.html', () => {
    expect(mockElectron._mockWin.loadFile).toHaveBeenCalledWith(path.join(process.cwd(), 'src', 'renderer', 'index.html'));
  });

  test('window-close-confirmed calls win.close', () => {
    const win = mockElectron._mockWin;
    win.close.mockClear();
    const handlers = mockElectron.ipcMain.on.mock.calls.filter(c => c[0] === 'window-close-confirmed');
    expect(handlers.length).toBeGreaterThan(0);
    handlers[handlers.length - 1][1]({ sender: win.webContents }); // call latest registered handler
    expect(win.close).toHaveBeenCalled();
  });
});

describe('src/main/index.js — standalone Save As boundary', () => {
  test('validates input, preserves text metadata, and grants the saved Markdown file', async () => {
    const electron = buildMockElectron();
    const fs = buildMockFs();
    bootstrap({ electron, fs, proc: buildMockProc(['node', 'src/main/index.js']) });
    await new Promise(resolve => setTimeout(resolve, 0));
    const save = electron.ipcMain.handle.mock.calls.find(call => call[0] === 'dialog:saveFile')[1];

    await expect(save({}, null)).resolves.toEqual({ error: 'invalid' });
    await expect(save({}, { content: 7 })).resolves.toEqual({ error: 'invalid' });
    await expect(save({}, { content: 'x'.repeat(10 * 1024 * 1024 + 1) }))
      .resolves.toEqual({ error: 'file-too-large' });
    expect(electron.dialog.showSaveDialog).not.toHaveBeenCalled();

    electron.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: true });
    await expect(save({}, { content: 'x' })).resolves.toEqual({ canceled: true });
    electron.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: '' });
    await expect(save({}, { content: 'x' })).resolves.toEqual({ canceled: true });
    electron.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: '//server/note.md' });
    await expect(save({}, { content: 'x' })).resolves.toEqual({ error: 'network-path-not-allowed' });

    electron.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: '/notes/note.txt' });
    await expect(save({}, { content: 'x' })).resolves.toEqual({ error: 'invalid-file-type' });

    electron.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: '/notes/saved.md' });
    const result = await save({}, {
      content: 'line1\nline2', suggestedName: 'Draft.markdown', bom: true,
      eol: '\r\n', finalNewline: false, revision: 17,
    });
    expect(electron.dialog.showSaveDialog).toHaveBeenLastCalledWith(electron._mockWin, {
      title: 'Save Markdown File',
      defaultPath: 'Draft.markdown',
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
    });
    expect(result).toMatchObject({ ok: true, name: 'saved.md', revision: 17 });
    expect(result.documentId).toMatch(/^cap-/);
    const documentWrite = fs.writeFileSync.mock.calls.find(call => String(call[0]).startsWith('/notes/saved.md.tmp-'));
    expect(documentWrite[1]).toBe('\uFEFFline1\r\nline2');
    expect(result.meta).toMatchObject({ bom: true, eol: '\r\n', finalNewline: false });
  });

  test('uses a safe default name and reports atomic-write or grant failures', async () => {
    const writeFailureElectron = buildMockElectron();
    const writeFailureFs = buildMockFs({ writeFileSync: vi.fn(() => { throw new Error('disk'); }) });
    writeFailureElectron.dialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/notes/fail.md' });
    bootstrap({ electron: writeFailureElectron, fs: writeFailureFs, proc: buildMockProc(['node', 'src/main/index.js']) });
    await new Promise(resolve => setTimeout(resolve, 0));
    const saveWriteFailure = writeFailureElectron.ipcMain.handle.mock.calls.find(call => call[0] === 'dialog:saveFile')[1];
    await expect(saveWriteFailure({}, { content: 'x', suggestedName: 42, eol: '\n', finalNewline: true }))
      .resolves.toEqual({ error: 'write-failed' });
    expect(writeFailureElectron.dialog.showSaveDialog.mock.calls[0][1].defaultPath).toBe('Untitled.md');

    const grantFailureElectron = buildMockElectron();
    const grantFailureFs = buildMockFs({
      statSync: vi.fn(() => ({ isFile: () => false, isDirectory: () => false, size: 1, mtimeMs: 1 })),
    });
    grantFailureElectron.dialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/notes/grant.md' });
    bootstrap({ electron: grantFailureElectron, fs: grantFailureFs, proc: buildMockProc(['node', 'src/main/index.js']) });
    await new Promise(resolve => setTimeout(resolve, 0));
    const saveGrantFailure = grantFailureElectron.ipcMain.handle.mock.calls.find(call => call[0] === 'dialog:saveFile')[1];
    await expect(saveGrantFailure({}, { content: 'x' })).resolves.toEqual({ error: 'write-failed' });
  });
});

describe('src/preload/index.js', () => {
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

  test('exposes electronAPI methods (incl. logError #15, exportPDF T-F6)', () => {
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
    expect(typeof api.exportPDF).toBe('function');
    expect(typeof api.onVaultChanged).toBe('function');
    expect(typeof api.checkForUpdate).toBe('function');
  });

  test('checkForUpdate invokes update:check with no arguments (T-Q6)', () => {
    mockElectron.ipcRenderer.invoke.mockClear();
    getApi().checkForUpdate();
    expect(mockElectron.ipcRenderer.invoke).toHaveBeenCalledWith('update:check');
    expect(mockElectron.ipcRenderer.invoke).toHaveBeenCalledTimes(1);
  });

  test('onVaultChanged subscribes to the vault:changed channel and unwraps the payload (T-B9)', () => {
    mockElectron.ipcRenderer.on.mockClear();
    const seen = [];
    getApi().onVaultChanged((data) => seen.push(data));
    const call = mockElectron.ipcRenderer.on.mock.calls.find((c) => c[0] === 'vault:changed');
    expect(call, 'should subscribe to vault:changed').toBeTruthy();
    call[1]({}, { folderPath: '/v', files: ['a.md'] }); // simulate the main-process emit
    expect(seen).toEqual([{ folderPath: '/v', files: ['a.md'] }]);
  });

  test('exportPDF invokes export:pdf with the payload (T-F6)', () => {
    mockElectron.ipcRenderer.invoke.mockClear();
    const payload = { html: '<html></html>', defaultName: 'note.pdf' };
    getApi().exportPDF(payload);
    expect(mockElectron.ipcRenderer.invoke).toHaveBeenCalledWith('export:pdf', payload);
    expect(mockElectron.ipcRenderer.invoke).toHaveBeenCalledTimes(1);
  });

  // ─ window controls (kills NoCoverage on src/preload/index.js L4-L6) ──────────
  test('closeWindow sends window-close-confirmed IPC', () => {
    mockElectron.ipcRenderer.send.mockClear();
    getApi().closeWindow();
    expect(mockElectron.ipcRenderer.send).toHaveBeenCalledWith('window-close-confirmed');
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

  test('open/read/write/save and settings bridge methods invoke their exact channels', () => {
    mockElectron.ipcRenderer.invoke.mockClear();
    const api = getApi();
    api.openFile();
    api.readFile('cap-document');
    api.writeFile({ documentId: 'cap-document', content: 'x' });
    api.saveFileAs({ name: 'x.md', content: 'x' });
    api.getSettings();
    api.setSettings({ theme: 'ink' });
    expect(mockElectron.ipcRenderer.invoke.mock.calls).toEqual([
      ['dialog:openFile'],
      ['fs:readFile', 'cap-document'],
      ['fs:writeFile', { documentId: 'cap-document', content: 'x' }],
      ['dialog:saveFile', { name: 'x.md', content: 'x' }],
      ['settings:get'],
      ['settings:set', { theme: 'ink' }],
    ]);
  });

  test('onCloseRequested subscribes and invokes the callback without exposing the event', () => {
    const cb = vi.fn();
    getApi().onCloseRequested(cb);
    const call = mockElectron.ipcRenderer.on.mock.calls.find(c => c[0] === 'app:request-close');
    call[1]({ sender: 'private' });
    expect(cb).toHaveBeenCalledWith();
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
// src/main/index.js holds `allowedFolders` as a Set mutated by dialog:openFolder and read
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

describe('src/main/index.js — IPC concurrency (audit #9)', () => {
  let mockElectron;
  let openFolderHandler;
  let readVaultHandler;

  beforeAll(async () => {
    mockElectron = buildMockElectron();
    const mockFs = buildMockFs();

    bootstrap({ electron: mockElectron, fs: mockFs, proc: buildMockProc(['node', 'src/main/index.js']) });
    await new Promise(r => setTimeout(r, 50));

    openFolderHandler = mockElectron.ipcMain.handle.mock.calls
      .find(c => c[0] === 'dialog:openFolder')[1];
    readVaultHandler = mockElectron.ipcMain.handle.mock.calls
      .find(c => c[0] === 'fs:readVault')[1];
  });

  test('parallel dialog:openFolder calls issue distinct opaque capabilities', async () => {
    let n = 0;
    mockElectron.dialog.showOpenDialog.mockImplementation(() =>
      Promise.resolve({ canceled: false, filePaths: [`/parallel-vault-${++n}`] })
    );

    const [a, b] = await Promise.all([openFolderHandler(), openFolderHandler()]);
    expect([a, b]).toMatchObject([{ canceled: false }, { canceled: false }]);
    expect([a.vault.name, b.vault.name].sort()).toEqual(['parallel-vault-1', 'parallel-vault-2']);
    expect(a.vault.id).not.toBe(b.vault.id);

    // Both paths must now pass the allowlist check.
    const r1 = await readVaultHandler({}, a.vault.id);
    const r2 = await readVaultHandler({}, b.vault.id);
    expect([r1, r2].some(r => Array.isArray(r.entries))).toBe(true);
    expect([r1, r2].every(r => Array.isArray(r.entries) || r.error === 'stale-read')).toBe(true);
  });

  test('cancelled openFolder does NOT pollute allowedFolders', async () => {
    mockElectron.dialog.showOpenDialog.mockResolvedValueOnce({
      canceled: true,
      filePaths: [],
    });
    const r = await openFolderHandler();
    expect(r).toEqual({ canceled: true });

    // A path that was never added must remain unauthorised.
    expect(await readVaultHandler({}, '/never-added-vault')).toMatchObject({
      error: 'unauthorized-capability',
    });
  });

  test('parallel reads allow only the newest generation to commit active state', async () => {
    mockElectron.dialog.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: ['/concurrent-vault'],
    });
    const picked = await openFolderHandler();

    const results = await Promise.all(
      Array.from({ length: 10 }, () => readVaultHandler({}, picked.vault.id))
    );
    expect(results.filter(r => Array.isArray(r.entries))).toHaveLength(1);
    expect(results.filter(r => r.error === 'stale-read')).toHaveLength(9);
  });

  test('a raw path racing with picker completion never becomes authority', async () => {
    mockElectron.dialog.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: ['/race-vault'],
    });

    const [openResult, readResult] = await Promise.all([
      openFolderHandler(),
      readVaultHandler({}, '/race-vault'),
    ]);

    expect(openResult).toMatchObject({ canceled: false, vault: { name: 'race-vault' } });

    // readResult is one of:
    //   1. [] (run after openFolder finished its Set.add)
    //   2. { error: 'unauthorized-path' } (run before)
    // Anything else = race-condition bug.
    expect(readResult).toEqual({ error: 'unauthorized-capability' });
  });

  test('readVault rejects unauthorised path even under load', async () => {
    let n = 0;
    mockElectron.dialog.showOpenDialog.mockImplementation(() =>
      Promise.resolve({ canceled: false, filePaths: [`/load-vault-${++n}`] })
    );
    await Promise.all(Array.from({ length: 5 }, () => openFolderHandler()));

    expect(await readVaultHandler({}, '/totally-not-allowed')).toMatchObject({
      error: 'unauthorized-capability',
    });
  });
});

// ── HANDLER BEHAVIOUR (audit #1) ───────────────────────────────────────────
// Covers the previously-uncovered branches of src/main/index.js handlers and
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

describe('src/main/index.js — handler behaviour (audit #1)', () => {
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
  const vaultIds = new Map();

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

    mockProc = buildMockProc(['node', 'src/main/index.js']);
    bootstrap({ electron: mockElectron, fs: mockFs, proc: mockProc });
    await new Promise(r => setTimeout(r, 50));

    const invokeOpenFolder = getHandle('dialog:openFolder');
    const invokeReadVault = getHandle('fs:readVault');
    openFolder = async () => {
      const result = await invokeOpenFolder();
      if (result.vault) vaultIds.set(`/${result.vault.name}`, result.vault.id);
      return result;
    };
    readVault = async (event, idOrPath) => {
      const result = await invokeReadVault(event, vaultIds.get(idOrPath) || idOrPath);
      return result && Array.isArray(result.entries) && !result.truncated ? result.entries : result;
    };
    editCmd = getOn('edit:command');
    logError = getOn('log:error');
    winClose = getOn('window-close-confirmed');
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
  test('dialog:openFolder returns canceled without leaking a path when user cancels', async () => {
    mockElectron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    const r = await openFolder();
    expect(r).toEqual({ canceled: true });
  });

  test('dialog:openFolder returns canceled when filePaths is empty array', async () => {
    mockElectron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [] });
    const r = await openFolder();
    expect(r).toEqual({ canceled: true });
  });

  // ─ fs:readVault validation ──────────────────────────────────────────
  test('readVault rejects invalid capability IDs', async () => {
    expect(await readVault({}, 123)).toEqual({ error: 'unauthorized-capability' });
    expect(await readVault({}, null)).toEqual({ error: 'unauthorized-capability' });
    expect(await readVault({}, '')).toEqual({ error: 'unauthorized-capability' });
  });

  test('readVault treats a raw Windows UNC path as a forged capability', async () => {
    expect(await readVault({}, '\\\\server\\share')).toEqual({ error: 'unauthorized-capability' });
  });

  test('readVault treats a raw POSIX network path as a forged capability', async () => {
    expect(await readVault({}, '//server/share')).toEqual({ error: 'unauthorized-capability' });
  });

  test('readVault truncates deterministically at exactly 5000 Markdown files', async () => {
    mockElectron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/big-vault'] });
    await openFolder();
    const tooMany = Array.from({ length: 5001 }, (_, i) => ({
      name: `f${i}.md`, isFile: () => true, isSymbolicLink: () => false,
    }));
    mockFs.promises.readdir.mockResolvedValueOnce(tooMany);
    const result = await readVault({}, '/big-vault');
    expect(result.truncated).toBe(true);
    expect(result.entries).toHaveLength(5000);
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

  test('readVault returns an explicit truncated partial scan when cumulative size exceeds 100 MiB', async () => {
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
    expect(r.truncated).toBe(true);
    expect(Array.isArray(r.entries)).toBe(true);
    expect(r.entries).toHaveLength(11);
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
    mockFs.readFileSync.mockReturnValueOnce('﻿# title');

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
  test('window-close-confirmed calls win.close', () => {
    mockElectron._mockWin.close.mockClear();
    winClose({ sender: mockElectron._mockWin.webContents });
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
// Covers the remaining uncovered branches in src/main/index.js:
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

describe('src/main/index.js — lifecycle + file-association + log rotation (audit #1)', () => {
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
    mockProc = buildMockProc(['node', 'src/main/index.js', 'pending.md']);

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
    mockAppListeners['second-instance']({}, ['node', 'src/main/index.js']);
    expect(win.restore).toHaveBeenCalled();
    expect(win.focus).toHaveBeenCalled();
  });

  test('app.on("second-instance") with file arg in argv delivers the file', () => {
    const win = mockElectron._mockWin;
    win.webContents.send.mockClear();
    win.isMinimized.mockReturnValueOnce(false);
    mockElectron.BrowserWindow.getAllWindows.mockReturnValueOnce([win]);
    // realpathSync returns the path as-is; statSync says it's a 100-byte file.
    mockAppListeners['second-instance']({}, ['node', 'src/main/index.js', 'second.md']);
    expect(win.webContents.send).toHaveBeenCalledWith(
      'open-external-file',
      expect.objectContaining({ name: 'second.md' })
    );
  });

  test('app.on("second-instance") with no windows is a no-op', () => {
    mockElectron.BrowserWindow.getAllWindows.mockReturnValueOnce([]);
    expect(() => mockAppListeners['second-instance']({}, ['node', 'src/main/index.js'])).not.toThrow();
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
// src/main/index.js registers webContents.on('context-menu', …) and pops up a native
// role-based menu (undo/redo/cut/copy/paste/selectAll) gated by params.
describe('src/main/index.js — right-click context menu', () => {
  let mockElectron;
  let ctxHandler;

  beforeAll(async () => {
    mockElectron = buildMockElectron();
    // Capture the context-menu listener so we can invoke it directly.
    mockElectron._mockWin.webContents.on.mockImplementation((event, fn) => {
      if (event === 'context-menu') ctxHandler = fn;
    });

    bootstrap({ electron: mockElectron, fs: buildMockFs(), proc: buildMockProc(['node', 'src/main/index.js']) });
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

  test('non-editable, no selection → menu shown with Select All (Copy disabled)', () => {
    mockElectron.Menu.buildFromTemplate.mockClear();
    mockElectron.Menu._popup.mockClear();
    ctxHandler({}, { isEditable: false, selectionText: '   ', editFlags: { canSelectAll: true } });
    expect(mockElectron.Menu.buildFromTemplate).toHaveBeenCalledTimes(1);
    const tpl = mockElectron.Menu.buildFromTemplate.mock.calls[0][0];
    const byRole = Object.fromEntries(tpl.filter(i => i.role).map(i => [i.role, i.enabled]));
    expect(byRole.copy).toBe(false);
    expect(byRole.selectAll).toBe(true);
    expect(mockElectron.Menu._popup).toHaveBeenCalledTimes(1);
  });
});
