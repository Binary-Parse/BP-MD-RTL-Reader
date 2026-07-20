/**
 * main-settings-ipc.test.js — T-F8 / B5 persistent settings wired into main.js.
 *
 * Drives the REAL code through the injectable bootstrap({ electron, fs, proc })
 * seam (same pattern as main-writefile.test.js): mock electron/fs, capture the
 * settings:get / settings:set IPC handlers, and the window-geometry restore +
 * persist-on-close/quit paths.
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';
import path from 'node:path';
import { bootstrap } from '../../main.js';
import { setupBridge } from '../../preload.js';
import { defaultSettings } from '../../src/main/settings.js';
import { buildMockElectron, buildMockFs, buildMockProc } from './main-harness.js';

// app.getPath('userData') in the harness returns `/mock/userData/userData`.
const SETTINGS_FILE = path.join('/mock/userData/userData', 'settings.json');

const getHandle = (el, name) => el.ipcMain.handle.mock.calls.find((c) => c[0] === name)?.[1];
const getIpcOn  = (el, name) => el.ipcMain.on.mock.calls.find((c) => c[0] === name)?.[1];
const getWinOn  = (el, name) => el._mockWin.on.mock.calls.find((c) => c[0] === name)?.[1];
const getAppOn  = (el, name) => el.app.on.mock.calls.find((c) => c[0] === name)?.[1];

// An fs backed by an in-memory file map (settings.json round-trips through it).
function memFs(seed = {}) {
  const files = { ...seed };
  const fs = buildMockFs({
    readFileSync: (p) => { if (!(p in files)) throw new Error('ENOENT'); return files[p]; },
    writeFileSync: (p, c) => { files[p] = c; },
    renameSync: (a, b) => { files[b] = files[a]; delete files[a]; },
    existsSync: (p) => p in files,
  });
  fs._files = files;
  return fs;
}

async function boot(fs, electron = buildMockElectron()) {
  bootstrap({ electron, fs, proc: buildMockProc(['node', 'main.js']) });
  await new Promise((r) => setTimeout(r, 30));
  return electron;
}

describe('settings:get / settings:set IPC (T-F8 / B5)', () => {
  let el, fsMock, get, set;

  beforeEach(async () => {
    fsMock = memFs();
    el = await boot(fsMock);
    get = getHandle(el, 'settings:get');
    set = getHandle(el, 'settings:set');
  });

  test('handlers are registered', () => {
    expect(typeof get).toBe('function');
    expect(typeof set).toBe('function');
  });

  test('settings:get returns defaults when no file exists', async () => {
    expect(await get()).toEqual(defaultSettings());
  });

  test('settings:set persists merged settings to disk and settings:get reflects them', async () => {
    const res = await set({}, { theme: 'ink', zoomFactor: 1.5 });
    expect(res).toEqual({ ok: true });
    // written atomically (tmp write + rename) to the settings file
    const onDisk = JSON.parse(fsMock._files[SETTINGS_FILE]);
    expect(onDisk.theme).toBe('ink');
    expect(onDisk.zoomFactor).toBe(1.5);
    // and the live handler reflects it
    const got = await get();
    expect(got.theme).toBe('ink');
    expect(got.zoomFactor).toBe(1.5);
  });

  test('settings:set rejects non-object payloads', async () => {
    expect(await set({}, null)).toEqual({ error: 'invalid' });
    expect(await set({}, 'nope')).toEqual({ error: 'invalid' });
    expect(await set({}, 42)).toEqual({ error: 'invalid' });
  });

  // L307: `if (res && res.ok) currentSettings = merged` — a FAILED save must NOT
  // update the in-memory currentSettings (so settings:get still returns the prior
  // value). Kills the forced-true / `||` / dropped-guard mutants.
  test('a FAILED save leaves currentSettings unchanged (settings:get returns the prior value)', async () => {
    // First, a successful save establishes a known theme.
    expect(await set({}, { theme: 'ink' })).toEqual({ ok: true });
    expect((await get()).theme).toBe('ink');

    // Now make the atomic write fail so settingsStore.save returns a non-ok result.
    fsMock.writeFileSync = vi.fn(() => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); });
    const res = await set({}, { theme: 'sepia' });
    expect(res.ok).not.toBe(true); // save reported failure

    // currentSettings must still hold the LAST successful value, not 'sepia'.
    expect((await get()).theme).toBe('ink');
  });

  test('settings:set sanitizes/migrates (invalid mode → default, zoom clamped, junk dropped)', async () => {
    await set({}, { editorMode: 'bogus', zoomFactor: 99, evil: true });
    const got = await get();
    expect(got.editorMode).toBe('live'); // invalid → default
    expect(got.zoomFactor).toBe(2.0);    // clamped to max
    expect('evil' in got).toBe(false);   // unknown key dropped
    expect(got.version).toBe(2);
  });

  test('settings:set merges successive partial patches', async () => {
    await set({}, { theme: 'sepia' });
    await set({}, { zoomFactor: 1.3 });
    const got = await get();
    expect(got.theme).toBe('sepia');     // survived the second patch
    expect(got.zoomFactor).toBe(1.3);
  });

  test('settings:set persists recents and panel visibility', async () => {
    await set({}, {
      sidebarVisible: false,
      inspectorVisible: false,
      recents: [{ name: 'a.md', path: 'a.md', vaultId: 'cap-v' }, { name: 'b.md', path: 'b.md', documentId: 'cap-b' }],
    });
    const got = await get();
    expect(got.sidebarVisible).toBe(false);
    expect(got.inspectorVisible).toBe(false);
    expect(got.recents).toEqual([{ name: 'a.md', path: 'a.md', vaultId: 'cap-v', documentId: null }, { name: 'b.md', path: 'b.md', vaultId: null, documentId: 'cap-b' }]);
  });
});

describe('window geometry restore on launch (EC-D2)', () => {
  test('restores saved on-screen bounds', async () => {
    const fs = memFs({ [SETTINGS_FILE]: JSON.stringify({ window: { x: 200, y: 150, w: 1000, h: 700, maximized: false } }) });
    const el = await boot(fs);
    const opts = el.BrowserWindow.mock.calls[0][0];
    expect(opts.width).toBe(1000);
    expect(opts.height).toBe(700);
    expect(opts.x).toBe(200);
    expect(opts.y).toBe(150);
    expect(el._mockWin.maximize).not.toHaveBeenCalled();
  });

  test('drops off-screen coordinates but keeps size', async () => {
    const fs = memFs({ [SETTINGS_FILE]: JSON.stringify({ window: { x: 9000, y: 9000, w: 1000, h: 700 } }) });
    const el = await boot(fs);
    const opts = el.BrowserWindow.mock.calls[0][0];
    expect(opts.x).toBeUndefined();
    expect(opts.y).toBeUndefined();
    // L433/L434: when bounds.x/y are null the `{ x } : {}` spread must contribute
    // NOTHING — the key must be ABSENT, not present-with-undefined (kills the
    // ConditionalExpression→true mutant that would always spread the key).
    expect('x' in opts).toBe(false);
    expect('y' in opts).toBe(false);
    expect(opts.width).toBe(1000);
    expect(opts.height).toBe(700);
  });

  test('restored on-screen bounds DO include x/y keys (proves the spread is conditional)', async () => {
    const fs = memFs({ [SETTINGS_FILE]: JSON.stringify({ window: { x: 100, y: 80, w: 1000, h: 700 } }) });
    const el = await boot(fs);
    const opts = el.BrowserWindow.mock.calls[0][0];
    expect('x' in opts).toBe(true);
    expect('y' in opts).toBe(true);
    expect(opts.x).toBe(100);
    expect(opts.y).toBe(80);
  });

  test('maximizes the window when saved maximized', async () => {
    const fs = memFs({ [SETTINGS_FILE]: JSON.stringify({ window: { x: 0, y: 0, w: 1000, h: 700, maximized: true } }) });
    const el = await boot(fs);
    expect(el._mockWin.maximize).toHaveBeenCalledTimes(1);
  });

  test('falls back to default 1280x820 when no settings file', async () => {
    const el = await boot(memFs());
    const opts = el.BrowserWindow.mock.calls[0][0];
    expect(opts.width).toBe(1280);
    expect(opts.height).toBe(820);
    expect(opts.x).toBeUndefined();
  });
});

describe('persist window state on close / quit', () => {
  test('window "close" writes live geometry to settings', async () => {
    const fs = memFs();
    const el = await boot(fs);
    el._mockWin.getNormalBounds.mockReturnValue({ x: 50, y: 60, width: 1100, height: 750 });
    el._mockWin.isMaximized.mockReturnValue(false);
    const onClose = getWinOn(el, 'close');
    expect(typeof onClose).toBe('function');
    const event = { preventDefault: vi.fn() };
    onClose(event);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    getIpcOn(el, 'window-close-confirmed')({ sender: el._mockWin.webContents });
    onClose(event);
    const saved = JSON.parse(fs._files[SETTINGS_FILE]).window;
    expect(saved).toEqual({ x: 50, y: 60, w: 1100, h: 750, maximized: false });
  });

  test('app "before-quit" persists the first open window', async () => {
    const fs = memFs();
    const el = await boot(fs);
    el._mockWin.getNormalBounds.mockReturnValue({ x: 11, y: 22, width: 900, height: 600 });
    el.BrowserWindow.getAllWindows.mockReturnValue([el._mockWin]);
    getAppOn(el, 'before-quit')();
    expect(JSON.parse(fs._files[SETTINGS_FILE]).window).toEqual({ x: 11, y: 22, w: 900, h: 600, maximized: false });
  });

  test('before-quit with no open windows is a silent no-op', async () => {
    const fs = memFs();
    const el = await boot(fs);
    el.BrowserWindow.getAllWindows.mockReturnValue([]);
    expect(() => getAppOn(el, 'before-quit')()).not.toThrow();
    expect(SETTINGS_FILE in fs._files).toBe(false); // nothing written
  });

  test('close on a destroyed window writes nothing', async () => {
    const fs = memFs();
    const el = await boot(fs);
    el._mockWin.isDestroyed.mockReturnValue(true);
    getWinOn(el, 'close')();
    expect(SETTINGS_FILE in fs._files).toBe(false);
  });

  test('persistence swallows errors when getNormalBounds throws', async () => {
    const fs = memFs();
    const el = await boot(fs);
    el._mockWin.getNormalBounds.mockImplementation(() => { throw new Error('boom'); });
    expect(() => getWinOn(el, 'close')()).not.toThrow();
    expect(SETTINGS_FILE in fs._files).toBe(false);
  });
});

describe('preload exposes getSettings / setSettings', () => {
  function api() {
    const el = buildMockElectron();
    setupBridge({ contextBridge: el.contextBridge, ipcRenderer: el.ipcRenderer });
    return { api: el.contextBridge.exposeInMainWorld.mock.calls[0][1], ipc: el.ipcRenderer };
  }

  test('getSettings invokes settings:get with no args', () => {
    const { api: a, ipc } = api();
    expect(typeof a.getSettings).toBe('function');
    a.getSettings();
    expect(ipc.invoke).toHaveBeenCalledWith('settings:get');
  });

  test('setSettings invokes settings:set with the patch', () => {
    const { api: a, ipc } = api();
    expect(typeof a.setSettings).toBe('function');
    a.setSettings({ theme: 'ink' });
    expect(ipc.invoke).toHaveBeenCalledWith('settings:set', { theme: 'ink' });
  });

  test('writeFile invokes fs:writeFile with the payload', () => {
    const { api: a, ipc } = api();
    const payload = { documentId: 'cap-doc', content: 'x' };
    a.writeFile(payload);
    expect(ipc.invoke).toHaveBeenCalledWith('fs:writeFile', payload);
  });

  test('saveFileAs invokes the native Save-As channel with no path authority', () => {
    const { api: a, ipc } = api();
    const payload = { suggestedName: 'n.md', content: 'x' };
    a.saveFileAs(payload);
    expect(ipc.invoke).toHaveBeenCalledWith('dialog:saveFile', payload);
  });
});
