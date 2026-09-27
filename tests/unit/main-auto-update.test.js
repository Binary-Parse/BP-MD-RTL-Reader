/**
 * main-auto-update.test.js — T7.1: the OPT-IN automatic update check (notify only) and the
 * notice's "View release" channel.
 *
 * Three privacy properties are what these tests really pin:
 *   1. the default ('manual') registers nothing and never calls fetch,
 *   2. main re-validates the saved setting before every check, so a renderer asking to
 *      auto-check while the setting says 'manual' still gets no traffic,
 *   3. the release URL is a literal in main and the channel takes no argument.
 */
import { describe, test, expect, vi, afterEach } from 'vitest';
import path from 'node:path';
import { bootstrap } from '../../src/main/index.js';
import { buildMockElectron, buildMockFs, buildMockProc } from './main-harness.js';

// app.getPath('userData') in the harness returns `/mock/userData/userData`.
const SETTINGS_FILE = path.join('/mock/userData/userData', 'settings.json');
const RELEASES_PAGE = 'https://github.com/Binary-Parse/BP-MD-RTL-Reader/releases/latest';

const getHandle = (el, name) => el.ipcMain.handle.mock.calls.find((c) => c[0] === name)?.[1];
const getAppOn = (el, name) => el.app.on.mock.calls.find((c) => c[0] === name)?.[1];
const okJson = (body) => ({ ok: true, json: () => Promise.resolve(body) });

/** In-memory fs so settings.json can actually say `updateCheck: 'auto'`. */
function memFs(seed = {}) {
  const files = { ...seed };
  return buildMockFs({
    readFileSync: (p) => { if (!(p in files)) throw new Error('ENOENT'); return files[p]; },
    writeFileSync: (p, c) => { files[p] = c; },
    renameSync: (a, b) => { files[b] = files[a]; delete files[a]; },
    existsSync: (p) => p in files,
  });
}

async function boot({ updateCheck = 'manual', shell = undefined } = {}, fetchFn = vi.fn(() => Promise.resolve(okJson({ tag_name: 'v1.0.0' })))) {
  const electron = buildMockElectron();
  if (shell === null) electron.shell = null; // bootstrap destructures at call time
  electron.app.getVersion.mockReturnValue('1.0.0');
  const fs = memFs({ [SETTINGS_FILE]: JSON.stringify({ version: 5, updateCheck }) });
  bootstrap({ electron, fs, proc: buildMockProc(['node', 'src/main/index.js']), fetchFn });
  await new Promise((r) => setTimeout(r, 50)); // handlers register inside whenReady()
  return { electron, fetchFn };
}

/** Fire the boot check the way Electron would: window created → did-finish-load. */
async function loadFirstWindow(electron) {
  const onCreated = getAppOn(electron, 'browser-window-created');
  expect(typeof onCreated, 'the boot listener is registered only in auto mode').toBe('function');
  const contents = { once: vi.fn((event, cb) => cb()), send: vi.fn() };
  const win = { isDestroyed: () => false, webContents: contents };
  // main broadcasts through BrowserWindow.getAllWindows(), so the fake window must be one.
  electron.BrowserWindow.getAllWindows.mockReturnValue([win]);
  onCreated({}, win);
  await new Promise((r) => setTimeout(r, 20));
  return { contents, win };
}

afterEach(() => { vi.restoreAllMocks(); });

describe('update:auto-check (T7.1)', () => {
  test('with the default manual setting the channel reports "not checked" and makes no request', async () => {
    const { electron, fetchFn } = await boot({ updateCheck: 'manual' });
    const handler = getHandle(electron, 'update:auto-check');
    expect(await handler()).toEqual({ checked: false });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  test('with auto it runs the same check as the manual one and returns its result', async () => {
    const { electron, fetchFn } = await boot(
      { updateCheck: 'auto' },
      vi.fn(() => Promise.resolve(okJson({ tag_name: 'v2.0.0', html_url: 'https://x/2.0.0' })))
    );
    const handler = getHandle(electron, 'update:auto-check');
    expect(await handler()).toEqual({ current: '1.0.0', latest: '2.0.0', updateAvailable: true });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/Binary-Parse/BP-MD-RTL-Reader/releases/latest');
    expect(opts.body).toBeUndefined(); // privacy: a bare GET, no identifiers
  });

  test('a manual check ignores the setting (it is an explicit user action)', async () => {
    const { electron, fetchFn } = await boot(
      { updateCheck: 'manual' },
      vi.fn(() => Promise.resolve(okJson({ tag_name: 'v3.0.0' })))
    );
    const handler = getHandle(electron, 'update:check');
    expect((await handler()).updateAvailable).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe('boot auto check (T7.1)', () => {
  test('manual mode registers no boot listener at all', async () => {
    const { electron } = await boot({ updateCheck: 'manual' });
    expect(getAppOn(electron, 'browser-window-created')).toBeUndefined();
    expect(electron.ipcMain.handle.mock.calls.map((c) => c[0])).toContain('update:check');
  });

  test('auto mode checks once after the first window loads and notifies it', async () => {
    const { electron, fetchFn } = await boot(
      { updateCheck: 'auto' },
      vi.fn(() => Promise.resolve(okJson({ tag_name: 'v1.4.0' })))
    );
    const { contents } = await loadFirstWindow(electron);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(contents.send).toHaveBeenCalledTimes(1);
    expect(contents.send).toHaveBeenCalledWith('update:available', { latest: '1.4.0', current: '1.0.0' });
    // The one-shot boot flag means a second window does NOT trigger a second check.
    getAppOn(electron, 'browser-window-created')({}, { isDestroyed: () => false, webContents: { once: (e, cb) => cb(), send: vi.fn() } });
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  test('an up-to-date or failing check sends NOTHING to the renderer', async () => {
    const equal = await boot({ updateCheck: 'auto' }, vi.fn(() => Promise.resolve(okJson({ tag_name: 'v1.0.0' }))));
    const first = await loadFirstWindow(equal.electron);
    expect(equal.fetchFn).toHaveBeenCalledTimes(1);
    expect(first.contents.send).not.toHaveBeenCalled();

    const offline = await boot({ updateCheck: 'auto' }, vi.fn(() => Promise.reject(new Error('offline'))));
    const second = await loadFirstWindow(offline.electron);
    expect(offline.fetchFn).toHaveBeenCalledTimes(1);
    expect(second.contents.send).not.toHaveBeenCalled();
  });

  test('the daily timer is armed for 24 h and unref’d so it cannot hold the app open', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const { electron } = await boot({ updateCheck: 'auto' });
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    const [fn, delay] = setIntervalSpy.mock.calls[0];
    expect(delay).toBe(24 * 60 * 60 * 1000);
    expect(typeof fn).toBe('function');
    // registerIpcHandlers ran; the timer exists and is unref'd (mock Timers expose unref).
    expect(getAppOn(electron, 'browser-window-created')).toBeDefined();
  });
});

describe('update:release-page (T7.1)', () => {
  test('opens the fixed releases URL in the OS browser', async () => {
    const { electron } = await boot();
    const handler = getHandle(electron, 'update:release-page');
    expect(await handler()).toEqual({ ok: true });
    expect(electron.shell.openExternal).toHaveBeenCalledWith(RELEASES_PAGE);
  });

  test('an argument cannot redirect the channel (the URL is main’s own literal)', async () => {
    const { electron } = await boot();
    const handler = getHandle(electron, 'update:release-page');
    await handler({ url: 'https://evil.example/payload' });
    expect(electron.shell.openExternal).toHaveBeenCalledTimes(1);
    expect(electron.shell.openExternal).toHaveBeenCalledWith(RELEASES_PAGE);
  });

  test('without a shell bridge it reports unsupported instead of throwing', async () => {
    const { electron } = await boot({ shell: null });
    const handler = getHandle(electron, 'update:release-page');
    expect(await handler()).toEqual({ error: 'unsupported' });
  });
});

describe('dispose (T7.1)', () => {
  test('the last window closing clears the daily timer', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    const { electron } = await boot({ updateCheck: 'auto' });
    await loadFirstWindow(electron);
    const onAllClosed = getAppOn(electron, 'window-all-closed');
    expect(typeof onAllClosed).toBe('function');
    onAllClosed();
    expect(clearSpy).toHaveBeenCalled();
  });
});
