/**
 * main-annotations-ipc.test.js — T5.1a. The two new channels, driven through the real
 * bootstrap with the shared mock harness (ipc-controller.js is a mutation-tier T1 file, so
 * each handler gets a success case and at least two rejection cases).
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';
import path from 'node:path';
import { bootstrap } from '../../src/main/index.js';
import { buildMockElectron, buildMockFs, buildMockProc } from './main-harness.js';

const handler = (electron, name) => electron.ipcMain.handle.mock.calls.find((c) => c[0] === name)?.[1];
const highlight = (over = {}) => ({
  id: 'h1', text: 'selected words', note: '', at: 1000,
  anchor: { headingSlug: 'intro', ordinal: 0 }, ...over,
});

describe('annotations IPC (T5.1a)', () => {
  let electron;
  let fs;

  beforeEach(async () => {
    const files = {};
    fs = buildMockFs({
      readFileSync: (p) => { if (p in files) return files[p]; throw new Error('ENOENT'); },
      writeFileSync: vi.fn((p, c) => { files[p] = c; }),
      renameSync: vi.fn((a, b) => { files[b] = files[a]; delete files[a]; }),
      promises: { ...buildMockFs().promises },
    });
    fs._files = files;
    electron = buildMockElectron();
    bootstrap({ electron, fs, proc: buildMockProc(['node', 'src/main/index.js']) });
    await new Promise((r) => setTimeout(r, 20));
  });

  test('annotations:put stores a highlight and annotations:get reads it back', async () => {
    expect(await handler(electron, 'annotations:put')({}, { docKey: 'doc:cap-1', highlights: [highlight()] }))
      .toEqual({ ok: true, count: 1 });
    expect(await handler(electron, 'annotations:get')({}, 'doc:cap-1')).toEqual({ highlights: [highlight()] });
    const onDisk = JSON.parse(fs._files[path.join('/mock/userData/userData', 'annotations.json')]);
    expect(onDisk.docs['doc:cap-1'].highlights).toHaveLength(1);
  });

  test('annotations:get on an unknown or missing key returns an empty list, and rejects a bad key', async () => {
    expect(await handler(electron, 'annotations:get')({}, 'doc:unknown')).toEqual({ highlights: [] });
    expect(await handler(electron, 'annotations:get')({}, '')).toEqual({ error: 'invalid-key' });
    expect(await handler(electron, 'annotations:get')({}, 7)).toEqual({ error: 'invalid-key' });
  });

  test('annotations:put rejects a malformed envelope, a bad key, and a malformed highlight', async () => {
    const put = handler(electron, 'annotations:put');
    // Bootstrap itself may persist settings/capabilities, so count writes from here.
    const writesBefore = fs.writeFileSync.mock.calls.length;
    // Envelope violations: no payload, not an object, missing/!non-string key, !non-array list.
    for (const payload of [null, 'nope', 7, {}, { docKey: 'doc:cap-1' }, { docKey: 'doc:cap-1', highlights: 'nope' }]) {
      expect(await put({}, payload), JSON.stringify(payload)).toEqual({ error: 'invalid' });
    }
    expect(await put({}, { docKey: '', highlights: [highlight()] })).toEqual({ error: 'invalid-key' });
    expect(await put({}, { docKey: 'doc:cap-1', highlights: [{ id: 'x' }] })).toEqual({ error: 'invalid-highlight' });
    expect(fs.writeFileSync.mock.calls.length).toBe(writesBefore); // nothing was persisted
  });

  test('the text cap is enforced end to end (a 5001-char selection is refused)', async () => {
    const res = await handler(electron, 'annotations:put')({}, {
      docKey: 'doc:cap-1', highlights: [highlight({ text: 'x'.repeat(5001) })],
    });
    expect(res).toEqual({ error: 'invalid-highlight' });
  });

  test('both channels are registered and exposed on the bridge', async () => {
    const { setupBridge } = await import('../../src/preload/index.js');
    const contextBridge = { exposeInMainWorld: vi.fn() };
    const ipcRenderer = { invoke: vi.fn(), on: vi.fn(), send: vi.fn() };
    setupBridge({ contextBridge, ipcRenderer });
    const api = contextBridge.exposeInMainWorld.mock.calls[0][1];
    expect(typeof api.annotationsGet).toBe('function');
    expect(typeof api.annotationsPut).toBe('function');
    api.annotationsGet('doc:cap-1');
    api.annotationsPut({ docKey: 'doc:cap-1', highlights: [] });
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('annotations:get', 'doc:cap-1');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('annotations:put', { docKey: 'doc:cap-1', highlights: [] });
  });

  test('the first annotations use prunes doc: keys orphaned by per-session vault grants (DATA-01)', async () => {
    const files = {};
    const base = path.join('/mock/userData/userData');
    files[path.join(base, 'capabilities.json')] = JSON.stringify({
      version: 1,
      vaults: [{ id: 'cap-v', path: '/notes', generation: 1 }],
      documents: [{ id: 'cap-live', path: '/notes/live.md' }],
    });
    files[path.join(base, 'settings.json')] = JSON.stringify({
      version: 5,
      recents: [{ name: 'live.md', path: '/notes/live.md', vaultId: 'cap-v', documentId: 'cap-live', at: 1000 }],
    });
    files[path.join(base, 'annotations.json')] = JSON.stringify({
      version: 1,
      docs: {
        'doc:cap-live': { highlights: [highlight()] },
        'doc:cap-dead': { highlights: [highlight({ id: 'h2' })] },
        'vault:cap-v a.md': { highlights: [highlight({ id: 'h3' })] },
      },
    });
    const seeded = buildMockFs({
      readFileSync: (p) => { if (p in files) return files[p]; throw new Error('ENOENT'); },
      writeFileSync: vi.fn((p, c) => { files[p] = c; }),
      renameSync: vi.fn((a, b) => { files[b] = files[a]; delete files[a]; }),
      promises: { ...buildMockFs().promises },
    });
    seeded._files = files;
    const el = buildMockElectron();
    bootstrap({ electron: el, fs: seeded, proc: buildMockProc(['node', 'src/main/index.js']) });
    await new Promise((r) => setTimeout(r, 20));

    expect(await handler(el, 'annotations:get')({}, 'doc:cap-live')).toEqual({ highlights: [highlight()] });
    expect(await handler(el, 'annotations:get')({}, 'doc:cap-dead')).toEqual({ highlights: [] });
    expect(await handler(el, 'annotations:get')({}, 'vault:cap-v a.md'))
      .toEqual({ highlights: [highlight({ id: 'h3' })] });
    const onDisk = JSON.parse(files[path.join(base, 'annotations.json')]);
    expect(onDisk.docs).toHaveProperty('doc:cap-live');
    expect(onDisk.docs).toHaveProperty('vault:cap-v a.md');
    expect(onDisk.docs).not.toHaveProperty('doc:cap-dead');
  });

  test('DATA-01: a vault highlight written in session 1 is re-found in session 2 under the rotated doc id', async () => {
    const { fileKey } = await import('../../src/renderer/session.js');
    const files = {};
    const vaultDir = '/mock/vault';
    files[path.join(vaultDir, 'a.md')] = '# Hello note';
    const dirent = { name: 'a.md', isFile: () => true, isDirectory: () => false };
    const mkFs = () => buildMockFs({
      readFileSync: (p) => { if (p in files) return files[p]; throw new Error('ENOENT'); },
      writeFileSync: vi.fn((p, c) => { files[p] = c; }),
      renameSync: vi.fn((a, b) => { files[b] = files[a]; delete files[a]; }),
      promises: {
        ...buildMockFs().promises,
        readdir: vi.fn(() => Promise.resolve([dirent])),
        readFile: (p) => (p in files ? Promise.resolve(files[p]) : Promise.reject(new Error('ENOENT'))),
      },
    });

    // One full app session: open the folder, read the vault, put a highlight under the
    // renderer's own key function. Everything main persists lands in `files` (the "disk").
    const runSession = async () => {
      const el = buildMockElectron();
      el.dialog.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [vaultDir] });
      bootstrap({ electron: el, fs: mkFs(), proc: buildMockProc(['node', 'src/main/index.js']) });
      await new Promise((r) => setTimeout(r, 20));
      const opened = await handler(el, 'dialog:openFolder')({});
      expect(opened.canceled).toBe(false);
      const vaultId = opened.vault.id;
      const read = await handler(el, 'fs:readVault')({}, vaultId);
      expect(read.entries).toHaveLength(1);
      const docId = read.entries[0].documentId;
      const file = { documentId: docId, vaultId, path: read.entries[0].relPath };
      return { el, vaultId, docId, key: fileKey(file) };
    };

    const s1 = await runSession();
    expect(await handler(s1.el, 'annotations:put')({}, { docKey: s1.key, highlights: [highlight()] }))
      .toEqual({ ok: true, count: 1 });
    // The renderer records the opened note as a recent — that settings reference is what
    // stops bootstrapSessionGrants' boot-time prune from wiping the vault grant.
    expect(await handler(s1.el, 'settings:set')({}, {
      recents: [{ name: 'vault', path: '/mock/vault', vaultId: s1.vaultId, documentId: null }],
    })).toEqual({ ok: true });
    const onDiskAfterS1 = JSON.parse(files[path.join('/mock/userData/userData', 'annotations.json')]);
    expect(Object.keys(onDiskAfterS1.docs)).toEqual([s1.key]);

    // Session 2: brand-new main state, same disk. The vault grant persists (same id),
    // the per-read document grant does not (new id) — a doc-keyed highlight would be gone.
    const s2 = await runSession();
    expect(s2.vaultId).toBe(s1.vaultId);
    expect(s2.docId).not.toBe(s1.docId);
    expect(s2.key).toBe(s1.key);
    expect(await handler(s2.el, 'annotations:get')({}, s2.key)).toEqual({ highlights: [highlight()] });

    const onDiskAfterS2 = JSON.parse(files[path.join('/mock/userData/userData', 'annotations.json')]);
    expect(Object.keys(onDiskAfterS2.docs)).toEqual([s1.key]); // no doc:cap-* orphan accreted
  });
});
