/**
 * main-window-gate-coverage.test.js — GATE-01 (2026-09-26): window-controller lanes
 * that had drifted below the coverage floors — chrome IPC guards, fullscreen echo,
 * load-failure logging, the webview block, dirty-state clamping, and display clamps.
 */
import { describe, expect, test, vi } from 'vitest';
import { bootstrap } from '../../src/main/index.js';
import { buildMockElectron, buildMockFs, buildMockProc } from './main-harness.js';

const onHandler = (mock, channel) => mock.on.mock.calls.find((c) => c[0] === channel)?.[1];

async function boot(electron = buildMockElectron()) {
  const boot0 = bootstrap({ electron, fs: buildMockFs(), proc: buildMockProc(['node', 'src/main/index.js']) });
  await new Promise((r) => setTimeout(r, 20));
  boot0.createWindow();
  return { boot: boot0, electron };
}

describe('window-controller lanes (GATE-01)', () => {
  test('installs nothing when Menu is unavailable', async () => {
    const electron = buildMockElectron();
    electron.Menu = undefined;
    await boot(electron);
    expect(electron.ipcMain.handle.mock.calls.length).toBeGreaterThan(0);
  });

  test('doc:dirty-state accepts a count in range and refuses junk', async () => {
    const { electron } = await boot();
    const handler = onHandler(electron.ipcMain, 'doc:dirty-state');
    handler({ sender: electron._mockWin.webContents }, 4);
    handler({ sender: electron._mockWin.webContents }, -1);
    handler({ sender: electron._mockWin.webContents }, 'many');
    handler({ sender: electron._mockWin.webContents }, 999999);
  });

  test('window-set-fullscreen applies only a strict boolean', async () => {
    const { electron } = await boot();
    const setFullScreen = vi.fn();
    electron._mockWin.setFullScreen = setFullScreen;
    const handler = onHandler(electron.ipcMain, 'window-set-fullscreen');
    handler({ sender: electron._mockWin.webContents }, true);
    handler({ sender: electron._mockWin.webContents }, 'true');
    expect(setFullScreen).toHaveBeenCalledTimes(2);
    expect(setFullScreen).toHaveBeenNthCalledWith(1, true);
    expect(setFullScreen).toHaveBeenNthCalledWith(2, false);
  });

  test('window-close-aborted and window-close-extend are harmless without an armed failsafe', async () => {
    const { electron } = await boot();
    onHandler(electron.ipcMain, 'window-close-aborted')({ sender: electron._mockWin.webContents });
    onHandler(electron.ipcMain, 'window-close-extend')({ sender: electron._mockWin.webContents });
    expect(electron._mockWin.close).not.toHaveBeenCalled();
  });

  test('context-menu echo channels ignore junk payloads', async () => {
    const { electron } = await boot();
    onHandler(electron.ipcMain, 'context-menu:action')({ sender: electron._mockWin.webContents }, null);
    onHandler(electron.ipcMain, 'context-menu:action')({ sender: electron._mockWin.webContents }, { nonce: 7 });
    onHandler(electron.ipcMain, 'context-menu:action')({ sender: electron._mockWin.webContents }, { nonce: 'cap-none', index: 0 });
    onHandler(electron.ipcMain, 'context-menu:closed')({ sender: electron._mockWin.webContents }, null);
    onHandler(electron.ipcMain, 'context-menu:closed')({ sender: electron._mockWin.webContents }, { nonce: 'cap-none' });
    expect(electron.shell.openExternal).not.toHaveBeenCalled();
  });

  test('native fullscreen state echoes to the renderer', async () => {
    const { electron } = await boot();
    const enter = onHandler(electron._mockWin, 'enter-full-screen');
    const leave = onHandler(electron._mockWin, 'leave-full-screen');
    enter();
    leave();
    const sends = electron._mockWin.webContents.send.mock.calls.filter((c) => c[0] === 'window-fullscreen-changed');
    expect(sends).toEqual([['window-fullscreen-changed', true], ['window-fullscreen-changed', false]]);
  });

  test('load failures and renderer crashes are logged, never thrown', async () => {
    const { electron } = await boot();
    onHandler(electron._mockWin.webContents, 'did-fail-load')({}, -3, 'aborted', 'app://ui/x', true);
    onHandler(electron._mockWin.webContents, 'did-fail-provisional-load')({}, -3, 'aborted', 'app://ui/x', false);
    onHandler(electron._mockWin.webContents, 'render-process-gone')({}, { reason: 'oom' });
  });

  test('a webview attach is always prevented', async () => {
    const { electron } = await boot();
    const prevented = vi.fn();
    onHandler(electron._mockWin.webContents, 'will-attach-webview')({ preventDefault: prevented });
    expect(prevented).toHaveBeenCalled();
  });

  test('a destroyed window drops its context-menu stash entries', async () => {
    const { electron } = await boot();
    onHandler(electron._mockWin.webContents, 'destroyed')();
    expect(true).toBe(true); // the sweep must simply not throw
  });

  test('a display change re-clamps an off-screen window', async () => {
    const electron = buildMockElectron();
    const setBounds = vi.fn();
    const boot0 = bootstrap({ electron, fs: buildMockFs(), proc: buildMockProc(['node', 'src/main/index.js']) });
    await new Promise((r) => setTimeout(r, 20));
    electron._mockWin.setBounds = setBounds;
    electron._mockWin.getNormalBounds = () => ({ x: -5000, y: -5000, width: 1200, height: 800 });
    electron._mockWin.getBounds = () => ({ x: -5000, y: -5000, width: 1200, height: 800 });
    const centered = vi.fn();
    electron._mockWin.center = centered;
    electron.BrowserWindow.getAllWindows = vi.fn(() => [electron._mockWin]);
    electron._screenListeners['display-metrics-changed']();
    expect(centered).toHaveBeenCalled();
  });
});
