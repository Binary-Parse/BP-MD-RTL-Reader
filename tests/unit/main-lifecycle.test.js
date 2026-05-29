/**
 * main-lifecycle.test.js — mutation-killing assertions for the App-lifecycle
 * cluster of main.js (audit follow-up): the single-instance lock branch
 * (~L274-307), the app.on lifecycle listeners (second-instance, activate,
 * open-file, window-all-closed), and the bootstrap return object (~L313).
 *
 * These tests are STRICTER than the line-coverage tests in main.vitest.test.js:
 * each assertion pins an EXACT observable value on BOTH the true and false
 * side of every branch, so a mutated value / flipped operator / removed call
 * makes a concrete assertion FAIL (kills the mutant) rather than merely being
 * executed.
 *
 * Driving pattern (per the existing seam): call bootstrap({ electron, fs, proc })
 * with app.on.mockImplementation recording listeners into a map, await a 50ms
 * tick so app.whenReady().then(createWindow) runs, then invoke each captured
 * listener and assert.
 */

import { describe, test, expect, vi, beforeAll } from 'vitest';
import { bootstrap } from '../../main.js';
import { buildMockElectron, buildMockFs, buildMockProc } from './main-harness.js';

// Wire bootstrap with a fresh harness, recording app.on listeners into a map.
// Returns { electron, fs, proc, listeners, ret } so each test can drive a
// lifecycle handler in isolation. `lockResult` toggles requestSingleInstanceLock.
async function drive({ argv = ['node', 'main.js'], lockResult = true, platform } = {}) {
  const electron = buildMockElectron();
  electron.app.requestSingleInstanceLock = vi.fn(() => lockResult);

  const listeners = {};
  electron.app.on.mockImplementation((event, fn) => { listeners[event] = fn; });

  const fs = buildMockFs();
  const proc = buildMockProc(argv);
  if (platform) proc.platform = platform;

  const ret = bootstrap({ electron, fs, proc });
  await new Promise(r => setTimeout(r, 50));

  return { electron, fs, proc, listeners, ret };
}

// ── SINGLE-INSTANCE LOCK (L274-307) ─────────────────────────────────────────
describe('main.js lifecycle — single-instance lock', () => {
  test('lock granted (true): app.quit NOT called; whenReady ran createWindow', async () => {
    const { electron } = await drive({ lockResult: true });
    expect(electron.app.requestSingleInstanceLock).toHaveBeenCalledTimes(1);
    // gotLock true → the else branch runs → app.quit must NOT be called here.
    expect(electron.app.quit).not.toHaveBeenCalled();
    // whenReady().then() continuation ran createWindow → BrowserWindow built once.
    expect(electron.BrowserWindow).toHaveBeenCalledTimes(1);
    expect(electron._mockWin.loadFile).toHaveBeenCalledWith('index.html');
  });

  test('lock granted (true): second-instance, window-all-closed, activate are wired', async () => {
    const { listeners } = await drive({ lockResult: true });
    expect(typeof listeners['second-instance']).toBe('function');
    expect(typeof listeners['window-all-closed']).toBe('function');
    // activate is registered only inside the whenReady continuation (post-tick).
    expect(typeof listeners['activate']).toBe('function');
  });

  test('lock denied (false): app.quit called exactly once; no whenReady wiring', async () => {
    const { electron, listeners } = await drive({ lockResult: false });
    expect(electron.app.requestSingleInstanceLock).toHaveBeenCalledTimes(1);
    // !gotLock → app.quit(). Pin the exact call count to kill the block-removal
    // mutant and the if/else swap.
    expect(electron.app.quit).toHaveBeenCalledTimes(1);
    // The else branch never ran: no second-instance listener, no createWindow,
    // app.whenReady() was never invoked, no activate listener.
    expect(listeners['second-instance']).toBeUndefined();
    expect(listeners['activate']).toBeUndefined();
    expect(electron.app.whenReady).not.toHaveBeenCalled();
    expect(electron.BrowserWindow).not.toHaveBeenCalled();
  });

  test('lock denied (false): window-all-closed is STILL registered (outside the lock if/else)', async () => {
    // window-all-closed is wired unconditionally after the if/else, so it must
    // exist regardless of lock result. This pins the structural placement.
    const { listeners } = await drive({ lockResult: false });
    expect(typeof listeners['window-all-closed']).toBe('function');
  });
});

// ── second-instance (L278-289): focus + restore + deliver ────────────────────
describe('main.js lifecycle — second-instance', () => {
  test('zero windows → returns early: no focus, no restore, no send', async () => {
    const { electron, listeners } = await drive();
    const win = electron._mockWin;
    win.focus.mockClear();
    win.restore.mockClear();
    win.webContents.send.mockClear();
    electron.BrowserWindow.getAllWindows.mockReturnValueOnce([]);

    listeners['second-instance']({}, ['node', 'main.js', 'ignored.md']);

    expect(win.focus).not.toHaveBeenCalled();
    expect(win.restore).not.toHaveBeenCalled();
    expect(win.webContents.send).not.toHaveBeenCalled();
  });

  test('minimized window → restore() called AND focus() called', async () => {
    const { electron, listeners } = await drive();
    const win = electron._mockWin;
    win.focus.mockClear();
    win.restore.mockClear();
    win.isMinimized.mockReturnValueOnce(true);
    electron.BrowserWindow.getAllWindows.mockReturnValueOnce([win]);

    listeners['second-instance']({}, ['node', 'main.js']);

    expect(win.restore).toHaveBeenCalledTimes(1);
    expect(win.focus).toHaveBeenCalledTimes(1);
  });

  test('non-minimized window → restore() NOT called, focus() STILL called', async () => {
    const { electron, listeners } = await drive();
    const win = electron._mockWin;
    win.focus.mockClear();
    win.restore.mockClear();
    win.isMinimized.mockReturnValueOnce(false);
    electron.BrowserWindow.getAllWindows.mockReturnValueOnce([win]);

    listeners['second-instance']({}, ['node', 'main.js']);

    // L283: isMinimized() false → restore must NOT fire (kills the
    // "always restore" / negated-condition mutant).
    expect(win.restore).not.toHaveBeenCalled();
    // focus is unconditional → must fire regardless of minimized state.
    expect(win.focus).toHaveBeenCalledTimes(1);
  });

  test('argv with a real .md file → delivers it via open-external-file', async () => {
    // fs.realpathSync echoes the path; statSync says it is a 100-byte file, so
    // parseFileArg('second.md') resolves to a real file and the file branch runs.
    const { electron, fs, listeners } = await drive();
    const win = electron._mockWin;
    fs.readFileSync.mockReturnValueOnce('# delivered body');
    win.isMinimized.mockReturnValueOnce(false);
    win.webContents.send.mockClear();
    electron.BrowserWindow.getAllWindows.mockReturnValueOnce([win]);

    listeners['second-instance']({}, ['node', 'main.js', 'second.md']);

    expect(win.webContents.send).toHaveBeenCalledTimes(1);
    expect(win.webContents.send).toHaveBeenCalledWith(
      'open-external-file',
      { name: 'second.md', path: 'second.md', content: '# delivered body' }
    );
  });

  test('argv with NO file (L285 false) → focus only, NO send', async () => {
    const { electron, listeners } = await drive();
    const win = electron._mockWin;
    win.focus.mockClear();
    win.isMinimized.mockReturnValueOnce(false);
    win.webContents.send.mockClear();
    electron.BrowserWindow.getAllWindows.mockReturnValueOnce([win]);

    // argv has no .md/.markdown/.txt candidate → parseFileArg returns null.
    listeners['second-instance']({}, ['node', 'main.js', '--flag', 'notafile']);

    expect(win.focus).toHaveBeenCalledTimes(1);
    // L285 `if (file)` false → no delivery (kills the "always deliver" mutant).
    expect(win.webContents.send).not.toHaveBeenCalled();
  });

  test('argv whose only candidate is NOT a real file (statSync throws) → NO send', async () => {
    const { electron, fs, listeners } = await drive();
    const win = electron._mockWin;
    win.isMinimized.mockReturnValueOnce(false);
    win.webContents.send.mockClear();
    // statSync throws → parseFileArg cannot validate the candidate → null.
    fs.statSync.mockImplementationOnce(() => { throw new Error('ENOENT'); });
    electron.BrowserWindow.getAllWindows.mockReturnValueOnce([win]);

    listeners['second-instance']({}, ['node', 'main.js', 'ghost.md']);

    expect(win.webContents.send).not.toHaveBeenCalled();
  });
});

// ── activate (L295-297) ──────────────────────────────────────────────────────
describe('main.js lifecycle — activate', () => {
  test('getAllWindows() empty → a NEW BrowserWindow is created', async () => {
    const { electron, listeners } = await drive();
    electron.BrowserWindow.getAllWindows.mockReturnValueOnce([]);
    const before = electron.BrowserWindow.mock.calls.length;

    listeners['activate']();

    expect(electron.BrowserWindow.mock.calls.length).toBe(before + 1);
  });

  test('getAllWindows() non-empty → NO new BrowserWindow', async () => {
    const { electron, listeners } = await drive();
    electron.BrowserWindow.getAllWindows.mockReturnValueOnce([electron._mockWin]);
    const before = electron.BrowserWindow.mock.calls.length;

    listeners['activate']();

    // length === 0 is false → createWindow NOT invoked (kills the
    // flipped-comparison / forced-true mutant).
    expect(electron.BrowserWindow.mock.calls.length).toBe(before);
  });
});

// ── open-file (L300-306) ─────────────────────────────────────────────────────
describe('main.js lifecycle — open-file', () => {
  test('preventDefault is ALWAYS called (even for empty path)', async () => {
    const { listeners } = await drive();
    const ev = { preventDefault: vi.fn() };

    listeners['open-file'](ev, '');

    expect(ev.preventDefault).toHaveBeenCalledTimes(1);
  });

  test('empty path (L302 true) → no delivery', async () => {
    const { electron, listeners } = await drive();
    const win = electron._mockWin;
    win.webContents.send.mockClear();
    electron.BrowserWindow.getAllWindows.mockReturnValueOnce([win]);
    const ev = { preventDefault: vi.fn() };

    listeners['open-file'](ev, '');

    expect(win.webContents.send).not.toHaveBeenCalled();
  });

  test('valid path + a window present → delivers via open-external-file', async () => {
    const { electron, fs, listeners } = await drive();
    const win = electron._mockWin;
    fs.readFileSync.mockReturnValueOnce('# from open-file');
    win.webContents.send.mockClear();
    electron.BrowserWindow.getAllWindows.mockReturnValueOnce([win]);
    const ev = { preventDefault: vi.fn() };

    listeners['open-file'](ev, '/docs/opened.md');

    expect(ev.preventDefault).toHaveBeenCalledTimes(1);
    expect(win.webContents.send).toHaveBeenCalledTimes(1);
    expect(win.webContents.send).toHaveBeenCalledWith(
      'open-external-file',
      { name: 'opened.md', path: '/docs/opened.md', content: '# from open-file' }
    );
  });

  test('valid path but NO windows (L304/305 wins.length > 0 false) → no send', async () => {
    const { electron, listeners } = await drive();
    const win = electron._mockWin;
    win.webContents.send.mockClear();
    electron.BrowserWindow.getAllWindows.mockReturnValueOnce([]);
    const ev = { preventDefault: vi.fn() };

    listeners['open-file'](ev, '/docs/opened.md');

    expect(ev.preventDefault).toHaveBeenCalledTimes(1);
    // wins.length > 0 is false → deliverPendingFile not invoked.
    expect(win.webContents.send).not.toHaveBeenCalled();
  });
});

// ── window-all-closed (L309-311) ─────────────────────────────────────────────
describe('main.js lifecycle — window-all-closed', () => {
  test('platform !== "darwin" (win32) → app.quit() called', async () => {
    const { electron, listeners } = await drive({ platform: 'win32' });
    electron.app.quit.mockClear();

    listeners['window-all-closed']();

    expect(electron.app.quit).toHaveBeenCalledTimes(1);
  });

  test('platform !== "darwin" (linux) → app.quit() called', async () => {
    const { electron, listeners } = await drive({ platform: 'linux' });
    electron.app.quit.mockClear();

    listeners['window-all-closed']();

    expect(electron.app.quit).toHaveBeenCalledTimes(1);
  });

  test('platform === "darwin" → app.quit() NOT called', async () => {
    const { electron, listeners } = await drive({ platform: 'darwin' });
    electron.app.quit.mockClear();

    listeners['window-all-closed']();

    // proc.platform !== 'darwin' is false → no quit (kills the
    // negated-condition / forced-true mutant).
    expect(electron.app.quit).not.toHaveBeenCalled();
  });
});

// ── bootstrap return object (L313) ───────────────────────────────────────────
describe('main.js lifecycle — bootstrap return object', () => {
  test('returns an object exposing createWindow and registerIpcHandlers functions', async () => {
    const { ret } = await drive();
    expect(ret).toBeTruthy();
    expect(typeof ret).toBe('object');
    expect(typeof ret.createWindow).toBe('function');
    expect(typeof ret.registerIpcHandlers).toBe('function');
  });

  test('returned createWindow builds a BrowserWindow when invoked', async () => {
    const { electron, ret } = await drive();
    const before = electron.BrowserWindow.mock.calls.length;

    const win = ret.createWindow();

    expect(electron.BrowserWindow.mock.calls.length).toBe(before + 1);
    expect(win).toBe(electron._mockWin);
  });
});
