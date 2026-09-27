import { beforeEach, describe, expect, test, vi } from 'vitest';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { bootstrap } from '../../src/main/index.js';
import { defaultSettings } from '../../src/main/settings.js';
import { buildMockElectron, buildMockFs, buildMockProc } from './main-harness.js';

function handler(electron, name) {
  return electron.ipcMain.handle.mock.calls.find(call => call[0] === name)?.[1];
}

describe('opaque filesystem IPC capabilities', () => {
  let electron;
  let fs;

  beforeEach(async () => {
    electron = buildMockElectron();
    fs = buildMockFs({
      realpathSync: vi.fn(p => p),
      statSync: vi.fn(p => p.endsWith('.md')
        ? { isFile: () => true, isDirectory: () => false, size: 12, mtimeMs: 10 }
        : { isFile: () => false, isDirectory: () => true, size: 0, mtimeMs: 10 }),
      readFileSync: vi.fn(p => p.endsWith('a.md') ? 'a\r\n' : '# note'),
      existsSync: vi.fn(p => p.endsWith('.md')),
    });
    bootstrap({ electron, fs, proc: buildMockProc(['node', 'src/main/index.js']) });
    await new Promise(resolve => setTimeout(resolve, 20));
  });

  test('picker returns only an opaque vault identity and forged paths cannot be read', async () => {
    electron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/vault'] });
    const picked = await handler(electron, 'dialog:openFolder')();
    expect(picked.canceled).toBe(false);
    expect(picked.vault).toMatchObject({ name: 'vault', generation: 1 });
    expect(picked.vault.id).toMatch(/^cap-/);
    expect(JSON.stringify(picked)).not.toContain('/vault');
    expect(await handler(electron, 'fs:readVault')({}, '/vault')).toEqual({ error: 'unauthorized-capability' });
  });

  test('vault read emits document IDs plus faithful metadata and writes only that exact document', async () => {
    electron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/vault'] });
    const picked = await handler(electron, 'dialog:openFolder')();
    fs.promises.readdir.mockResolvedValueOnce([{ name: 'a.md', isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false }]);
    fs.promises.lstat.mockResolvedValueOnce({ isSymbolicLink: () => false, isFile: () => true, size: 3 });
    const read = await handler(electron, 'fs:readVault')({ sender: electron._mockWin.webContents }, picked.vault.id);
    expect(read.entries).toHaveLength(1);
    expect(read.entries[0]).toMatchObject({ name: 'a.md', relPath: 'a.md', content: 'a\n' });
    expect(read.entries[0].documentId).toMatch(/^cap-/);
    expect(read.entries[0].meta).toMatchObject({ eol: '\r\n', finalNewline: true });

    const saved = await handler(electron, 'fs:writeFile')({}, {
      documentId: read.entries[0].documentId,
      content: 'changed',
      baseHash: read.entries[0].meta.hash,
      bom: false,
      eol: '\r\n',
      finalNewline: true,
      revision: 7,
    });
    expect(saved).toMatchObject({ ok: true, revision: 7 });
    expect(await handler(electron, 'fs:writeFile')({}, { documentId: '/vault/a.md', content: 'x' }))
      .toEqual({ error: 'unauthorized-capability' });
  });

  test('fs:closeVault requires a vault this session actually granted', async () => {
    electron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/vault'] });
    const picked = await handler(electron, 'dialog:openFolder')();
    expect(await handler(electron, 'fs:closeVault')({}, 'cap-never-granted'))
      .toEqual({ error: 'unauthorized-capability' });
    expect(await handler(electron, 'fs:closeVault')({}, null))
      .toEqual({ error: 'unauthorized-capability' });
    expect(await handler(electron, 'fs:closeVault')({}, picked.vault.id)).toEqual({ ok: true });
    // A closed folder is closed for the whole session: the grant is revoked with the
    // watcher, so a second close (or any read against it) is unauthorized again.
    expect(await handler(electron, 'fs:closeVault')({}, picked.vault.id))
      .toEqual({ error: 'unauthorized-capability' });
  });

  test('a standalone tab keeps save authority when its folder is opened and then closed (S-M1)', async () => {
    electron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/vault/a.md'] });
    const opened = await handler(electron, 'dialog:openFile')();
    expect(opened.canceled).toBe(false);
    const docId = opened.documentId;
    expect(await handler(electron, 'fs:writeFile')({}, {
      documentId: docId, content: 'standalone edit', baseHash: opened.meta.hash,
      bom: false, eol: '\n', finalNewline: true, revision: 1,
    })).toMatchObject({ ok: true });

    electron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/vault'] });
    const picked = await handler(electron, 'dialog:openFolder')();
    fs.promises.readdir.mockResolvedValueOnce([{ name: 'a.md', isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false }]);
    fs.promises.lstat.mockResolvedValueOnce({ isSymbolicLink: () => false, isFile: () => true, size: 8 });
    const read = await handler(electron, 'fs:readVault')({ sender: electron._mockWin.webContents }, picked.vault.id);
    expect(read.entries).toHaveLength(1);
    expect(await handler(electron, 'fs:closeVault')({}, picked.vault.id)).toEqual({ ok: true });

    // The vault read must not have converted the standalone record: its tab still
    // reads and writes through its own session document grant after the folder closes.
    const afterClose = await handler(electron, 'fs:readFile')({}, docId);
    expect(afterClose.documentId).toBe(docId);
    expect(await handler(electron, 'fs:writeFile')({}, {
      documentId: docId, content: 'still saving', baseHash: afterClose.meta.hash,
      bom: false, eol: '\n', finalNewline: true, revision: 2,
    })).toMatchObject({ ok: true });
  });

  test('fs:reopenDocument restores authority for a vault-owned document after its vault closes (S-M1 merge)', async () => {
    electron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/vault'] });
    const picked = await handler(electron, 'dialog:openFolder')();
    fs.promises.readdir.mockResolvedValueOnce([{ name: 'a.md', isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false }]);
    fs.promises.lstat.mockResolvedValueOnce({ isSymbolicLink: () => false, isFile: () => true, size: 3 });
    const read = await handler(electron, 'fs:readVault')({ sender: electron._mockWin.webContents }, picked.vault.id);
    const docId = read.entries[0].documentId;
    expect(await handler(electron, 'fs:writeFile')({}, {
      documentId: docId, content: 'vault edit', baseHash: read.entries[0].meta.hash,
      bom: false, eol: '\n', finalNewline: true, revision: 1,
    })).toMatchObject({ ok: true });

    expect(await handler(electron, 'fs:closeVault')({}, picked.vault.id)).toEqual({ ok: true });
    expect(await handler(electron, 'fs:writeFile')({}, {
      documentId: docId, content: 'nope', baseHash: read.entries[0].meta.hash,
      bom: false, eol: '\n', finalNewline: true, revision: 2,
    })).toEqual({ error: 'unauthorized-capability' });

    // The reopen grant used to be dead weight for vault-owned records (ok:true, then
    // refused); documentGrantActive now accepts either lane, so the recent is usable.
    expect(await handler(electron, 'fs:reopenDocument')({}, docId)).toEqual({ ok: true });
    const reopened = await handler(electron, 'fs:readFile')({}, docId);
    expect(reopened.documentId).toBe(docId);
    expect(await handler(electron, 'fs:writeFile')({}, {
      documentId: docId, content: 'reopened edit', baseHash: reopened.meta.hash,
      bom: false, eol: '\n', finalNewline: true, revision: 3,
    })).toMatchObject({ ok: true });
  });
});

// audit SEC-01: a persisted grant alone no longer authorizes anything — the vault must be
// open, granted through a dialog this run, or bootstrapped/reopened after re-validating the
// record against disk. Startup also prunes the registry to what settings still reference.
describe('session-scoped capability authority (audit SEC-01)', () => {
  const CAPS = path.join('/mock/userData/userData', 'capabilities.json');
  const SETTINGS = path.join('/mock/userData/userData', 'settings.json');
  let electron;
  let fs;

  function memFs(seed) {
    const files = { ...seed };
    const mock = buildMockFs({
      readFileSync: (p) => {
        if (p in files) return files[p];
        if (String(p).endsWith('.md')) return '# note';
        throw new Error('ENOENT');
      },
      writeFileSync: (p, c) => { files[p] = c; },
      renameSync: (a, b) => { files[b] = files[a]; delete files[a]; },
      existsSync: (p) => p in files,
      realpathSync: (p) => {
        if (String(p).includes('missing')) throw new Error('ENOENT');
        return p;
      },
      statSync: (p) => (String(p).endsWith('.md')
        ? { isFile: () => true, isDirectory: () => false, size: 12, mtimeMs: 10 }
        : { isFile: () => false, isDirectory: () => true, size: 0, mtimeMs: 10 }),
    });
    mock._files = files;
    return mock;
  }

  beforeEach(async () => {
    electron = buildMockElectron();
    fs = memFs({
      [CAPS]: JSON.stringify({
        version: 1,
        vaults: [
          { id: 'cap-old', path: '/vault-old', generation: 1 },
          { id: 'cap-missing', path: '/missing/vault', generation: 1 },
        ],
        documents: [{ id: 'cap-old-doc', path: '/loose/old.md', vaultId: null }],
      }),
      // Referenced by recents only — so startup KEEPS the records but grants no authority.
      [SETTINGS]: JSON.stringify({
        ...defaultSettings(),
        recents: [
          { name: 'old', path: 'old.md', vaultId: 'cap-old', documentId: 'cap-old-doc' },
          { name: 'gone', path: 'gone.md', vaultId: 'cap-missing' },
        ],
        lastSession: null,
      }),
    });
    bootstrap({ electron, fs, proc: buildMockProc(['node', 'src/main/index.js']) });
    await new Promise(resolve => setTimeout(resolve, 20));
  });

  test('a persisted-but-not-session vault cannot be read until it is reopened', async () => {
    expect(await handler(electron, 'fs:readVault')({}, 'cap-old')).toEqual({ error: 'unknown-vault' });
    expect(await handler(electron, 'fs:readVault')({}, 'cap-missing')).toEqual({ error: 'unknown-vault' });
    expect(await handler(electron, 'fs:readVault')({}, 'nope')).toEqual({ error: 'unauthorized-capability' });
  });

  test('fs:reopenVault activates a valid record so a readVault succeeds afterwards', async () => {
    expect(await handler(electron, 'fs:reopenVault')({}, 'cap-old')).toEqual({ ok: true, name: 'vault-old' });
    const read = await handler(electron, 'fs:readVault')({ sender: electron._mockWin.webContents }, 'cap-old');
    expect(read.error).toBeUndefined();
    expect(read.vault).toMatchObject({ id: 'cap-old' });
  });

  test('fs:reopenVault reports a missing folder (and an unknown id)', async () => {
    expect(await handler(electron, 'fs:reopenVault')({}, 'cap-missing')).toEqual({ error: 'missing-folder' });
    expect(await handler(electron, 'fs:reopenVault')({}, 'nope')).toEqual({ error: 'unknown-vault' });
  });

  test('a stale standalone document is unauthorized until fs:reopenDocument activates it', async () => {
    expect(await handler(electron, 'fs:readFile')({}, 'cap-old-doc')).toEqual({ error: 'unauthorized-capability' });
    expect(await handler(electron, 'fs:writeFile')({}, { documentId: 'cap-old-doc', content: 'x' }))
      .toEqual({ error: 'unauthorized-capability' });

    expect(await handler(electron, 'fs:reopenDocument')({}, 'cap-old-doc')).toEqual({ ok: true });

    const read = await handler(electron, 'fs:readFile')({}, 'cap-old-doc');
    expect(read).toMatchObject({ documentId: 'cap-old-doc', name: 'old.md', content: '# note' });
    const saved = await handler(electron, 'fs:writeFile')({}, {
      documentId: 'cap-old-doc',
      content: 'changed',
      baseHash: read.meta.hash,
      bom: false,
      eol: '\r\n',
      finalNewline: true,
      revision: 4,
    });
    expect(saved).toMatchObject({ ok: true, revision: 4 });
  });

  test('fs:reopenDocument reports a missing file and an unknown id', async () => {
    expect(await handler(electron, 'fs:reopenDocument')({}, 'nope')).toEqual({ error: 'unknown-capability' });
    expect(await handler(electron, 'fs:reopenDocument')({}, 'cap-vanished')).toEqual({ error: 'unknown-capability' });
  });

  test('startup pruning keeps only the records settings reference', async () => {
    // Re-boot against the same store: the unreferenced records must be gone from disk.
    await new Promise(resolve => setTimeout(resolve, 10));
    const persisted = JSON.parse(fs._files[CAPS]);
    expect(persisted.vaults.map((v) => v.id).sort()).toEqual(['cap-missing', 'cap-old']);
    expect(persisted.documents.map((d) => d.id)).toEqual(['cap-old-doc']);
  });

  test('fs:reveal and fs:copy-path refuse a stale document until it is reopened (path disclosure guard)', async () => {
    electron.shell.showItemInFolder = vi.fn();
    expect(await handler(electron, 'fs:reveal')({}, 'cap-old-doc')).toEqual({ error: 'unauthorized-capability' });
    expect(await handler(electron, 'fs:copy-path')({}, 'cap-old-doc')).toEqual({ error: 'unauthorized-capability' });
    expect(electron.shell.showItemInFolder).not.toHaveBeenCalled();
    expect(electron.clipboard.writeText).not.toHaveBeenCalled();

    expect(await handler(electron, 'fs:reopenDocument')({}, 'cap-old-doc')).toEqual({ ok: true });
    expect(await handler(electron, 'fs:reveal')({}, 'cap-old-doc')).toEqual({ ok: true });
    expect(await handler(electron, 'fs:copy-path')({}, 'cap-old-doc')).toEqual({ ok: true });
    expect(electron.shell.showItemInFolder).toHaveBeenCalledWith('/loose/old.md');
    expect(electron.clipboard.writeText).toHaveBeenCalledWith('/loose/old.md');
  });

  test('a reopened document without a main-side read cannot skip the conflict check (SEC-02)', async () => {
    fs._files['/loose/old.md'] = 'old on disk\n';
    expect(await handler(electron, 'fs:reopenDocument')({}, 'cap-old-doc')).toEqual({ ok: true });
    expect(await handler(electron, 'fs:writeFile')({}, { documentId: 'cap-old-doc', content: 'hostile overwrite' }))
      .toEqual({ error: 'conflict' });
    expect(fs._files['/loose/old.md']).toBe('old on disk\n');

    const diskHash = createHash('sha256').update('old on disk\n').digest('hex');
    expect(await handler(electron, 'fs:writeFile')({}, { documentId: 'cap-old-doc', content: 'honest edit', baseHash: diskHash }))
      .toMatchObject({ ok: true });
  });
});

// audit QA-06: the snapshot is parsed BEFORE deletion (a torn write must survive), and the
// renderer gets an explicit `unreadable` flag so it can say so instead of "nothing to recover".
describe('recovery:pop snapshot contract (audit QA-06)', () => {
  const RECOVERY = path.join('/mock/userData/userData', 'recovery', 'snapshot.json');
  let electron;
  let fs;

  function recoveryFs() {
    const files = {};
    const readFile = vi.fn(async (p) => {
      if (p in files) return files[p];
      throw new Error('ENOENT');
    });
    const unlink = vi.fn(async (p) => { delete files[p]; });
    const rename = vi.fn(async (a, b) => { files[b] = files[a]; delete files[a]; });
    const mock = buildMockFs({
      readFileSync: (p) => {
        if (p in files) return files[p];
        throw new Error('ENOENT');
      },
      writeFileSync: (p, c) => { files[p] = c; },
      renameSync: (a, b) => { files[b] = files[a]; delete files[a]; },
      existsSync: (p) => p in files,
      promises: { ...buildMockFs().promises, readFile, unlink, rename },
    });
    mock._files = files;
    mock._recovery = { readFile, unlink, rename };
    return mock;
  }

  beforeEach(async () => {
    electron = buildMockElectron();
    fs = recoveryFs();
    bootstrap({ electron, fs, proc: buildMockProc(['node', 'src/main/index.js']) });
    await new Promise(resolve => setTimeout(resolve, 20));
  });

  test('a valid snapshot is peeked at, not deleted — recovery:clear is what removes it', async () => {
    fs._files[RECOVERY] = JSON.stringify({
      files: [{ name: 'a.md', content: '# A', at: 1 }, { name: 7, content: 'nope' }],
    });
    const res = await handler(electron, 'recovery:pop')();
    // Malformed entries are dropped; the good one survives verbatim — and the snapshot
    // itself survives an undecided prompt (crash/quit mid-dialog re-offers next launch).
    expect(res).toEqual({ ok: true, files: [{ name: 'a.md', content: '# A', at: 1 }] });
    expect(fs._recovery.unlink).not.toHaveBeenCalled();
    expect(fs._files[RECOVERY]).toBeDefined();

    expect(await handler(electron, 'recovery:clear')()).toEqual({ ok: true });
    expect(fs._files[RECOVERY]).toBeUndefined();
  });

  test('a corrupt snapshot is renamed aside as .corrupt, NOT deleted, and reported', async () => {
    fs._files[RECOVERY] = '{"files": [{"name": "a.md"';
    const res = await handler(electron, 'recovery:pop')();
    expect(res).toEqual({ ok: true, files: [], unreadable: 1 });
    expect(fs._recovery.unlink).not.toHaveBeenCalled();
    expect(fs._recovery.rename).toHaveBeenCalledWith(RECOVERY, `${RECOVERY}.corrupt`);
    expect(fs._files[`${RECOVERY}.corrupt`]).toBe('{"files": [{"name": "a.md"');
  });

  test('a missing snapshot is the normal launch path', async () => {
    expect(await handler(electron, 'recovery:pop')()).toEqual({ ok: true, files: [] });
    expect(fs._recovery.rename).not.toHaveBeenCalled();
    expect(fs._recovery.unlink).not.toHaveBeenCalled();
  });

  test('a valid-JSON payload with no files array yields no files', async () => {
    fs._files[RECOVERY] = '"just a string"';
    expect(await handler(electron, 'recovery:pop')()).toEqual({ ok: true, files: [] });
  });
});

// audit PERF-10: the autosave loop mirrors the recovery snapshot every 10s. An unchanged
// document set must not rewrite the file (and must still answer ok).
describe('recovery:snapshot skips identical rewrites (audit PERF-10)', () => {
  const RECOVERY = path.join('/mock/userData/userData', 'recovery', 'snapshot.json');
  let electron;
  let fs;

  beforeEach(async () => {
    const files = {};
    const readFile = vi.fn(async (p) => {
      if (p in files) return files[p];
      throw new Error('ENOENT');
    });
    fs = buildMockFs({
      readFileSync: (p) => {
        if (p in files) return files[p];
        throw new Error('ENOENT');
      },
      writeFileSync: vi.fn((p, c) => { files[p] = c; }),
      renameSync: vi.fn((a, b) => { files[b] = files[a]; delete files[a]; }),
      existsSync: (p) => p in files,
      promises: { ...buildMockFs().promises, readFile },
    });
    fs._files = files;
    electron = buildMockElectron();
    bootstrap({ electron, fs, proc: buildMockProc(['node', 'src/main/index.js']) });
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  test('an unchanged document set is reported unchanged and not rewritten', async () => {
    const files = [{ name: 'a.md', content: '# A' }, { name: 'b.md', content: '# B' }];
    const first = await handler(electron, 'recovery:snapshot')({}, files);
    expect(first).toEqual({ ok: true, count: 2 });
    const writesAfterFirst = fs.writeFileSync.mock.calls.length;
    expect(writesAfterFirst).toBeGreaterThan(0);

    // Same content, different `at` stamps (the payload is re-stamped every call).
    const second = await handler(electron, 'recovery:snapshot')({}, files);
    expect(second).toEqual({ ok: true, unchanged: true, count: 2 });
    expect(fs.writeFileSync.mock.calls.length).toBe(writesAfterFirst); // no second write
  });

  test('a changed document set IS rewritten', async () => {
    await handler(electron, 'recovery:snapshot')({}, [{ name: 'a.md', content: '# A' }]);
    const writesBefore = fs.writeFileSync.mock.calls.length;
    const res = await handler(electron, 'recovery:snapshot')({}, [{ name: 'a.md', content: '# A edited' }]);
    expect(res).toEqual({ ok: true, count: 1 });
    expect(fs.writeFileSync.mock.calls.length).toBeGreaterThan(writesBefore);
  });

  test('an unreadable/corrupt existing snapshot falls through to a normal write', async () => {
    fs._files[RECOVERY] = '{"files": [{"name": "a.md"'; // torn write
    const res = await handler(electron, 'recovery:snapshot')({}, [{ name: 'a.md', content: '# A' }]);
    expect(res).toEqual({ ok: true, count: 1 });
  });

  test('a malformed payload is still rejected before any read', async () => {
    expect(await handler(electron, 'recovery:snapshot')({}, 'nope')).toEqual({ error: 'invalid' });
  });
});

// Audit 2026-09-24 P3: closing a folder used to keep its session grant alive (the grant
// sets were add-only), so every document in it stayed readable/writable for the whole run.
describe('closeVault revokes the whole session grant', () => {
  test('after fs:closeVault, that vault documents read/write paths are unauthorized', async () => {
    const electron = buildMockElectron();
    const fs = buildMockFs({
      realpathSync: vi.fn((p) => p),
      statSync: vi.fn((p) => (p.endsWith('.md')
        ? { isFile: () => true, isDirectory: () => false, size: 12, mtimeMs: 10 }
        : { isFile: () => false, isDirectory: () => true, size: 0, mtimeMs: 10 })),
      readFileSync: vi.fn(() => 'a\r\n'),
      existsSync: vi.fn((p) => p.endsWith('.md')),
    });
    bootstrap({ electron, fs, proc: buildMockProc(['node', 'src/main/index.js']) });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const h = (name) => electron.ipcMain.handle.mock.calls.find((c) => c[0] === name)?.[1];

    electron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/vault'] });
    const picked = await h('dialog:openFolder')();
    fs.promises.readdir.mockResolvedValueOnce([{ name: 'a.md', isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false }]);
    fs.promises.lstat.mockResolvedValueOnce({ isSymbolicLink: () => false, isFile: () => true, size: 3, mtimeMs: 5 });
    const read = await h('fs:readVault')({ sender: electron._mockWin.webContents }, picked.vault.id);
    const docId = read.entries[0].documentId;
    expect(await h('fs:readFile')({}, docId)).toMatchObject({ content: 'a\n' });

    expect(await h('fs:closeVault')({}, picked.vault.id)).toEqual({ ok: true });
    expect(await h('fs:readFile')({}, docId)).toEqual({ error: 'unauthorized-capability' });
    expect(await h('fs:writeFile')({}, { documentId: docId, content: 'x' }))
      .toEqual({ error: 'unauthorized-capability' });
  });
});

// Audit 2026-09-26 SEC-01 (S-H2 residue): the single-document lanes (readDocumentCapability,
// fs:reopenDocument, the writeFile hash fallback) used to follow whatever the granted path
// NOW resolves to, with no extension re-test and no containment check — a granted file
// replaced by a symlink re-pinned authority over its target and read it into the renderer.
describe('symlinked grants are refused, not followed (SEC-01)', () => {
  const h = (electron, name) => electron.ipcMain.handle.mock.calls.find((c) => c[0] === name)?.[1];

  test('a standalone document that becomes a symlink is refused on read AND on reopen', async () => {
    let symlinkTarget = null;
    const files = {};
    const seeded = buildMockFs({
      realpathSync: vi.fn((p) => (symlinkTarget && String(p).replace(/\\/g, '/') === '/vault/a.md' ? symlinkTarget : p)),
      statSync: vi.fn((p) => (p.endsWith('.md') || p === '/secrets/credentials'
        ? { isFile: () => true, isDirectory: () => false, size: 12, mtimeMs: 10 }
        : { isFile: () => false, isDirectory: () => true, size: 0, mtimeMs: 10 })),
      readFileSync: vi.fn(() => '# note'),
      existsSync: vi.fn((p) => p.endsWith('.md') || p === '/secrets/credentials'),
      writeFileSync: vi.fn((p, c) => { files[p] = c; }),
      renameSync: vi.fn((a, b) => { files[b] = files[a]; delete files[a]; }),
      promises: { ...buildMockFs().promises },
    });
    seeded._files = files;
    const el = buildMockElectron();
    bootstrap({ electron: el, fs: seeded, proc: buildMockProc(['node', 'src/main/index.js']) });
    await new Promise((r) => setTimeout(r, 20));

    el.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/vault/a.md'] });
    const opened = await h(el, 'dialog:openFile')();
    expect(opened.canceled).toBe(false);

    symlinkTarget = '/secrets/creds.md';
    expect(await h(el, 'fs:readFile')({}, opened.documentId)).toEqual({ error: 'moved-document' });
    expect(await h(el, 'fs:reopenDocument')({}, opened.documentId)).toEqual({ error: 'moved-document' });
    symlinkTarget = '/secrets/credentials';
    expect(await h(el, 'fs:reopenDocument')({}, opened.documentId)).toEqual({ error: 'invalid-file' });
    expect(Object.values(files).join(' ')).not.toContain('/secrets/');
  });

  test('a vault document that resolves outside its vault root is refused', async () => {
    let symlinked = false;
    const files = {};
    const seeded = buildMockFs({
      realpathSync: vi.fn((p) => (symlinked && String(p).replace(/\\/g, '/') === '/vault/a.md' ? '/outside/x.md' : p)),
      statSync: vi.fn((p) => (p.endsWith('.md')
        ? { isFile: () => true, isDirectory: () => false, size: 3, mtimeMs: 10 }
        : { isFile: () => false, isDirectory: () => true, size: 0, mtimeMs: 10 })),
      readFileSync: vi.fn(() => 'a'),
      existsSync: vi.fn((p) => p.endsWith('.md')),
      writeFileSync: vi.fn((p, c) => { files[p] = c; }),
      renameSync: vi.fn((a, b) => { files[b] = files[a]; delete files[a]; }),
      promises: { ...buildMockFs().promises },
    });
    seeded._files = files;
    const el = buildMockElectron();
    bootstrap({ electron: el, fs: seeded, proc: buildMockProc(['node', 'src/main/index.js']) });
    await new Promise((r) => setTimeout(r, 20));

    el.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/vault'] });
    const picked = await h(el, 'dialog:openFolder')();
    seeded.promises.readdir.mockResolvedValueOnce([{ name: 'a.md', isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false }]);
    seeded.promises.lstat.mockResolvedValueOnce({ isSymbolicLink: () => false, isFile: () => true, size: 1 });
    const read = await h(el, 'fs:readVault')({ sender: el._mockWin.webContents }, picked.vault.id);
    const docId = read.entries[0].documentId;

    symlinked = true;
    expect(await h(el, 'fs:readFile')({}, docId)).toEqual({ error: 'unauthorized-path' });
    expect(await h(el, 'fs:reopenDocument')({}, docId)).toEqual({ error: 'unauthorized-path' });
  });

  test('the writeFile hash fallback never reads an oversized target (no freeze/OOM)', async () => {
    const files = {};
    const readCalls = [];
    const base = path.join('/mock/userData/userData');
    files[path.join(base, 'capabilities.json')] = JSON.stringify({
      version: 1, vaults: [],
      documents: [{ id: 'cap-old', path: '/vault/a.md' }],
    });
    files[path.join(base, 'settings.json')] = JSON.stringify({
      version: 5,
      recents: [{ name: 'a.md', path: '/vault/a.md', vaultId: '', documentId: 'cap-old', at: 1000 }],
    });
    const seeded = buildMockFs({
      realpathSync: vi.fn((p) => p),
      statSync: vi.fn((p) => (p.endsWith('.md')
        ? { isFile: () => true, isDirectory: () => false, size: 5 * 1024 * 1024 * 1024, mtimeMs: 10 }
        : { isFile: () => false, isDirectory: () => true, size: 0, mtimeMs: 10 })),
      readFileSync: vi.fn((p) => {
        readCalls.push(String(p));
        if (p in files) return files[p];
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      }),
      existsSync: vi.fn((p) => p.endsWith('.md')),
      writeFileSync: vi.fn((p, c) => { files[p] = c; }),
      renameSync: vi.fn((a, b) => { files[b] = files[a]; delete files[a]; }),
      promises: { ...buildMockFs().promises },
    });
    seeded._files = files;
    const el = buildMockElectron();
    bootstrap({ electron: el, fs: seeded, proc: buildMockProc(['node', 'src/main/index.js']) });
    await new Promise((r) => setTimeout(r, 20));

    // reopen grants session authority WITHOUT reading, so the write must hash disk
    // state itself — and the 5GB stat must stop it before any readFileSync.
    expect(await h(el, 'fs:reopenDocument')({}, 'cap-old')).toEqual({ ok: true });
    readCalls.length = 0;
    const res = await h(el, 'fs:writeFile')({}, {
      documentId: 'cap-old', content: 'fresh', baseHash: 'whatever',
      bom: false, eol: '\n', finalNewline: true, revision: 1,
    });
    expect(res).toMatchObject({ ok: true });
    expect(readCalls).toEqual([]);
  });
});
