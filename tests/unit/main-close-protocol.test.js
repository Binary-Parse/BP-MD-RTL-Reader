import { beforeEach, describe, expect, test, vi } from 'vitest';
import { bootstrap } from '../../src/main/index.js';
import { buildMockElectron, buildMockFs, buildMockProc } from './main-harness.js';
import { setupBridge } from '../../src/preload/index.js';

describe('window close protocol and global control listeners', () => {
  let electron;
  let fs;
  let boot;

  beforeEach(async () => {
    electron = buildMockElectron();
    electron.BrowserWindow.fromWebContents = vi.fn(() => electron._mockWin);
    fs = buildMockFs();
    boot = bootstrap({ electron, fs, proc: buildMockProc(['node', 'src/main/index.js']) });
    await new Promise(resolve => setTimeout(resolve, 20));
  });

  test('window-control IPC listeners are registered once even when a window is recreated', () => {
    boot.createWindow();
    for (const channel of ['window-close-confirmed', 'window-minimize', 'window-maximize']) {
      expect(electron.ipcMain.on.mock.calls.filter(call => call[0] === channel)).toHaveLength(1);
    }
  });

  test('a native close is prevented until the renderer confirms dirty-state handling', () => {
    const loaded = electron._mockWin.webContents.on.mock.calls.find(call => call[0] === 'did-finish-load')?.[1];
    expect(typeof loaded).toBe('function');
    loaded();

    const closeListener = electron._mockWin.on.mock.calls.find(call => call[0] === 'close')?.[1];
    const event = { preventDefault: vi.fn() };
    closeListener(event);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(electron._mockWin.webContents.send).toHaveBeenCalledWith('app:request-close');
    expect(electron._mockWin.close).not.toHaveBeenCalled();

    const confirm = electron.ipcMain.on.mock.calls.find(call => call[0] === 'window-close-confirmed')?.[1];
    confirm({ sender: electron._mockWin.webContents });
    expect(electron._mockWin.close).toHaveBeenCalledTimes(1);
  });

  test('a native close proceeds without renderer confirm when the page never loaded', () => {
    const closeListener = electron._mockWin.on.mock.calls.find(call => call[0] === 'close')?.[1];
    const event = { preventDefault: vi.fn() };
    closeListener(event);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(electron._mockWin.webContents.send).not.toHaveBeenCalledWith('app:request-close');
    expect(electron._mockWin.close).toHaveBeenCalledTimes(1);
  });

  // QA-02: the ledger is diagnostic only — the failsafe still force-closes, but its log
  // line now names the last-reported dirty count so a force-close's data cost is recorded.
  test('the close failsafe logs the last-reported dirty count', () => {
    vi.useFakeTimers();
    try {
      boot.createWindow();
      const loaded = electron._mockWin.webContents.on.mock.calls.find(call => call[0] === 'did-finish-load')?.[1];
      loaded();

      const dirtyState = electron.ipcMain.on.mock.calls.find(call => call[0] === 'doc:dirty-state')?.[1];
      expect(typeof dirtyState).toBe('function');
      dirtyState({ sender: electron._mockWin.webContents }, 3);

      const closeListener = electron._mockWin.on.mock.calls.find(call => call[0] === 'close')?.[1];
      closeListener({ preventDefault: vi.fn() });
      expect(electron._mockWin.close).not.toHaveBeenCalled();

      vi.advanceTimersByTime(20000);
      expect(electron._mockWin.close).toHaveBeenCalledTimes(1);

      const lines = fs.appendFileSync.mock.calls.map((call) => String(call[1]));
      expect(lines.some((line) => line.includes('window:close-failsafe')
        && line.includes('3 unsaved file(s)'))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('window-close-extend — close-flow heartbeat', () => {
  test('a heartbeat keeps re-arming the failsafe; a renderer that stops ticking is still force-closed', async () => {
    const electron = buildMockElectron();
    electron.BrowserWindow.fromWebContents = vi.fn(() => electron._mockWin);
    const boot = bootstrap({ electron, fs: buildMockFs(), proc: buildMockProc(['node', 'src/main/index.js']) });
    await new Promise((resolve) => setTimeout(resolve, 20));
    vi.useFakeTimers();
    try {
      boot.createWindow();
      const loaded = electron._mockWin.webContents.on.mock.calls.find((c) => c[0] === 'did-finish-load')?.[1];
      loaded();
      const extend = electron.ipcMain.on.mock.calls.find((c) => c[0] === 'window-close-extend')?.[1];
      expect(typeof extend).toBe('function');

      const closeListener = electron._mockWin.on.mock.calls.find((c) => c[0] === 'close')?.[1];
      closeListener({ preventDefault: vi.fn() });
      expect(electron._mockWin.close).not.toHaveBeenCalled();

      // The close flow heartbeats every 5s — a user thinking inside a Save-As dialog is
      // never force-closed, no matter how long the dialog stays open.
      for (let i = 0; i < 12; i++) {
        vi.advanceTimersByTime(5000);
        extend({ sender: electron._mockWin.webContents });
      }
      vi.advanceTimersByTime(5000);
      expect(electron._mockWin.close).not.toHaveBeenCalled();

      // The renderer stops ticking (wedged) → the failsafe fires within one window.
      vi.advanceTimersByTime(20000);
      expect(electron._mockWin.close).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('preload bridge additions (v1.3.0)', () => {
  test('extendWindowClose sends window-close-extend; decodeBytes invokes text:decode with the bytes', async () => {
    const el = buildMockElectron();
    const exposed = {};
    el.contextBridge.exposeInMainWorld.mockImplementation((_name, api) => { Object.assign(exposed, api); });
    setupBridge({ contextBridge: el.contextBridge, ipcRenderer: el.ipcRenderer });
    exposed.extendWindowClose();
    expect(el.ipcRenderer.send).toHaveBeenCalledWith('window-close-extend');
    el.ipcRenderer.invoke.mockResolvedValueOnce({ ok: true, text: 'x' });
    await expect(exposed.decodeBytes(new Uint8Array([0x61]))).resolves.toMatchObject({ ok: true });
    expect(el.ipcRenderer.invoke).toHaveBeenCalledWith('text:decode', expect.any(Uint8Array));
  });
});
