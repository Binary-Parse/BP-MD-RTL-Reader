import { beforeEach, describe, expect, test, vi } from 'vitest';
import { bootstrap } from '../../src/main/index.js';
import { buildMockElectron, buildMockFs, buildMockProc } from './main-harness.js';

describe('window close protocol and global control listeners', () => {
  let electron;
  let boot;

  beforeEach(async () => {
    electron = buildMockElectron();
    electron.BrowserWindow.fromWebContents = vi.fn(() => electron._mockWin);
    boot = bootstrap({ electron, fs: buildMockFs(), proc: buildMockProc(['node', 'src/main/index.js']) });
    await new Promise(resolve => setTimeout(resolve, 20));
  });

  test('window-control IPC listeners are registered once even when a window is recreated', () => {
    boot.createWindow();
    for (const channel of ['window-close-confirmed', 'window-minimize', 'window-maximize']) {
      expect(electron.ipcMain.on.mock.calls.filter(call => call[0] === channel)).toHaveLength(1);
    }
  });

  test('a native close is prevented until the renderer confirms dirty-state handling', () => {
    const closeListener = electron._mockWin.on.mock.calls.find(call => call[0] === 'close')?.[1];
    const event = { preventDefault: vi.fn() };
    closeListener(event);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(electron._mockWin.webContents.send).toHaveBeenCalledWith('app:request-close');

    const confirm = electron.ipcMain.on.mock.calls.find(call => call[0] === 'window-close-confirmed')?.[1];
    confirm({ sender: electron._mockWin.webContents });
    expect(electron._mockWin.close).toHaveBeenCalledTimes(1);
  });
});
