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

  // L285: `typeof content !== 'string'` — an authorized folder + valid relPath but a
  // NON-string content must STILL be {error:'invalid'} (kills the content-guard mutant).
  test('rejects non-string content even for an authorized folder', async () => {
    await openFolder();
    expect(await writeFile({}, { folderPath: '/vault', relPath: 'a.md', content: 123 })).toEqual({ error: 'invalid' });
    expect(await writeFile({}, { folderPath: '/vault', relPath: 'a.md', content: null })).toEqual({ error: 'invalid' });
    // and nothing was written
    expect(path.join('/vault', 'a.md') in fsMock._files).toBe(false);
  });

  // L286: `folderPath === ''` — empty folderPath is invalid BEFORE any auth/network
  // check (so the result is 'invalid', never 'unauthorized-path' / 'network-...').
  test('empty folderPath is rejected as invalid (not unauthorized)', async () => {
    expect(await writeFile({}, { folderPath: '', relPath: 'a.md', content: 'x' })).toEqual({ error: 'invalid' });
  });

  // L286: a non-string folderPath is invalid too.
  test('non-string folderPath is rejected as invalid', async () => {
    expect(await writeFile({}, { folderPath: 123, relPath: 'a.md', content: 'x' })).toEqual({ error: 'invalid' });
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

// ── readVault recursion guards (T-B2) — precise mutation kills ────────────────
describe('fs:readVault recursion guard branches (mutation kills)', () => {
  const dirent = (name, kind) => ({
    name, isFile: () => kind === 'f', isSymbolicLink: () => false, isDirectory: () => kind === 'd',
  });

  // Boot with a tree-backed readdir that RECORDS every directory it is asked to read,
  // so we can prove only directories (never files) are ever descended into.
  async function bootTree(tree, { lstatSize = 10 } = {}) {
    const el = buildMockElectron();
    const handlers = {};
    el.ipcMain.handle.mockImplementation((n, fn) => { handlers[n] = fn; });
    const readdirCalls = [];
    const fsMock = buildMockFs();
    // path.join uses the OS separator (\ on Windows); normalize to / so the tree
    // keys (always written with /) match regardless of platform.
    const norm = (p) => String(p).replace(/\\/g, '/');
    fsMock.promises.readdir = (async (p, opts) => { readdirCalls.push({ p: norm(p), opts }); return tree[norm(p)] || []; });
    fsMock.promises.lstat = (async () => ({ isSymbolicLink: () => false, size: lstatSize }));
    fsMock.promises.readFile = (async () => 'content');
    el.dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: ['/vault'] }));
    bootstrap({ electron: el, fs: fsMock, proc: buildMockProc(['node', 'main.js']) });
    await new Promise((r) => setTimeout(r, 30));
    await handlers['dialog:openFolder']();
    return { el, handlers, readdirCalls, readVault: handlers['fs:readVault'] };
  }

  // 221 isDir guard + 232 topEntries.filter(isDir): a top-level FILE is never descended.
  test('a top-level .md FILE is read but NEVER readdir-descended (isDir guard)', async () => {
    const { readVault, readdirCalls } = await bootTree({
      '/vault': [dirent('note.md', 'f'), dirent('sub', 'd')],
      '/vault/sub': [dirent('inner.md', 'f')],
    });
    const res = await readVault({}, '/vault');
    expect(res.map((r) => r.relPath).sort()).toEqual(['note.md', 'sub/inner.md']);
    const dirsRead = readdirCalls.map((c) => c.p);
    // readdir is issued for /vault and /vault/sub ONLY — never for a file path.
    expect(dirsRead).toContain('/vault');
    expect(dirsRead.some((p) => p.endsWith('note.md'))).toBe(false);    // 221/232: file not descended
    expect(dirsRead.some((p) => p.endsWith('inner.md'))).toBe(false);   // 228: nested file not descended
  });

  // 225 collectSub readdir opts: descending a subdir uses { withFileTypes: true }.
  test('collectSub reads subdirectories with { withFileTypes: true }', async () => {
    const { readVault, readdirCalls } = await bootTree({
      '/vault': [dirent('sub', 'd')],
      '/vault/sub': [dirent('a.md', 'f')],
    });
    await readVault({}, '/vault');
    const subCall = readdirCalls.find((c) => c.p.endsWith('sub'));
    expect(subCall).toBeTruthy();
    expect(subCall.opts).toEqual({ withFileTypes: true });
  });

  // 228 entries.filter(isDir) in collectSub: a FILE living inside a subdir is not descended.
  test('a file inside a subdir is read, not descended (collectSub isDir filter)', async () => {
    const { readVault, readdirCalls } = await bootTree({
      '/vault': [dirent('sub', 'd')],
      '/vault/sub': [dirent('deep.md', 'f'), dirent('nested', 'd')],
      '/vault/sub/nested': [dirent('x.md', 'f')],
    });
    const res = await readVault({}, '/vault');
    expect(res.map((r) => r.relPath).sort()).toEqual(['sub/deep.md', 'sub/nested/x.md']);
    expect(readdirCalls.some((c) => c.p.endsWith('deep.md'))).toBe(false);
  });

  // 235 cross-directory sort: top-level 'z.md' must come AFTER 'a/inner.md' in the
  // final result (the per-dir order is top-then-sub; only the final sort fixes this).
  test('results are sorted ACROSS directories (final relPaths.sort)', async () => {
    const { readVault } = await bootTree({
      '/vault': [dirent('z.md', 'f'), dirent('a', 'd')],
      '/vault/a': [dirent('inner.md', 'f')],
    });
    const res = await readVault({}, '/vault');
    // localeCompare: 'a/inner.md' < 'z.md' → sorted order, NOT discovery order [z, a/inner].
    expect(res.map((r) => r.relPath)).toEqual(['a/inner.md', 'z.md']);
  });

  // 223 depth cap (depth > 12): collectSub is first entered at depth 1 for a top-level
  // subdir, so dirs d1..d12 are read (depth 1..12) but the read of d13 (depth 13) is
  // pruned. A file living INSIDE d13 is therefore excluded; a sibling file inside d12
  // (the last readable dir) is kept — proving the cap is exactly at depth 12, not lower.
  test('recursion is depth-bounded at depth 12 (deeper file excluded, depth-12 file kept)', async () => {
    const tree = { '/vault': [dirent('d1', 'd')] };
    // Chain /vault/d1/d2/.../d13. dN is at chain-position N.
    let pathSoFar = '/vault';
    for (let n = 1; n <= 13; n++) {
      const dirPath = `${pathSoFar}/d${n}`;
      const children = [];
      if (n < 13) children.push(dirent(`d${n + 1}`, 'd'));
      if (n === 12) children.push(dirent('atcap.md', 'f'));   // inside the depth-12 dir → kept
      if (n === 13) children.push(dirent('toodeep.md', 'f')); // inside the depth-13 dir → pruned
      tree[dirPath] = children;
      pathSoFar = dirPath;
    }
    const { readVault } = await bootTree(tree);
    const res = await readVault({}, '/vault');
    const rels = res.map((r) => r.relPath);
    // d1 is collectSub depth 1 … d12 is collectSub depth 12 (read) … d13 is depth 13 (pruned).
    expect(rels.some((r) => r.endsWith('atcap.md'))).toBe(true);
    expect(rels.some((r) => r.endsWith('toodeep.md'))).toBe(false);
  });
});
