/**
 * main-ipc.test.js — mutation-kill assertions for main.js file/IPC handlers.
 *
 * Cluster: deliverPendingFile, dialog:openFolder, fs:readVault, edit:command.
 *
 * These tests EXIST to KILL surviving mutants: every assertion pins an EXACT
 * observable value (the precise argument passed, the precise return object,
 * the precise method invoked) so that flipping an operator, swapping a literal,
 * dropping an argument, or negating a guard in main.js makes a test FAIL.
 *
 * Drives the real bootstrap({ electron, fs, proc }) with the shared harness
 * mocks (audit #3 seam — no Module hijack). Handlers are captured via the
 * ipcMain.handle/on mock call records, then invoked directly with crafted
 * events + seeded fs results.
 */

import { describe, test, expect, vi, beforeAll, beforeEach } from 'vitest';
import { bootstrap } from '../../main.js';
import {
  buildMockElectron,
  buildMockFs,
  buildMockProc,
} from './main-harness.js';

// 0xFEFF UTF-8 BOM, used to verify stripBOM wiring in both readVault + deliver.
const BOM = '﻿';

// ── helpers to pull captured handlers out of the mock call records ──────────
function getHandle(mockElectron, name) {
  return mockElectron.ipcMain.handle.mock.calls.find(c => c[0] === name)?.[1];
}
function getOn(mockElectron, name) {
  return mockElectron.ipcMain.on.mock.calls.find(c => c[0] === name)?.[1];
}

// A dirent factory matching what filterAndSortMdFiles expects.
function dirent(name, { file = true, symlink = false } = {}) {
  return { name, isFile: () => file, isSymbolicLink: () => symlink };
}

// ────────────────────────────────────────────────────────────────────────────
// dialog:openFolder — L106-117
// ────────────────────────────────────────────────────────────────────────────
describe('dialog:openFolder', () => {
  let mockElectron;
  let mockFs;
  let openFolder;
  let readVault;

  beforeAll(async () => {
    mockElectron = buildMockElectron();
    mockFs = buildMockFs();
    bootstrap({ electron: mockElectron, fs: mockFs, proc: buildMockProc(['node', 'main.js']) });
    await new Promise(r => setTimeout(r, 50));
    openFolder = getHandle(mockElectron, 'dialog:openFolder');
    readVault = getHandle(mockElectron, 'fs:readVault');
  });

  test('passes the exact showOpenDialog options (openDirectory + title)', async () => {
    mockElectron.dialog.showOpenDialog.mockClear();
    mockElectron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    await openFolder();
    expect(mockElectron.dialog.showOpenDialog).toHaveBeenCalledTimes(1);
    const [winArg, opts] = mockElectron.dialog.showOpenDialog.mock.calls[0];
    // win is the focused window (L107) — must be the actual mock window object.
    expect(winArg).toBe(mockElectron._mockWin);
    // L109-110: kill literal mutations of the options object.
    expect(opts.properties).toEqual(['openDirectory']);
    expect(opts.title).toBe('Open Folder');
  });

  test('canceled:true → returns exactly {canceled:true, folderPath:null} and authorizes nothing', async () => {
    mockElectron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: ['/should-be-ignored'] });
    const r = await openFolder();
    expect(r).toEqual({ canceled: true, folderPath: null });
    // Even though filePaths had an entry, canceled short-circuits the add (L112).
    expect(await readVault({}, '/should-be-ignored')).toEqual({ error: 'unauthorized-path' });
  });

  test('canceled:false but empty filePaths → still {canceled:true, folderPath:null}', async () => {
    mockElectron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [] });
    const r = await openFolder();
    expect(r).toEqual({ canceled: true, folderPath: null });
  });

  test('canceled:false but filePaths undefined → {canceled:true, folderPath:null}', async () => {
    mockElectron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false });
    const r = await openFolder();
    expect(r).toEqual({ canceled: true, folderPath: null });
  });

  test('non-canceled with a path → {canceled:false, folderPath:<p>} and that exact path becomes authorized', async () => {
    mockElectron.dialog.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: ['/authz-vault', '/second-ignored'],
    });
    const r = await openFolder();
    // L116: returns filePaths[0] (the FIRST), not [1], not the array.
    expect(r).toEqual({ canceled: false, folderPath: '/authz-vault' });

    // L115: filePaths[0] was added to the allowlist → readVault no longer
    // rejects it as unauthorized. (readdir returns [] → result is []).
    mockFs.promises.readdir.mockResolvedValueOnce([]);
    expect(await readVault({}, '/authz-vault')).toEqual([]);

    // The non-selected entry was NOT authorized.
    expect(await readVault({}, '/second-ignored')).toEqual({ error: 'unauthorized-path' });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// dialog:openFile + fs:readFile — single-file open & reopen-from-Recent
// ────────────────────────────────────────────────────────────────────────────
describe('dialog:openFile', () => {
  let mockElectron;
  let mockFs;
  let openFile;

  beforeAll(async () => {
    mockElectron = buildMockElectron();
    mockFs = buildMockFs();
    bootstrap({ electron: mockElectron, fs: mockFs, proc: buildMockProc(['node', 'main.js']) });
    await new Promise(r => setTimeout(r, 50));
    openFile = getHandle(mockElectron, 'dialog:openFile');
  });

  test('passes exact showOpenDialog options (openFile + Markdown filter + title)', async () => {
    mockElectron.dialog.showOpenDialog.mockClear();
    mockElectron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    await openFile();
    const [winArg, opts] = mockElectron.dialog.showOpenDialog.mock.calls[0];
    expect(winArg).toBe(mockElectron._mockWin);
    expect(opts.properties).toEqual(['openFile']);
    expect(opts.title).toBe('Open File');
    expect(opts.filters).toEqual([{ name: 'Markdown', extensions: ['md', 'markdown'] }]);
  });

  test('canceled → exactly {canceled:true}', async () => {
    mockElectron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: ['/ignored'] });
    expect(await openFile()).toEqual({ canceled: true });
  });

  test('empty filePaths → {canceled:true}', async () => {
    mockElectron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [] });
    expect(await openFile()).toEqual({ canceled: true });
  });

  test('network path → {error:"network-path-not-allowed"}', async () => {
    mockElectron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['\\\\nas\\a.md'] });
    expect(await openFile()).toEqual({ error: 'network-path-not-allowed' });
  });

  test('oversized file → {error:"file-too-large"}', async () => {
    mockElectron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/big.md'] });
    mockFs.promises.stat.mockResolvedValueOnce({ size: 11 * 1024 * 1024 });
    expect(await openFile()).toEqual({ error: 'file-too-large' });
  });

  test('success → {canceled:false, filePath, name, content} with BOM stripped', async () => {
    mockElectron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/docs/note.md'] });
    mockFs.promises.stat.mockResolvedValueOnce({ size: 50 });
    mockFs.promises.readFile.mockResolvedValueOnce(BOM + '# Note');
    expect(await openFile()).toEqual({ canceled: false, filePath: '/docs/note.md', name: 'note.md', content: '# Note' });
  });

  test('read failure → {error:"read-failed"}', async () => {
    mockElectron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/x.md'] });
    mockFs.promises.stat.mockRejectedValueOnce(new Error('EACCES'));
    expect(await openFile()).toEqual({ error: 'read-failed' });
  });
});

describe('fs:readFile (reopen a recent single file)', () => {
  let mockElectron;
  let mockFs;
  let openFile;
  let readFile;

  // Authorize a single file by driving the real openFile handler (mirrors the app).
  async function authorizeFile(filePath, { size = 10 } = {}) {
    mockElectron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [filePath] });
    mockFs.promises.stat.mockResolvedValueOnce({ size });
    mockFs.promises.readFile.mockResolvedValueOnce('seed');
    await openFile();
  }

  beforeAll(async () => {
    mockElectron = buildMockElectron();
    mockFs = buildMockFs();
    bootstrap({ electron: mockElectron, fs: mockFs, proc: buildMockProc(['node', 'main.js']) });
    await new Promise(r => setTimeout(r, 50));
    openFile = getHandle(mockElectron, 'dialog:openFile');
    readFile = getHandle(mockElectron, 'fs:readFile');
  });

  test('invalid input → {error:"invalid"}', async () => {
    expect(await readFile({}, '')).toEqual({ error: 'invalid' });
    expect(await readFile({}, null)).toEqual({ error: 'invalid' });
    expect(await readFile({}, 123)).toEqual({ error: 'invalid' });
  });

  test('network path → {error:"network-path-not-allowed"}', async () => {
    expect(await readFile({}, '\\\\nas\\a.md')).toEqual({ error: 'network-path-not-allowed' });
  });

  test('unauthorized path → {error:"unauthorized-path"}', async () => {
    expect(await readFile({}, '/never-opened.md')).toEqual({ error: 'unauthorized-path' });
  });

  test('authorization gate runs before fs: an authorized file reads back (BOM stripped)', async () => {
    await authorizeFile('/docs/a.md');
    mockFs.promises.lstat.mockResolvedValueOnce({ isSymbolicLink: () => false, size: 20 });
    mockFs.promises.readFile.mockResolvedValueOnce(BOM + '# A');
    expect(await readFile({}, '/docs/a.md')).toEqual({ name: 'a.md', path: '/docs/a.md', content: '# A' });
  });

  test('symlink → {error:"unauthorized-path"}', async () => {
    await authorizeFile('/docs/link.md');
    mockFs.promises.lstat.mockResolvedValueOnce({ isSymbolicLink: () => true, size: 20 });
    expect(await readFile({}, '/docs/link.md')).toEqual({ error: 'unauthorized-path' });
  });

  test('oversized → {error:"file-too-large"}', async () => {
    await authorizeFile('/docs/big.md');
    mockFs.promises.lstat.mockResolvedValueOnce({ isSymbolicLink: () => false, size: 11 * 1024 * 1024 });
    expect(await readFile({}, '/docs/big.md')).toEqual({ error: 'file-too-large' });
  });

  test('read failure → {error:"read-failed"}', async () => {
    await authorizeFile('/docs/err.md');
    mockFs.promises.lstat.mockRejectedValueOnce(new Error('EIO'));
    expect(await readFile({}, '/docs/err.md')).toEqual({ error: 'read-failed' });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// fs:readVault — L119-170
// ────────────────────────────────────────────────────────────────────────────
describe('fs:readVault', () => {
  let mockElectron;
  let mockFs;
  let openFolder;
  let readVault;

  // Authorize a folder by driving the real openFolder handler, so allowedFolders
  // is populated the same way the app does it.
  async function authorize(folderPath) {
    mockElectron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [folderPath] });
    await openFolder();
  }

  beforeAll(async () => {
    mockElectron = buildMockElectron();
    mockFs = buildMockFs();
    bootstrap({ electron: mockElectron, fs: mockFs, proc: buildMockProc(['node', 'main.js']) });
    await new Promise(r => setTimeout(r, 50));
    openFolder = getHandle(mockElectron, 'dialog:openFolder');
    readVault = getHandle(mockElectron, 'fs:readVault');
  });

  // ── L120-122: invalid input guard (non-string / empty) ──
  test('throws "Invalid folder path" for empty string, null, undefined, and non-string', async () => {
    await expect(readVault({}, '')).rejects.toThrow('Invalid folder path');
    await expect(readVault({}, null)).rejects.toThrow('Invalid folder path');
    await expect(readVault({}, undefined)).rejects.toThrow('Invalid folder path');
    await expect(readVault({}, 123)).rejects.toThrow('Invalid folder path');
    await expect(readVault({}, {})).rejects.toThrow('Invalid folder path');
  });

  // ── L124-126: network paths ──
  test('UNC path (\\\\) → exactly {error:"network-path-not-allowed"}', async () => {
    expect(await readVault({}, '\\\\server\\share')).toEqual({ error: 'network-path-not-allowed' });
  });

  test('POSIX network path (//) → exactly {error:"network-path-not-allowed"}', async () => {
    expect(await readVault({}, '//server/share')).toEqual({ error: 'network-path-not-allowed' });
  });

  test('network check runs BEFORE authorization: a network path is never reached for auth even if authorized', async () => {
    // Authorize the literal UNC string; network rejection must STILL win,
    // proving isNetworkPath is checked first (L124 before L128) and returns
    // the network error, not unauthorized-path and not a file listing.
    await authorize('\\\\server\\auth');
    expect(await readVault({}, '\\\\server\\auth')).toEqual({ error: 'network-path-not-allowed' });
  });

  // ── L128-130: authorization ──
  test('a non-network, non-authorized local path → exactly {error:"unauthorized-path"}', async () => {
    expect(await readVault({}, '/never-authorized')).toEqual({ error: 'unauthorized-path' });
  });

  // ── T-B9: a successful read starts an fs.watch and pushes vault:changed ──
  test('after a successful read, watches the vault and sends vault:changed (debounced) on a disk change', async () => {
    await authorize('/watch-vault');
    mockFs.promises.readdir.mockResolvedValueOnce([]);
    const sender = mockElectron._mockWin.webContents;
    sender.send.mockClear();

    await readVault({ sender }, '/watch-vault');
    expect(mockFs.watch).toHaveBeenCalledWith('/watch-vault', { recursive: true }, expect.any(Function));

    vi.useFakeTimers();
    try {
      mockFs._watchCb('change', 'note.md'); // simulate an external edit
      vi.advanceTimersByTime(200);          // past the debounce
    } finally {
      vi.useRealTimers();
    }
    const sent = sender.send.mock.calls.find((c) => c[0] === 'vault:changed');
    expect(sent, 'should emit vault:changed').toBeTruthy();
    expect(sent[1].files).toContain('note.md');
    expect(sent[1].folderPath).toBe('/watch-vault');
  });

  // ── L274: vault:changed only fires for a LIVE sender (sender && !isDestroyed) ──
  test('a destroyed sender → vault:changed is NOT sent (kills && → || and forced-true)', async () => {
    await authorize('/watch-dead');
    mockFs.promises.readdir.mockResolvedValueOnce([]);
    const sender = { isDestroyed: vi.fn(() => true), send: vi.fn() };
    await readVault({ sender }, '/watch-dead');
    vi.useFakeTimers();
    try {
      mockFs._watchCb('change', 'x.md');
      vi.advanceTimersByTime(300);
    } finally {
      vi.useRealTimers();
    }
    // isDestroyed() true → the guard short-circuits → no send (a || mutant would
    // either throw or send; a forced-true would send).
    expect(sender.send).not.toHaveBeenCalled();
  });

  // ── L271: opening a second vault closes the PRIOR watcher first ──
  test('a second successful read closes the previous vault watcher (no fs.watch leak)', async () => {
    await authorize('/watch-first');
    mockFs.promises.readdir.mockResolvedValueOnce([]);
    await readVault({ sender: mockElectron._mockWin.webContents }, '/watch-first');
    const firstClose = mockFs._watchClose; // captured handle's close()

    await authorize('/watch-second');
    mockFs.promises.readdir.mockResolvedValueOnce([]);
    await readVault({ sender: mockElectron._mockWin.webContents }, '/watch-second');

    // The first watcher must have been closed when the second read replaced it.
    expect(firstClose).toHaveBeenCalledTimes(1);
  });

  // ── L455: closing the window closes the live vault watcher (T-B9 teardown) ──
  test('the window "close" handler closes the active vault watcher', async () => {
    await authorize('/watch-onclose');
    mockFs.promises.readdir.mockResolvedValueOnce([]);
    await readVault({ sender: mockElectron._mockWin.webContents }, '/watch-onclose');
    const closeFn = mockFs._watchClose;
    // The win 'close' listener registered in createWindow().
    const onClose = mockElectron._mockWin.on.mock.calls.find((c) => c[0] === 'close')?.[1];
    expect(typeof onClose).toBe('function');
    onClose();
    expect(closeFn).toHaveBeenCalledTimes(1);
  });

  // ── L549: app 'before-quit' closes the active vault watcher (no fs.watch leak) ──
  test('app "before-quit" closes the active vault watcher', async () => {
    await authorize('/watch-quit');
    mockFs.promises.readdir.mockResolvedValueOnce([]);
    await readVault({ sender: mockElectron._mockWin.webContents }, '/watch-quit');
    const closeFn = mockFs._watchClose;
    const onQuit = mockElectron.app.on.mock.calls.find((c) => c[0] === 'before-quit')?.[1];
    expect(typeof onQuit).toBe('function');
    onQuit();
    expect(closeFn).toHaveBeenCalledTimes(1);
  });

  // ── L553: app 'window-all-closed' closes the active vault watcher ──
  test('app "window-all-closed" closes the active vault watcher', async () => {
    await authorize('/watch-allclosed');
    mockFs.promises.readdir.mockResolvedValueOnce([]);
    await readVault({ sender: mockElectron._mockWin.webContents }, '/watch-allclosed');
    const closeFn = mockFs._watchClose;
    const onAllClosed = mockElectron.app.on.mock.calls.find((c) => c[0] === 'window-all-closed')?.[1];
    expect(typeof onAllClosed).toBe('function');
    onAllClosed();
    expect(closeFn).toHaveBeenCalledTimes(1);
  });

  // ── L132 + L134-136: readdir + too-many-files boundary ──
  test('readdir is called with the folderPath and {withFileTypes:true}', async () => {
    await authorize('/readdir-vault');
    mockFs.promises.readdir.mockClear();
    mockFs.promises.readdir.mockResolvedValueOnce([]);
    await readVault({}, '/readdir-vault');
    expect(mockFs.promises.readdir).toHaveBeenCalledTimes(1);
    expect(mockFs.promises.readdir).toHaveBeenCalledWith('/readdir-vault', { withFileTypes: true });
  });

  test('exactly 5000 entries is NOT too-many (boundary); 5001 IS too-many', async () => {
    // 5000 entries (none .md) → passes the cap, yields [].
    await authorize('/cap-ok');
    mockFs.promises.readdir.mockResolvedValueOnce(
      Array.from({ length: 5000 }, (_, i) => dirent(`f${i}.bin`)) // non-md → filtered out
    );
    expect(await readVault({}, '/cap-ok')).toEqual([]);

    // 5001 entries → too-many-files (the cap is strict >).
    await authorize('/cap-over');
    mockFs.promises.readdir.mockResolvedValueOnce(
      Array.from({ length: 5001 }, (_, i) => dirent(`f${i}.bin`))
    );
    expect(await readVault({}, '/cap-over')).toEqual({ error: 'too-many-files' });
  });

  // ── L146-151: symlink escape detection ──
  test('symlink whose realpath ESCAPES the vault is skipped', async () => {
    await authorize('/sym-vault');
    mockFs.promises.readdir.mockResolvedValueOnce([dirent('evil.md', { file: false, symlink: true })]);
    mockFs.promises.lstat.mockResolvedValueOnce({ isSymbolicLink: () => true, size: 100 });
    mockFs.promises.realpath.mockResolvedValueOnce('/etc/passwd'); // outside the vault
    const r = await readVault({}, '/sym-vault');
    expect(r).toEqual([]); // escaped → continue → nothing returned
  });

  test('symlink whose realpath STAYS inside the vault is kept (proves the escape branch is conditional)', async () => {
    await authorize('/sym-ok');
    mockFs.promises.readdir.mockResolvedValueOnce([dirent('link.md', { file: false, symlink: true })]);
    mockFs.promises.lstat.mockResolvedValueOnce({ isSymbolicLink: () => true, size: 100 });
    mockFs.promises.realpath.mockResolvedValueOnce('/sym-ok/sub/link.md'); // inside
    mockFs.promises.stat.mockResolvedValueOnce({ size: 100 });             // L154 stat-via-symlink
    mockFs.promises.readFile.mockResolvedValueOnce('inside-content');
    const r = await readVault({}, '/sym-ok');
    expect(r).toEqual([{ name: 'link.md', relPath: 'link.md', content: 'inside-content' }]);
  });

  test('a NON-symlink .md never calls realpath (L146 guard) and uses lstat size directly', async () => {
    await authorize('/plain');
    mockFs.promises.readdir.mockResolvedValueOnce([dirent('plain.md')]);
    mockFs.promises.lstat.mockResolvedValueOnce({ isSymbolicLink: () => false, size: 42 });
    mockFs.promises.realpath.mockClear();
    mockFs.promises.stat.mockClear();
    mockFs.promises.readFile.mockResolvedValueOnce('plain-content');
    const r = await readVault({}, '/plain');
    expect(r).toEqual([{ name: 'plain.md', relPath: 'plain.md', content: 'plain-content' }]);
    // L146 isSymbolicLink() false → neither realpath nor the symlink-stat branch runs.
    expect(mockFs.promises.realpath).not.toHaveBeenCalled();
    expect(mockFs.promises.stat).not.toHaveBeenCalled();
  });

  // ── L156-158: per-file oversize cap ──
  test('oversized file (>10 MiB) is skipped; the next normal file is still returned', async () => {
    await authorize('/oversize');
    mockFs.promises.readdir.mockResolvedValueOnce([
      dirent('a-huge.md'),
      dirent('b-tiny.md'),
    ]);
    // a-huge sorts before b-tiny via localeCompare → lstat order is deterministic.
    mockFs.promises.lstat
      .mockResolvedValueOnce({ isSymbolicLink: () => false, size: 10 * 1024 * 1024 + 1 }) // 1 byte over
      .mockResolvedValueOnce({ isSymbolicLink: () => false, size: 100 });
    mockFs.promises.readFile.mockResolvedValueOnce('kept');
    const r = await readVault({}, '/oversize');
    expect(r).toEqual([{ name: 'b-tiny.md', relPath: 'b-tiny.md', content: 'kept' }]);
  });

  test('a file at EXACTLY 10 MiB is NOT oversized (boundary kept)', async () => {
    await authorize('/exact');
    mockFs.promises.readdir.mockResolvedValueOnce([dirent('exact.md')]);
    mockFs.promises.lstat.mockResolvedValueOnce({ isSymbolicLink: () => false, size: 10 * 1024 * 1024 });
    mockFs.promises.readFile.mockResolvedValueOnce('exactly-10mib');
    const r = await readVault({}, '/exact');
    expect(r).toEqual([{ name: 'exact.md', relPath: 'exact.md', content: 'exactly-10mib' }]);
  });

  // ── L160-163: cumulative cap + partial ──
  test('cumulative >100 MiB → {error:"cumulative-size-exceeded", partial:[<already-collected>]}', async () => {
    await authorize('/cumul');
    // Three 60 MiB files (each under the 10 MiB? NO — use 60 MiB which is > 10 MiB).
    // To exceed cumulative WITHOUT tripping the per-file cap, use files <= 10 MiB.
    // 11 files of 10 MiB = 110 MiB. File #11 pushes cumulative to 110 MiB > 100.
    mockFs.promises.readdir.mockResolvedValueOnce(
      Array.from({ length: 11 }, (_, i) => dirent(`f${String(i).padStart(2, '0')}.md`))
    );
    for (let i = 0; i < 11; i++) {
      mockFs.promises.lstat.mockResolvedValueOnce({ isSymbolicLink: () => false, size: 10 * 1024 * 1024 });
    }
    // First 10 files read fine (cumulative goes 10,20,...,100 MiB — none EXCEED 100 yet
    // because at file #10 cumulative == 100 MiB and 100 > 100 is false).
    for (let i = 0; i < 10; i++) {
      mockFs.promises.readFile.mockResolvedValueOnce(`content-${i}`);
    }
    const r = await readVault({}, '/cumul');
    expect(r.error).toBe('cumulative-size-exceeded');
    expect(Array.isArray(r.partial)).toBe(true);
    // partial holds the files collected BEFORE the cap tripped: the first 10.
    expect(r.partial).toHaveLength(10);
    expect(r.partial.map(x => x.name)).toEqual(
      Array.from({ length: 10 }, (_, i) => `f${String(i).padStart(2, '0')}.md`)
    );
    expect(r.partial[0]).toEqual({ name: 'f00.md', relPath: 'f00.md', content: 'content-0' });
  });

  // ── L165-167: readFile + BOM strip + result shape ──
  test('a normal .md → result item {name, relPath, content} with content read utf8 + BOM stripped', async () => {
    await authorize('/bom-vault');
    mockFs.promises.readdir.mockResolvedValueOnce([dirent('doc.md')]);
    mockFs.promises.lstat.mockResolvedValueOnce({ isSymbolicLink: () => false, size: 50 });
    mockFs.promises.readFile.mockClear();
    mockFs.promises.readFile.mockResolvedValueOnce(BOM + '# Heading\nbody');
    const r = await readVault({}, '/bom-vault');
    // L165: readFile called with the joined fullPath and 'utf8' encoding.
    expect(mockFs.promises.readFile).toHaveBeenCalledTimes(1);
    const [readArg, encArg] = mockFs.promises.readFile.mock.calls[0];
    expect(readArg).toContain('doc.md');
    expect(encArg).toBe('utf8');
    // L166-167: BOM stripped, exact result shape.
    expect(r).toEqual([{ name: 'doc.md', relPath: 'doc.md', content: '# Heading\nbody' }]);
    // Defensive: leading char must NOT be the BOM.
    expect(r[0].content.charCodeAt(0)).not.toBe(0xFEFF);
    expect(r[0].content.charCodeAt(0)).toBe('#'.charCodeAt(0));
  });

  test('content WITHOUT a BOM is returned unchanged (proves stripBOM is conditional, not a blind slice(1))', async () => {
    await authorize('/no-bom');
    mockFs.promises.readdir.mockResolvedValueOnce([dirent('nobom.md')]);
    mockFs.promises.lstat.mockResolvedValueOnce({ isSymbolicLink: () => false, size: 10 });
    mockFs.promises.readFile.mockResolvedValueOnce('# NoBOM');
    const r = await readVault({}, '/no-bom');
    expect(r[0].content).toBe('# NoBOM'); // first char NOT dropped
  });

  test('multiple .md files come back sorted with independent content', async () => {
    await authorize('/multi');
    mockFs.promises.readdir.mockResolvedValueOnce([dirent('beta.md'), dirent('alpha.md')]);
    mockFs.promises.lstat
      .mockResolvedValueOnce({ isSymbolicLink: () => false, size: 10 })
      .mockResolvedValueOnce({ isSymbolicLink: () => false, size: 10 });
    // sorted order is alpha, beta → readFile is consumed in that order.
    mockFs.promises.readFile
      .mockResolvedValueOnce('A')
      .mockResolvedValueOnce('B');
    const r = await readVault({}, '/multi');
    expect(r).toEqual([
      { name: 'alpha.md', relPath: 'alpha.md', content: 'A' },
      { name: 'beta.md', relPath: 'beta.md', content: 'B' },
    ]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// edit:command — L172-183
// ────────────────────────────────────────────────────────────────────────────
describe('edit:command', () => {
  let mockElectron;
  let editCmd;

  beforeAll(async () => {
    mockElectron = buildMockElectron();
    bootstrap({ electron: mockElectron, fs: buildMockFs(), proc: buildMockProc(['node', 'main.js']) });
    await new Promise(r => setTimeout(r, 50));
    editCmd = getOn(mockElectron, 'edit:command');
  });

  // A fresh sender per call so we can assert exact one-to-one mapping.
  function freshSender() {
    return {
      copy: vi.fn(), cut: vi.fn(), paste: vi.fn(),
      undo: vi.fn(), redo: vi.fn(), selectAll: vi.fn(),
      isDestroyed: vi.fn(() => false),
    };
  }

  test.each([
    ['copy', 'copy'],
    ['cut', 'cut'],
    ['paste', 'paste'],
    ['undo', 'undo'],
    ['redo', 'redo'],
    ['selectAll', 'selectAll'],
  ])('cmd "%s" calls ONLY wc.%s() exactly once', (cmd, method) => {
    const wc = freshSender();
    editCmd({ sender: wc }, cmd);
    expect(wc[method]).toHaveBeenCalledTimes(1);
    // No OTHER editing method fired — kills "swap method" mutants (e.g. L181
    // selectAll() → some other call, or a dispatch falling through to the wrong arm).
    for (const other of ['copy', 'cut', 'paste', 'undo', 'redo', 'selectAll']) {
      if (other !== method) expect(wc[other]).not.toHaveBeenCalled();
    }
  });

  test('unknown command is a silent no-op (no editing method fires)', () => {
    const wc = freshSender();
    expect(() => editCmd({ sender: wc }, 'bogus')).not.toThrow();
    for (const m of ['copy', 'cut', 'paste', 'undo', 'redo', 'selectAll']) {
      expect(wc[m]).not.toHaveBeenCalled();
    }
  });

  test('destroyed sender → early return, no editing method fires even for a valid cmd', () => {
    const wc = freshSender();
    wc.isDestroyed = vi.fn(() => true);
    expect(() => editCmd({ sender: wc }, 'copy')).not.toThrow();
    expect(wc.isDestroyed).toHaveBeenCalled();
    expect(wc.copy).not.toHaveBeenCalled();
  });

  test('missing sender (falsy) → silent no-op', () => {
    expect(() => editCmd({ sender: null }, 'copy')).not.toThrow();
    expect(() => editCmd({}, 'copy')).not.toThrow();
  });

  test('a throwing editing method is swallowed (try/catch no-op)', () => {
    const wc = freshSender();
    wc.copy = vi.fn(() => { throw new Error('clipboard locked'); });
    expect(() => editCmd({ sender: wc }, 'copy')).not.toThrow();
    expect(wc.copy).toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// deliverPendingFile — L89-102 (driven via app.on('open-file') + did-finish-load)
// ────────────────────────────────────────────────────────────────────────────
describe('deliverPendingFile (via open-file + did-finish-load)', () => {
  let mockElectron;
  let mockFs;
  let mockProc;
  let appListeners;
  let didFinishLoad;
  let openFile;

  beforeEach(async () => {
    mockElectron = buildMockElectron();
    appListeners = {};
    mockElectron.app.on.mockImplementation((event, fn) => { appListeners[event] = fn; });
    mockElectron._mockWin.webContents.on.mockImplementation((event, fn) => {
      if (event === 'did-finish-load') didFinishLoad = fn;
    });
    mockFs = buildMockFs({ readFileSync: vi.fn(() => '# default') });
    // argv has NO .md file → pendingFileToOpen starts null after whenReady.
    mockProc = buildMockProc(['node', 'main.js']);
    bootstrap({ electron: mockElectron, fs: mockFs, proc: mockProc });
    await new Promise(r => setTimeout(r, 50));
    openFile = appListeners['open-file'];
  });

  test('open-file delivers send("open-external-file",{name:basename, path, content}) BOM-stripped', () => {
    mockFs.readFileSync.mockReturnValueOnce(BOM + '# Pending body');
    mockElectron.BrowserWindow.getAllWindows.mockReturnValueOnce([mockElectron._mockWin]);
    mockElectron._mockWin.webContents.send.mockClear();
    const ev = { preventDefault: vi.fn() };

    openFile(ev, '/abs/dir/My Note.md');

    expect(ev.preventDefault).toHaveBeenCalled();
    // L94: readFileSync called with the EXACT path and 'utf8'.
    expect(mockFs.readFileSync).toHaveBeenCalledWith('/abs/dir/My Note.md', 'utf8');
    // L96-100: channel + payload pinned exactly.
    expect(mockElectron._mockWin.webContents.send).toHaveBeenCalledTimes(1);
    const [channel, payload] = mockElectron._mockWin.webContents.send.mock.calls[0];
    expect(channel).toBe('open-external-file');
    expect(payload).toEqual({
      name: 'My Note.md',         // path.basename of the full path
      path: '/abs/dir/My Note.md',
      content: '# Pending body',  // BOM stripped
    });
    expect(payload.content.charCodeAt(0)).not.toBe(0xFEFF);
  });

  test('content WITHOUT a BOM is delivered unchanged', () => {
    mockFs.readFileSync.mockReturnValueOnce('plain no bom');
    mockElectron.BrowserWindow.getAllWindows.mockReturnValueOnce([mockElectron._mockWin]);
    mockElectron._mockWin.webContents.send.mockClear();
    openFile({ preventDefault: vi.fn() }, '/x/y.md');
    expect(mockElectron._mockWin.webContents.send.mock.calls[0][1].content).toBe('plain no bom');
  });

  test('pendingFile is consumed: a second delivery (did-finish-load) sends nothing', () => {
    mockElectron.BrowserWindow.getAllWindows.mockReturnValueOnce([mockElectron._mockWin]);
    openFile({ preventDefault: vi.fn() }, '/once.md');
    // first delivery happened
    expect(mockElectron._mockWin.webContents.send).toHaveBeenCalledTimes(1);

    // second tick with no new pending file → guard !pendingFileToOpen returns early.
    mockElectron._mockWin.webContents.send.mockClear();
    didFinishLoad();
    expect(mockElectron._mockWin.webContents.send).not.toHaveBeenCalled();
  });

  test('no send when window is destroyed (guard win.isDestroyed())', () => {
    mockFs.readFileSync.mockReturnValueOnce('# body');
    const destroyedWin = mockElectron._mockWin;
    destroyedWin.isDestroyed.mockReturnValueOnce(true);
    mockElectron.BrowserWindow.getAllWindows.mockReturnValueOnce([destroyedWin]);
    destroyedWin.webContents.send.mockClear();
    openFile({ preventDefault: vi.fn() }, '/dead.md');
    expect(destroyedWin.webContents.send).not.toHaveBeenCalled();
    // readFileSync must NOT have run either — the guard returns before reading.
    expect(mockFs.readFileSync).not.toHaveBeenCalledWith('/dead.md', 'utf8');
  });

  test('no send when there are no windows (win is undefined → guard !win)', () => {
    mockFs.readFileSync.mockReturnValueOnce('# body');
    mockElectron.BrowserWindow.getAllWindows.mockReturnValueOnce([]);
    mockElectron._mockWin.webContents.send.mockClear();
    const ev = { preventDefault: vi.fn() };
    openFile(ev, '/nowin.md');
    // preventDefault still runs (open-file handler L301), but deliver never fires.
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(mockElectron._mockWin.webContents.send).not.toHaveBeenCalled();
  });

  test('empty filePath is a no-op after preventDefault (open-file L302 guard)', () => {
    mockElectron.BrowserWindow.getAllWindows.mockReturnValueOnce([mockElectron._mockWin]);
    mockElectron._mockWin.webContents.send.mockClear();
    const ev = { preventDefault: vi.fn() };
    openFile(ev, '');
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(mockElectron._mockWin.webContents.send).not.toHaveBeenCalled();
  });

  test('readFileSync throwing is swallowed → no send (silent catch L101)', () => {
    mockFs.readFileSync.mockImplementationOnce(() => { throw new Error('ENOENT'); });
    mockElectron.BrowserWindow.getAllWindows.mockReturnValueOnce([mockElectron._mockWin]);
    mockElectron._mockWin.webContents.send.mockClear();
    const ev = { preventDefault: vi.fn() };
    expect(() => openFile(ev, '/throws.md')).not.toThrow();
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(mockElectron._mockWin.webContents.send).not.toHaveBeenCalled();
  });
});
