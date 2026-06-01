/**
 * main-writefile.test.js — T-B1 fs:writeFile IPC handler (via bootstrap seam).
 */
import { describe, test, expect, beforeEach } from 'vitest';
import path from 'node:path';
import { bootstrap } from '../../main.js';
import { buildMockElectron, buildMockFs, buildMockProc } from './main-harness.js';

function getHandle(mockElectron, name) {
  return mockElectron.ipcMain.handle.mock.calls.find((c) => c[0] === name)?.[1];
}

describe('fs:writeFile (T-B1)', () => {
  let el, fsMock, writeFile, openFolder;

  beforeEach(async () => {
    el = buildMockElectron();
    // capture ipc handlers
    const handlers = {};
    el.ipcMain.handle.mockImplementation((n, fn) => { handlers[n] = fn; });
    const files = {};
    fsMock = buildMockFs({
      existsSync: (p) => p in files,
      readFileSync: (p) => files[p],
      writeFileSync: (p, c) => { files[p] = c; },
      renameSync: (a, b) => { files[b] = files[a]; delete files[a]; },
    });
    fsMock._files = files;
    el.dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: ['/vault'] }));
    bootstrap({ electron: el, fs: fsMock, proc: buildMockProc(['node', 'main.js']) });
    await new Promise((r) => setTimeout(r, 30));
    writeFile = getHandle(el, 'fs:writeFile');
    openFolder = getHandle(el, 'dialog:openFolder');
  });

  test('rejects unauthorized folder', async () => {
    expect(await writeFile({}, { folderPath: '/nope', relPath: 'a.md', content: 'x' }))
      .toEqual({ error: 'unauthorized-path' });
  });

  test('rejects invalid payloads', async () => {
    expect(await writeFile({}, null)).toEqual({ error: 'invalid' });
    expect(await writeFile({}, { folderPath: '/v', relPath: 1, content: 'x' })).toEqual({ error: 'invalid' });
  });

  test('rejects network path', async () => {
    expect(await writeFile({}, { folderPath: '\\\\srv\\s', relPath: 'a.md', content: 'x' }))
      .toEqual({ error: 'network-path-not-allowed' });
  });

  test('writes to disk once folder authorized (atomic via store)', async () => {
    await openFolder();                       // authorizes /vault
    const r = await writeFile({}, { folderPath: '/vault', relPath: 'note.md', content: 'hello', eol: '\n' });
    expect(r.ok).toBe(true);
    // OS-independent: the store writes to the path.join'd key (backslashes on Windows).
    expect(fsMock._files[path.join('/vault', 'note.md')]).toBe('hello\n');
  });

  test('rejects traversal outside the authorized root (EC-A4)', async () => {
    await openFolder();
    const r = await writeFile({}, { folderPath: '/vault', relPath: '../escape.md', content: 'x' });
    expect(r).toEqual({ error: 'unauthorized-path' });
  });
});

describe('fs:readVault recursion (T-B2) + writeFile invalid folder', () => {
  test('descends subdirectories returning relPaths', async () => {
    const el = buildMockElectron();
    const handlers = {};
    el.ipcMain.handle.mockImplementation((n, fn) => { handlers[n] = fn; });
    const dirent = (name, kind) => ({ name, isFile: () => kind === 'f', isSymbolicLink: () => false, isDirectory: () => kind === 'd' });
    const fsMock = buildMockFs();
    fsMock.promises.readdir = (async (p) => {
      if (p === '/vault') return [dirent('top.md', 'f'), dirent('sub', 'd')];
      if (p.endsWith('sub')) return [dirent('inner.md', 'f')];
      return [];
    });
    fsMock.promises.lstat = (async () => ({ isSymbolicLink: () => false, size: 10 }));
    fsMock.promises.readFile = (async () => 'content');
    el.dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: ['/vault'] }));
    bootstrap({ electron: el, fs: fsMock, proc: buildMockProc(['node', 'main.js']) });
    await new Promise((r) => setTimeout(r, 30));
    await handlers['dialog:openFolder']();
    const res = await handlers['fs:readVault']({}, '/vault');
    expect(res.map(r => r.relPath).sort()).toEqual(['sub/inner.md', 'top.md']);
  });

  test('writeFile rejects empty folderPath', async () => {
    const el = buildMockElectron();
    const handlers = {};
    el.ipcMain.handle.mockImplementation((n, fn) => { handlers[n] = fn; });
    bootstrap({ electron: el, fs: buildMockFs(), proc: buildMockProc(['node', 'main.js']) });
    await new Promise((r) => setTimeout(r, 30));
    expect(await handlers['fs:writeFile']({}, { folderPath: '', relPath: 'a.md', content: 'x' }))
      .toEqual({ error: 'invalid' });
  });
});
