import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);

describe('ARCH-001 main-process controller boundaries', () => {
  test('exposes an injectable IPC registration boundary', () => {
    const { createIpcController } = require('../../src/main/ipc-controller');
    expect(typeof createIpcController).toBe('function');
  });

  test('exposes an injectable BrowserWindow lifecycle boundary', () => {
    const { createWindowController } = require('../../src/main/window-controller');
    expect(typeof createWindowController).toBe('function');
  });

  test('keeps bootstrap composition narrow and privileged wiring in its controllers', () => {
    const main = readFileSync('src/main/index.js', 'utf8');
    const ipc = readFileSync('src/main/ipc-controller.js', 'utf8');
    const window = readFileSync('src/main/window-controller.js', 'utf8');
    expect(main.split(/\r?\n/).length).toBeLessThan(350);
    expect(main).toContain('createIpcController({');
    expect(main).toContain('createWindowController({');
    expect(main).not.toContain('ipcMain.handle(');
    expect(ipc).toContain("ipcMain.handle('fs:readVault'");
    expect(ipc).toContain("ipcMain.handle('export:pdf'");
    expect(window).toContain('new BrowserWindow({');
    expect(window).toContain("win.webContents.on('will-navigate'");
  });
});
