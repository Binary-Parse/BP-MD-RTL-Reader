/**
 * main-ipc-gate-coverage.test.js — GATE-01 (2026-09-26): the ipc-controller branches
 * that had drifted below the coverage floors — picker refusal lanes, vault-walk skip
 * lanes, reopen re-pins, payload guards, and the update handlers' refusal/parse paths.
 * Drives the real bootstrap through the shared harness.
 */
import { describe, expect, test, vi } from 'vitest';
import path from 'node:path';
import { bootstrap } from '../../src/main/index.js';
import { buildMockElectron, buildMockFs, buildMockProc } from './main-harness.js';

const h = (electron, name) => electron.ipcMain.handle.mock.calls.find((c) => c[0] === name)?.[1];

function statFs(over = {}) {
  return buildMockFs({
    realpathSync: vi.fn((p) => p),
    statSync: vi.fn((p) => (/\.(md|markdown)$/i.test(p)
      ? { isFile: () => true, isDirectory: () => false, size: /big/.test(p) ? 5 * 1024 * 1024 * 1024 : 12, mtimeMs: 10 }
      : { isFile: () => false, isDirectory: () => true, size: 0, mtimeMs: 10 })),
    readFileSync: vi.fn(() => '# note'),
    existsSync: vi.fn((p) => /\.(md|markdown)$/i.test(p)),
    ...over,
  });
}

async function boot(fs, electron = buildMockElectron(), fetchFn) {
  bootstrap({ electron, fs, proc: buildMockProc(['node', 'src/main/index.js']), fetchFn });
  await new Promise((r) => setTimeout(r, 20));
  return electron;
}

describe('ipc-controller refusal lanes (GATE-01)', () => {
  test('dialog:openFile refuses non-markdown, oversized, and network picks', async () => {
    const el = await boot(statFs());
    el.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/v/a.txt'] });
    expect(await h(el, 'dialog:openFile')()).toEqual({ error: 'invalid-file' });
    el.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/v/big.md'] });
    expect(await h(el, 'dialog:openFile')()).toEqual({ error: 'file-too-large' });
    el.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['//srv/share/a.md'] });
    expect(await h(el, 'dialog:openFile')()).toEqual({ error: 'network-path-not-allowed' });
    el.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    expect(await h(el, 'dialog:openFile')()).toEqual({ canceled: true });
  });

  test('dialog:openFolder degrades a bad picker result to invalid-vault', async () => {
    const el = await boot(statFs({ statSync: vi.fn(() => { throw new Error('x'); }) }));
    el.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/nope'] });
    expect(await h(el, 'dialog:openFolder')()).toEqual({ error: 'invalid-vault' });
    el.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['//srv/share'] });
    expect(await h(el, 'dialog:openFolder')()).toEqual({ error: 'network-path-not-allowed' });
  });

  test('fs:readFile degrades an unreadable path to read-failed', async () => {
    const el = await boot(statFs({ realpathSync: vi.fn(() => { throw new Error('gone'); }) }));
    el.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/v/a.md'] });
    const opened = await h(el, 'dialog:openFile')();
    expect(opened.error).toBe('read-failed');
  });

  test('fs:writeFile payload guards: non-string and oversized content', async () => {
    const el = await boot(statFs());
    expect(await h(el, 'fs:writeFile')({}, null)).toEqual({ error: 'invalid' });
    expect(await h(el, 'fs:writeFile')({}, { documentId: 'x', content: 7 })).toEqual({ error: 'invalid' });
    expect(await h(el, 'fs:writeFile')({}, { documentId: 'x', content: 'y'.repeat(10 * 1024 * 1024 + 1) }))
      .toEqual({ error: 'file-too-large' });
    expect(await h(el, 'fs:writeFile')({}, { documentId: 'nope', content: 'x' }))
      .toEqual({ error: 'unauthorized-capability' });
  });

  test('the vault walk skips special files, walks subdirectories, and reports skips', async () => {
    const fs = statFs({
      promises: {
        ...buildMockFs().promises,
        readdir: vi.fn(async (rawDir) => { const dir = String(rawDir).split(path.sep).join('/'); return dir === '/v'
          ? [
            { name: 'a.md', isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false },
            { name: 'weird', isFile: () => false, isDirectory: () => false, isSymbolicLink: () => true },
            { name: 'sub', isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false },
          ]
          : dir === '/v/sub'
            ? [{ name: 'b.md', isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false }]
            : []; }),
        lstat: vi.fn(async (p) => ({
          isSymbolicLink: () => false,
          isFile: () => p.endsWith('.md'),
          size: p.endsWith('.md') ? 4 : 0,
        })),
      },
    });
    const el = await boot(fs);
    el.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/v'] });
    const picked = await h(el, 'dialog:openFolder')();
    const read = await h(el, 'fs:readVault')({ sender: el._mockWin.webContents }, picked.vault.id);
    expect(read.entries.map((e) => e.relPath).sort()).toEqual(['a.md', 'sub/b.md']);
    expect(read.entries.some((e) => e.relPath.includes('weird'))).toBe(false);
  });

  test('fs:reopenVault follows a moved folder, and refuses an unknown one', async () => {
    let moved = false;
    const files = {};
    const fs = statFs({
      realpathSync: vi.fn((p) => (moved && p === '/v' ? '/v2' : p)),
      writeFileSync: vi.fn((p, c) => { files[p] = c; }),
      renameSync: vi.fn((a, b) => { files[b] = files[a]; delete files[a]; }),
    });
    const el = await boot(fs);
    el.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/v'] });
    const picked = await h(el, 'dialog:openFolder')();
    await h(el, 'fs:closeVault')({}, picked.vault.id);
    moved = true;
    expect(await h(el, 'fs:reopenVault')({}, picked.vault.id)).toMatchObject({ ok: true, name: 'v2' });
    const el2 = await boot(statFs());
    expect(await h(el2, 'fs:reopenVault')({}, 'cap-none')).toEqual({ error: 'unknown-vault' });
  });

  test('fs:reopenDocument re-pins a vault document that moved INSIDE its root', async () => {
    let moved = false;
    const files = {};
    const fs = statFs({
      realpathSync: vi.fn((p) => (moved && p === '/v/a.md' ? '/v/b.md' : p)),
      writeFileSync: vi.fn((p, c) => { files[p] = c; }),
      renameSync: vi.fn((a, b) => { files[b] = files[a]; delete files[a]; }),
      promises: {
        ...buildMockFs().promises,
        readdir: vi.fn(async (rawDir) => { const dir = String(rawDir).split(path.sep).join('/'); return dir === '/v'
          ? [{ name: 'a.md', isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false }]
          : []; }),
        lstat: vi.fn(async () => ({ isSymbolicLink: () => false, isFile: () => true, size: 1 })),
      },
    });
    const el = await boot(fs);
    el.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/v'] });
    const picked = await h(el, 'dialog:openFolder')();
    const read = await h(el, 'fs:readVault')({ sender: el._mockWin.webContents }, picked.vault.id);
    const docId = read.entries[0].documentId;
    await h(el, 'fs:closeVault')({}, picked.vault.id);
    moved = true;
    expect(await h(el, 'fs:reopenDocument')({}, docId)).toEqual({ ok: true });
    expect(await h(el, 'fs:readFile')({}, docId)).toMatchObject({ documentId: docId });
  });

  test('app:version serves the electron version; update handlers refuse cleanly', async () => {
    const offline = () => Promise.reject(new Error('offline'));
    const el = await boot(statFs(), buildMockElectron(), offline);
    expect(await h(el, 'app:version')()).toBe('1.0.0');
    expect(await h(el, 'update:auto-check')()).toEqual({ checked: false });
    expect(await h(el, 'update:check')()).toMatchObject({ error: expect.any(String) });
    el.shell.openExternal.mockRejectedValueOnce(new Error('x'));
    expect(await h(el, 'update:release-page')()).toEqual({ error: 'open-failed' });
    el.shell.openExternal.mockResolvedValueOnce(undefined);
    expect(await h(el, 'update:release-page')()).toEqual({ ok: true });
  });

  test('recovery lanes: an invalid snapshot payload is refused; pop/clear survive emptiness', async () => {
    const el = await boot(statFs());
    expect(await h(el, 'recovery:snapshot')({}, 'nope')).toEqual({ error: 'invalid' });
    expect(await h(el, 'recovery:pop')()).toMatchObject({ files: [] });
    expect(await h(el, 'recovery:clear')()).toMatchObject({ ok: true });
  });
});
