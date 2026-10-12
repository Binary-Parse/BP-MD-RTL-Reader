/**
 * main-read-vault-changes.test.js — H15 step 3: fs:readVaultChanges(vaultId, relPaths).
 *
 * Requirement: when only a few notes changed on disk the renderer asks main for JUST those
 * notes. The new channel must be exactly as safe as fs:readVault:
 *   - the vault id is a main-issued capability (a raw path or forged id is refused),
 *   - every requested path must stay inside the vault root and name a Markdown file,
 *   - symlinks that resolve outside the vault are skipped,
 *   - size caps apply,
 * and it must NOT walk the folder, re-create the watcher, or touch unrelated notes.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';
import { bootstrap } from '../../src/main/index.js';
import { buildMockElectron, buildMockFs, buildMockProc } from './main-harness.js';

const getHandle = (el, name) => el.ipcMain.handle.mock.calls.find((c) => c[0] === name)?.[1];
const MB = 1024 * 1024;

describe('fs:readVaultChanges (H15 step 3)', () => {
  let el; let fsMock; let files; let sizes; let links; let sender; let readChanges; let readVaultFull; let closeVault; let vaultId; let full;
  const abs = (rel) => path.join('/vault', ...rel.split('/'));

  async function openVault(names) {
    for (const [name, content] of Object.entries(names)) files[abs(name)] = content;
    const picked = await getHandle(el, 'dialog:openFolder')();
    vaultId = picked.vault.id;
    const top = Object.keys(names).filter((n) => !n.includes('/'))
      .map((name) => ({ name, isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false }));
    fsMock.promises.readdir.mockResolvedValueOnce(top);
    full = await readVaultFull({ sender }, vaultId);
    return full;
  }

  beforeEach(async () => {
    el = buildMockElectron();
    const handlers = {};
    el.ipcMain.handle.mockImplementation((n, fn) => { handlers[n] = fn; });
    files = {}; sizes = {}; links = {};
    fsMock = buildMockFs({
      existsSync: (p) => p in files,
      readFileSync: (p) => files[p],
    });
    fsMock.promises.lstat = vi.fn(async (p) => {
      if (!(p in files)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
      return { isSymbolicLink: () => p in links, isFile: () => true, size: sizes[p] ?? Buffer.byteLength(String(files[p])) };
    });
    fsMock.promises.realpath = vi.fn(async (p) => (p in links ? links[p] : p));
    fsMock.promises.stat = vi.fn(async (p) => ({ isFile: () => true, size: sizes[p] ?? Buffer.byteLength(String(files[p] ?? '')) }));
    el.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: ['/vault'] });
    sender = { send: vi.fn(), isDestroyed: () => false };
    bootstrap({ electron: el, fs: fsMock, proc: buildMockProc(['node', 'src/main/index.js']) });
    await new Promise((r) => setTimeout(r, 30));
    readChanges = getHandle(el, 'fs:readVaultChanges');
    readVaultFull = getHandle(el, 'fs:readVault');
    closeVault = getHandle(el, 'fs:closeVault');
  });

  test('the channel is registered', () => {
    expect(typeof readChanges).toBe('function');
  });

  describe('capability checks (same as fs:readVault)', () => {
    test.each([[''], [null], [undefined], [123], [{}], ['/vault'], ['\\\\server\\share'], ['//server/share']])(
      'a forged or non-capability vault id %j is refused without touching the filesystem',
      async (bad) => {
        await openVault({ 'a.md': 'A' });
        fsMock.promises.lstat.mockClear();
        expect(await readChanges({ sender }, bad, ['a.md'])).toEqual({ error: 'unauthorized-capability' });
        expect(fsMock.promises.lstat).not.toHaveBeenCalled();
      },
    );

    test('a well-formed id that main never issued is refused', async () => {
      await openVault({ 'a.md': 'A' });
      expect(await readChanges({ sender }, 'cap-00000000-0000-0000-0000-000000000000', ['a.md']))
        .toEqual({ error: 'unauthorized-capability' });
    });

    test('a vault the user closed can no longer be read incrementally', async () => {
      await openVault({ 'a.md': 'A' });
      await closeVault({}, vaultId);
      const r = await readChanges({ sender }, vaultId, ['a.md']);
      expect(r.error).toBeTruthy();
      expect(r.entries).toBeUndefined();
    });

    test('a granted vault that was never read (no watcher yet) is refused: the renderer must do a full read first', async () => {
      const picked = await getHandle(el, 'dialog:openFolder')();
      expect(await readChanges({ sender }, picked.vault.id, ['a.md'])).toEqual({ error: 'vault-not-open' });
    });
  });

  describe('relPaths validation', () => {
    const invalid = { error: 'invalid-paths' };
    test.each([
      ['undefined', undefined], ['null', null], ['a string', 'a.md'], ['an object', { 0: 'a.md', length: 1 }], ['empty', []],
    ])('relPaths that is %s is refused', async (_l, value) => {
      await openVault({ 'a.md': 'A' });
      expect(await readChanges({ sender }, vaultId, value)).toEqual(invalid);
    });

    test.each([
      ['a number', [1]], ['null', [null]], ['an object', [{}]], ['empty string', ['']], ['a nested array', [['a.md']]],
    ])('an entry that is %s refuses the whole call', async (_l, value) => {
      await openVault({ 'a.md': 'A' });
      expect(await readChanges({ sender }, vaultId, ['a.md', ...value])).toEqual(invalid);
    });

    test.each([
      ['parent traversal', '../outside.md'],
      ['deep traversal', 'sub/../../outside.md'],
      ['windows traversal', '..\\outside.md'],
      ['absolute posix', '/etc/passwd.md'],
      ['absolute windows', 'C:\\Windows\\x.md'],
      ['unc', '\\\\server\\share\\x.md'],
      ['current-dir segment', './a.md'],
      ['empty segment', 'sub//a.md'],
      ['trailing slash', 'sub/'],
      ['not a note', 'image.png'],
      ['a text file', 'a.txt'],
      ['no extension', 'README'],
      ['NUL byte', 'a\u0000.md'],
      ['extension hidden after NUL', 'a.md\u0000.png'],
    ])('%s is refused and nothing is read', async (_l, bad) => {
      await openVault({ 'a.md': 'A' });
      fsMock.promises.lstat.mockClear();
      expect(await readChanges({ sender }, vaultId, ['a.md', bad])).toEqual(invalid);
      expect(fsMock.promises.lstat).not.toHaveBeenCalled();
    });

    test('more than 50 paths is refused (the renderer falls back to a full read)', async () => {
      await openVault({ 'a.md': 'A' });
      const many = Array.from({ length: 51 }, (_, i) => `n${i}.md`);
      expect(await readChanges({ sender }, vaultId, many)).toEqual({ error: 'too-many-paths' });
    });

    test('exactly 50 paths is accepted', async () => {
      await openVault({ 'a.md': 'A' });
      const fifty = Array.from({ length: 50 }, (_, i) => `n${i}.md`);
      const r = await readChanges({ sender }, vaultId, fifty);
      expect(r.error).toBeUndefined();
      expect(r.entries).toEqual([]);
    });

    test('an absurdly long path is refused', async () => {
      await openVault({ 'a.md': 'A' });
      expect(await readChanges({ sender }, vaultId, [`${'x'.repeat(1100)}.md`])).toEqual(invalid);
    });

    test('a path nested deeper than the full read would ever list is refused', async () => {
      await openVault({ 'a.md': 'A' });
      const deep = `${Array.from({ length: 13 }, (_, i) => `d${i}`).join('/')}/x.md`; // 13 dirs + file
      expect(await readChanges({ sender }, vaultId, [deep])).toEqual(invalid);
      const ok = `${Array.from({ length: 12 }, (_, i) => `d${i}`).join('/')}/x.md`;
      expect((await readChanges({ sender }, vaultId, [ok])).error).toBeUndefined();
    });

    test.runIf(path.sep === '\\')('Windows: backslash separators are accepted for nested notes (the watcher reports them)', async () => {
      await openVault({ 'a.md': 'A' });
      files[abs('sub/n.md')] = 'N';
      const r = await readChanges({ sender }, vaultId, ['sub\\n.md']);
      expect(r.entries.map((e) => e.relPath)).toEqual(['sub/n.md']);
    });

    test.runIf(path.sep === '\\')('Windows: a colon (drive letter or NTFS alternate data stream) is refused', async () => {
      await openVault({ 'a.md': 'A' });
      expect(await readChanges({ sender }, vaultId, ['a.md:stream.md'])).toEqual(invalid);
      expect(await readChanges({ sender }, vaultId, ['C:/a.md'])).toEqual(invalid);
    });

    test.runIf(path.sep === '/')('POSIX: a backslash is part of a file name, so it is refused (full read instead of a wrong guess)', async () => {
      await openVault({ 'a.md': 'A' });
      expect(await readChanges({ sender }, vaultId, ['sub\\n.md'])).toEqual(invalid);
    });

    test('".." that still lands inside the vault is normalised to the real relative path', async () => {
      await openVault({ 'a.md': 'A' });
      files[abs('sub/n.md')] = 'N';
      const r = await readChanges({ sender }, vaultId, ['sub/../a.md']);
      expect(r.entries.map((e) => e.relPath)).toEqual(['a.md']);
    });

    test('two spellings of one note are read once', async () => {
      await openVault({ 'a.md': 'A' });
      fsMock.promises.readFile.mockClear();
      const r = await readChanges({ sender }, vaultId, ['a.md', 'sub/../a.md']);
      expect(r.entries).toHaveLength(1);
      expect(fsMock.promises.readFile).toHaveBeenCalledTimes(1);
    });

    test('the vault root itself and a bare ".." are refused', async () => {
      await openVault({ 'a.md': 'A' });
      expect(await readChanges({ sender }, vaultId, ['..'])).toEqual(invalid);
      expect(await readChanges({ sender }, vaultId, ['sub/..'])).toEqual(invalid);
    });

    test('a path of exactly 1024 characters is accepted, 1025 is refused', async () => {
      await openVault({ 'a.md': 'A' });
      const at = `${'x'.repeat(1021)}.md`;
      const over = `${'x'.repeat(1022)}.md`;
      expect((await readChanges({ sender }, vaultId, [at])).error).toBeUndefined();
      expect(await readChanges({ sender }, vaultId, [over])).toEqual(invalid);
    });

    test('a note extension is matched case-insensitively and anchored', async () => {
      await openVault({ 'a.md': 'A' });
      files[abs('UP.MD')] = 'U'; files[abs('long.Markdown')] = 'L';
      const r = await readChanges({ sender }, vaultId, ['UP.MD', 'long.Markdown']);
      expect(r.entries.map((e) => e.relPath)).toEqual(['UP.MD', 'long.Markdown']);
      expect(await readChanges({ sender }, vaultId, ['a.md.png'])).toEqual(invalid);
      expect(await readChanges({ sender }, vaultId, ['a.mdx'])).toEqual(invalid);
    });
  });

  describe('reading', () => {
    test('returns the full-read entry shape for just the requested notes', async () => {
      await openVault({ 'a.md': 'A\n', 'b.md': 'B\n', 'c.md': 'C\n' });
      files[abs('b.md')] = 'B changed\n';
      fsMock.promises.readdir.mockClear();
      fsMock.promises.readFile.mockClear();
      const r = await readChanges({ sender }, vaultId, ['b.md']);
      expect(r.error).toBeUndefined();
      expect(r.entries).toHaveLength(1);
      expect(r.entries[0]).toMatchObject({ relPath: 'b.md', name: 'b.md', vaultId, content: 'B changed\n' });
      expect(r.entries[0].documentId).toMatch(/^cap-/);
      expect(r.entries[0].meta.hash).toBeTruthy();
      expect(Object.keys(r.entries[0]).sort()).toEqual(Object.keys(full.entries[0]).sort());
      expect(fsMock.promises.readFile).toHaveBeenCalledTimes(1); // only b.md was decoded
      expect(fsMock.promises.readdir).not.toHaveBeenCalled();    // no folder walk
    });

    test('the document id is the one the full read already issued (same grant, no new authority)', async () => {
      await openVault({ 'a.md': 'A\n' });
      const r = await readChanges({ sender }, vaultId, ['a.md']);
      expect(r.entries[0].documentId).toBe(full.entries[0].documentId);
    });

    test('the result carries the vault identity and the UNCHANGED generation', async () => {
      await openVault({ 'a.md': 'A\n' });
      const r = await readChanges({ sender }, vaultId, ['a.md']);
      expect(r.vault).toEqual({ id: vaultId, name: 'vault', generation: full.vault.generation });
    });

    test('does not create or replace the vault watcher', async () => {
      await openVault({ 'a.md': 'A\n' });
      expect(fsMock._watches).toHaveLength(1);
      await readChanges({ sender }, vaultId, ['a.md']);
      expect(fsMock._watches).toHaveLength(1);
      expect(fsMock._watches[0].close).not.toHaveBeenCalled();
    });

    test('refreshes the write baseline: a save after an incremental read is accepted, not a conflict', async () => {
      await openVault({ 'a.md': 'A\n' });
      files[abs('a.md')] = 'edited elsewhere\n';
      const r = await readChanges({ sender }, vaultId, ['a.md']);
      const saved = await getHandle(el, 'fs:writeFile')({}, {
        documentId: r.entries[0].documentId, content: 'mine', baseHash: r.entries[0].meta.hash, eol: '\n',
      });
      expect(saved.ok).toBe(true);
    });

    test('a duplicate path is read once', async () => {
      await openVault({ 'a.md': 'A\n' });
      fsMock.promises.readFile.mockClear();
      const r = await readChanges({ sender }, vaultId, ['a.md', 'a.md', 'a.md']);
      expect(r.entries).toHaveLength(1);
      expect(fsMock.promises.readFile).toHaveBeenCalledTimes(1);
    });

    test('a note that was deleted is simply absent (the renderer marks it missing)', async () => {
      await openVault({ 'a.md': 'A\n', 'b.md': 'B\n' });
      delete files[abs('b.md')];
      const r = await readChanges({ sender }, vaultId, ['a.md', 'b.md']);
      expect(r.entries.map((e) => e.relPath)).toEqual(['a.md']);
      expect(r.skipped.unreadable).toBe(1);
    });

    test('a NEW note is returned like any other', async () => {
      await openVault({ 'a.md': 'A\n' });
      files[abs('fresh.md')] = '# fresh\n';
      const r = await readChanges({ sender }, vaultId, ['fresh.md']);
      expect(r.entries.map((e) => e.relPath)).toEqual(['fresh.md']);
    });

    test('a symlink that resolves outside the vault is skipped, never read', async () => {
      await openVault({ 'a.md': 'A\n' });
      files[abs('link.md')] = 'SECRET';
      links[abs('link.md')] = path.resolve('/outside/secret.md');
      files[path.resolve('/outside/secret.md')] = 'SECRET';
      fsMock.promises.readFile.mockClear();
      const r = await readChanges({ sender }, vaultId, ['link.md']);
      expect(r.entries).toEqual([]);
      expect(r.skipped.escaped).toBe(1);
      expect(fsMock.promises.readFile).not.toHaveBeenCalled();
    });

    test('a symlink that stays inside the vault is read through', async () => {
      await openVault({ 'a.md': 'A\n' });
      files[abs('alias.md')] = 'ALIAS';
      links[abs('alias.md')] = abs('a.md');
      const r = await readChanges({ sender }, vaultId, ['alias.md']);
      expect(r.entries).toHaveLength(1);
      expect(r.entries[0].relPath).toBe('alias.md');
    });

    test('an oversized note is skipped and counted', async () => {
      await openVault({ 'a.md': 'A\n' });
      files[abs('huge.md')] = 'x';
      sizes[abs('huge.md')] = 10 * MB + 1;
      const r = await readChanges({ sender }, vaultId, ['huge.md']);
      expect(r.entries).toEqual([]);
      expect(r.skipped.oversized).toBe(1);
    });

    test('a note whose bytes cannot be read is skipped as unreadable', async () => {
      await openVault({ 'a.md': 'A\n', 'b.md': 'B\n' });
      const readFile = fsMock.promises.readFile;
      fsMock.promises.readFile = vi.fn(async (p, ...rest) => {
        if (p === abs('b.md')) throw Object.assign(new Error('EIO'), { code: 'EIO' });
        return readFile(p, ...rest);
      });
      const r = await readChanges({ sender }, vaultId, ['a.md', 'b.md']);
      expect(r.entries.map((e) => e.relPath)).toEqual(['a.md']);
      expect(r.skipped.unreadable).toBe(1);
    });

    test('an unreadable note still counts toward the batch byte cap (as in the full read)', async () => {
      await openVault({ 'a.md': 'A\n' });
      const names = Array.from({ length: 11 }, (_, i) => `big${i}.md`);
      for (const n of names) { files[abs(n)] = 'x'; sizes[abs(n)] = 10 * MB; }
      const readFile = fsMock.promises.readFile;
      fsMock.promises.readFile = vi.fn(async (p, ...rest) => {
        if (p === abs('big0.md')) throw new Error('EIO');
        return readFile(p, ...rest);
      });
      // 11 x 10 MB: if the unreadable first note were not counted the batch would fit in 100 MB
      expect(await readChanges({ sender }, vaultId, names)).toEqual({ error: 'truncated' });
    });

    test.each([['undefined', undefined], ['an object without isFile', {}], ['isFile that is not a function', { isFile: true, size: 1 }]])(
      'a symlink whose target stat is %s is skipped as special, not read',
      async (_l, weird) => {
        await openVault({ 'a.md': 'A\n' });
        files[abs('alias.md')] = 'x';
        links[abs('alias.md')] = abs('a.md');
        fsMock.promises.stat = vi.fn(async () => weird);
        const r = await readChanges({ sender }, vaultId, ['alias.md']);
        expect(r.entries).toEqual([]);
        expect(r.skipped.special).toBe(1);
        expect(r.skipped.unreadable).toBe(0);
      },
    );

    test('a directory named like a note is skipped as a special file', async () => {
      await openVault({ 'a.md': 'A\n' });
      files[abs('folder.md')] = '';
      const lstat = fsMock.promises.lstat;
      fsMock.promises.lstat = vi.fn(async (p) => (p === abs('folder.md')
        ? { isSymbolicLink: () => false, isFile: () => false, size: 0 }
        : lstat(p)));
      const r = await readChanges({ sender }, vaultId, ['folder.md']);
      expect(r.entries).toEqual([]);
      expect(r.skipped.special).toBe(1);
    });

    test('exceeding the 100 MB batch cap refuses the call so the renderer does a full read', async () => {
      await openVault({ 'a.md': 'A\n' });
      const names = Array.from({ length: 11 }, (_, i) => `big${i}.md`);
      for (const n of names) { files[abs(n)] = 'x'; sizes[abs(n)] = 10 * MB; }
      expect(await readChanges({ sender }, vaultId, names)).toEqual({ error: 'truncated' });
    });

    test('an answer that finished after the folder was closed is discarded as stale', async () => {
      await openVault({ 'a.md': 'A\n' });
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      const lstat = fsMock.promises.lstat;
      fsMock.promises.lstat = vi.fn(async (p) => { await gate; return lstat(p); });
      const pending = readChanges({ sender }, vaultId, ['a.md']);
      await closeVault({}, vaultId);
      release();
      expect(await pending).toEqual({ error: 'stale-read' });
    });

    test('exactly 100 MB is still accepted', async () => {
      await openVault({ 'a.md': 'A\n' });
      const names = Array.from({ length: 10 }, (_, i) => `big${i}.md`);
      for (const n of names) { files[abs(n)] = 'x'; sizes[abs(n)] = 10 * MB; }
      const r = await readChanges({ sender }, vaultId, names);
      expect(r.error).toBeUndefined();
      expect(r.entries).toHaveLength(10);
    });
  });

  describe('shared per-file body: the full read behaves exactly as before', () => {
    test('a full read still reports skips by kind and returns relPath-tagged entries', async () => {
      files[abs('a.md')] = 'A\n';
      files[abs('gone.md')] = 'G\n';
      const picked = await getHandle(el, 'dialog:openFolder')();
      const entries = ['a.md', 'gone.md', 'huge.md', 'out.md'].map((name) => ({
        name, isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false,
      }));
      files[abs('huge.md')] = 'x'; sizes[abs('huge.md')] = 10 * MB + 1;
      files[abs('out.md')] = 'x'; links[abs('out.md')] = path.resolve('/outside/o.md');
      fsMock.promises.readdir.mockResolvedValueOnce(entries);
      const origLstat = fsMock.promises.lstat;
      fsMock.promises.lstat = vi.fn(async (p) => (p === abs('gone.md')
        ? Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
        : origLstat(p)));
      const r = await readVaultFull({ sender }, picked.vault.id);
      expect(r.entries.map((e) => e.relPath)).toEqual(['a.md']);
      expect(r.skipped).toEqual({ unreadable: 1, oversized: 1, escaped: 1, special: 0 });
      expect(r.truncated).toBe(false);
    });
  });
});
