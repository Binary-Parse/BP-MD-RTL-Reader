/**
 * b3-annotations-survive.test.js — defect B3: highlights and margin notes were deleted for good.
 *
 * Requirements (owner decision 2026-10-10: stop deleting, keep the key format):
 *   R1  nothing ever removes a stored annotation except the user clearing that note's list;
 *   R2  a note that has annotations keeps its identity: the capability record its key names is
 *       never pruned, so reopening the same file or folder resolves to the same key;
 *   R3  a failed settings load prunes nothing;
 *   R4  a corrupt `annotations.json` / `settings.json` is kept beside the new one as
 *       `<name>.corrupt-<timestamp>`, never overwritten;
 *   R5  if the damaged file can be neither read nor set aside, the store refuses to write over it.
 */
import { describe, test, expect, vi } from 'vitest';
import path from 'node:path';
import { readJsonFileChecked, setAsideCorruptFile } from '../../src/main/json-store.js';
import { createAnnotationsStore } from '../../src/main/annotations-store.js';
import { createSettingsStore, defaultSettings } from '../../src/main/settings.js';
import { bootstrap } from '../../src/main/index.js';
import { buildMockElectron, buildMockFs, buildMockProc } from './main-harness.js';

const NOW = Date.UTC(2026, 9, 11, 8, 55, 0, 123); // 2026-10-11T08:55:00.123Z
const STAMP = '20261011T085500123Z';

function memFs(seed = {}) {
  const files = { ...seed };
  return {
    _files: files,
    readFileSync(file) {
      if (!(file in files)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return files[file];
    },
    writeFileSync: vi.fn((file, content) => { files[file] = content; }),
    renameSync: vi.fn((from, to) => {
      if (!(from in files)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      files[to] = files[from];
      delete files[from];
    }),
  };
}
const hl = (over = {}) => ({
  id: 'h1', text: 'the highlighted words', note: 'margin note', at: 1000,
  anchor: { headingSlug: 'intro', ordinal: 0 }, ...over,
});
const isObject = (value) => !!value && typeof value === 'object';

describe('readJsonFileChecked', () => {
  const FILE = '/ud/thing.json';
  test('a good file is ok with its value', () => {
    expect(readJsonFileChecked(memFs({ [FILE]: '{"a":1}' }), FILE, isObject)).toEqual({ status: 'ok', value: { a: 1 } });
  });
  test('an absent file is missing, and so is a read error that carries no code', () => {
    expect(readJsonFileChecked(memFs(), FILE, isObject)).toEqual({ status: 'missing' });
    const bare = { readFileSync: () => { throw new Error('gone'); } };
    expect(readJsonFileChecked(bare, FILE, isObject)).toEqual({ status: 'missing' });
  });
  test('a file that exists but cannot be read is unreadable, not missing', () => {
    for (const code of ['EACCES', 'EBUSY', 'EIO', 'EPERM']) {
      const fs = { readFileSync: () => { throw Object.assign(new Error(code), { code }); } };
      expect(readJsonFileChecked(fs, FILE, isObject), code).toEqual({ status: 'unreadable' });
    }
  });
  test('torn JSON and an unacceptable shape are both corrupt', () => {
    expect(readJsonFileChecked(memFs({ [FILE]: '{"a":' }), FILE, isObject)).toEqual({ status: 'corrupt' });
    expect(readJsonFileChecked(memFs({ [FILE]: '' }), FILE, isObject)).toEqual({ status: 'corrupt' });
    expect(readJsonFileChecked(memFs({ [FILE]: '"text"' }), FILE, isObject)).toEqual({ status: 'corrupt' });
    expect(readJsonFileChecked(memFs({ [FILE]: 'null' }), FILE, isObject)).toEqual({ status: 'corrupt' });
  });
});

describe('setAsideCorruptFile', () => {
  const FILE = '/ud/thing.json';
  test('renames the file to <name>.corrupt-<UTC timestamp> and returns the new path', () => {
    const fs = memFs({ [FILE]: 'damaged bytes' });
    expect(setAsideCorruptFile(fs, FILE, NOW)).toBe(`${FILE}.corrupt-${STAMP}`);
    expect(fs._files).toEqual({ [`${FILE}.corrupt-${STAMP}`]: 'damaged bytes' });
  });
  test('a failed rename returns null and leaves the file where it was', () => {
    const fs = memFs({ [FILE]: 'damaged bytes' });
    fs.renameSync.mockImplementationOnce(() => { throw new Error('EPERM'); });
    expect(setAsideCorruptFile(fs, FILE, NOW)).toBeNull();
    expect(fs._files).toEqual({ [FILE]: 'damaged bytes' });
  });
});

describe('annotations store never deletes (R1, R4, R5)', () => {
  const FILE = path.posix.join('/user', 'annotations.json');
  const store = (fs) => createAnnotationsStore({ fs, path: path.posix, userDataDir: '/user', now: () => NOW });

  test('R1: the store has no way to drop keys in bulk', () => {
    const s = store(memFs());
    expect(s.pruneOrphanDocKeys).toBeUndefined();
    expect(Object.keys(s).filter((name) => /prune|purge|clear|delete|remove/i.test(name))).toEqual([]);
  });

  test('R2: referencedIds lists the vault and document ids the stored keys name', () => {
    const fs = memFs();
    const s = store(fs);
    expect(s.referencedIds()).toEqual({ vaultIds: [], documentIds: [] });
    s.put('doc:cap-d1', [hl()]);
    s.put('doc:cap-d2', [hl({ id: 'h2' })]);
    s.put('vault:cap-v1 a.md', [hl({ id: 'h3' })]);
    s.put('vault:cap-v1 sub/b c.md', [hl({ id: 'h4' })]);
    s.put('vault:cap-v2 x.md', [hl({ id: 'h5' })]);
    s.put('loose:C:/notes/z.md', [hl({ id: 'h6' })]);
    s.put('loose:C:/my notes/z.md', [hl({ id: 'h6b' })]); // a path with a space names no vault
    s.put('vault:mangled', [hl({ id: 'h7' })]);
    s.put('vault: a.md', [hl({ id: 'h7b' })]);            // an empty vault id names nothing
    s.put('doc:', [hl({ id: 'h8' })]);
    expect(s.referencedIds()).toEqual({ vaultIds: ['cap-v1', 'cap-v2'], documentIds: ['cap-d1', 'cap-d2'] });
    // a fresh instance reads the same ids from disk
    expect(store(fs).referencedIds()).toEqual({ vaultIds: ['cap-v1', 'cap-v2'], documentIds: ['cap-d1', 'cap-d2'] });
    // clearing a note's list is the user's own action and releases its id
    s.put('doc:cap-d2', []);
    expect(s.referencedIds().documentIds).toEqual(['cap-d1']);
  });

  test('R2: only keys that really hold highlights are loaded, kept and reported', () => {
    const fs = memFs({
      [FILE]: JSON.stringify({
        version: 1,
        docs: {
          'doc:cap-good': { highlights: [hl()] },
          'doc:cap-empty': { highlights: [] },          // nothing to protect
          '': { highlights: [hl({ id: 'h2' })] },       // no key at all
          [`doc:${'x'.repeat(600)}`]: { highlights: [hl({ id: 'h3' })] }, // over the key cap
        },
      }),
    });
    const s = store(fs);
    expect(s.referencedIds()).toEqual({ vaultIds: [], documentIds: ['cap-good'] });
    const loaded = s.load();
    expect(loaded.version).toBe(1);
    expect([...loaded.docs.keys()]).toEqual(['doc:cap-good']);
    expect(s.load()).toEqual(loaded); // a second call is the same answer, not a re-read
    s.put('doc:cap-new', [hl({ id: 'h4' })]);
    expect(Object.keys(JSON.parse(fs._files[FILE]).docs)).toEqual(['doc:cap-good', 'doc:cap-new']);
  });

  test('R2: a failed first save leaves the note unreferenced', () => {
    const fs = memFs();
    const s = store(fs);
    fs.writeFileSync.mockImplementationOnce(() => { throw new Error('ENOSPC'); });
    expect(s.put('doc:cap-1', [hl()])).toEqual({ error: 'write-failed' });
    expect(s.referencedIds()).toEqual({ vaultIds: [], documentIds: [] });
    expect([...s.load().docs.keys()]).toEqual([]);
  });

  test('the size cap is inclusive: a file of exactly the cap is saved, one byte more is refused', () => {
    const probe = store(memFs());
    probe.put('doc:cap-1', [hl()]);
    const exact = probe.sizeInBytes();
    const at = (maxBytes) => createAnnotationsStore({ fs: memFs(), path: path.posix, userDataDir: '/user', maxBytes });
    expect(at(exact).put('doc:cap-1', [hl()])).toEqual({ ok: true, count: 1 });
    expect(at(exact - 1).put('doc:cap-1', [hl()])).toEqual({ error: 'too-large' });
  });

  test('loadStatus reports what the first read found', () => {
    expect(store(memFs()).loadStatus()).toBe('missing');
    expect(store(memFs({ [FILE]: JSON.stringify({ version: 1, docs: {} }) })).loadStatus()).toBe('ok');
    expect(store(memFs({ [FILE]: '{"version": 1, "docs": {"a":' })).loadStatus()).toBe('corrupt');
    expect(store(memFs({ [FILE]: JSON.stringify({ version: 1, docs: 'not a map' }) })).loadStatus()).toBe('corrupt');
    const locked = memFs();
    locked.readFileSync = () => { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); };
    expect(store(locked).loadStatus()).toBe('unreadable');
  });

  test('the file is read once: the first finding stands after the damaged file was moved away', () => {
    const fs = memFs({ [FILE]: '{"version": 1, "docs": {"a":' });
    const read = vi.spyOn(fs, 'readFileSync');
    const s = store(fs);
    expect(s.loadStatus()).toBe('corrupt');
    s.get('doc:cap-1');
    s.referencedIds();
    expect(s.loadStatus()).toBe('corrupt'); // a re-read would now say "missing"
    expect(read).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['torn JSON', '{"version": 1, "docs": {"doc:cap-1": {"highlights": [{"id":"h1","te'],
    ['an empty file', ''],
    ['a newer format version', JSON.stringify({ version: 2, docs: { 'doc:cap-1': { highlights: [hl()] } } })],
    ['a foreign shape', '"just a string"'],
  ])('R4: %s is set aside as annotations.json.corrupt-<timestamp> before anything is written', (_name, damaged) => {
    const fs = memFs({ [FILE]: damaged });
    const s = store(fs);
    expect(s.get('doc:cap-1')).toEqual({ highlights: [] });
    expect(fs._files[`${FILE}.corrupt-${STAMP}`]).toBe(damaged);
    expect(FILE in fs._files).toBe(false);
    // a new highlight starts a new file; the damaged one is still there, byte for byte
    expect(s.put('doc:cap-9', [hl()])).toEqual({ ok: true, count: 1 });
    expect(fs._files[`${FILE}.corrupt-${STAMP}`]).toBe(damaged);
    expect(JSON.parse(fs._files[FILE]).docs).toEqual({ 'doc:cap-9': { highlights: [hl()] } });
  });

  test('R4: a good file is never set aside', () => {
    const good = JSON.stringify({ version: 1, docs: { 'doc:cap-1': { highlights: [hl()] } } });
    const fs = memFs({ [FILE]: good });
    expect(store(fs).get('doc:cap-1').highlights).toEqual([hl()]);
    expect(fs.renameSync).not.toHaveBeenCalled();
    expect(Object.keys(fs._files)).toEqual([FILE]);
  });

  test('R5: a damaged file that cannot be set aside is never overwritten', () => {
    const damaged = '{"version": 1, "docs": {';
    const fs = memFs({ [FILE]: damaged });
    fs.renameSync.mockImplementation(() => { throw new Error('EPERM'); });
    const s = store(fs);
    expect(s.get('doc:cap-1')).toEqual({ highlights: [] });
    expect(s.put('doc:cap-1', [hl()])).toEqual({ error: 'store-unreadable' });
    expect(s.get('doc:cap-1')).toEqual({ highlights: [] }); // memory did not move either
    expect(fs.writeFileSync).not.toHaveBeenCalled();
    expect(fs._files).toEqual({ [FILE]: damaged });
  });

  test('R5: a file that exists but cannot be read is never overwritten', () => {
    const fs = memFs({ [FILE]: 'bytes we cannot read' });
    fs.readFileSync = () => { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); };
    const s = store(fs);
    expect(s.get('doc:cap-1')).toEqual({ highlights: [] });
    expect(s.put('doc:cap-1', [hl()])).toEqual({ error: 'store-unreadable' });
    expect(fs.writeFileSync).not.toHaveBeenCalled();
    expect(fs.renameSync).not.toHaveBeenCalled();
    expect(fs._files).toEqual({ [FILE]: 'bytes we cannot read' });
  });
});

describe('settings store keeps a corrupt file (R3, R4)', () => {
  const FILE = path.posix.join('/ud', 'settings.json');
  const store = (fs) => createSettingsStore({ fs, path: path.posix, userDataDir: '/ud', now: () => NOW });

  test('a good file loads with status ok and is left alone', () => {
    const fs = memFs({ [FILE]: JSON.stringify({ ...defaultSettings(), theme: 'sepia' }) });
    const s = store(fs);
    expect(s.loadStatus()).toBeNull(); // nothing read yet
    expect(s.load().theme).toBe('sepia');
    expect(s.loadStatus()).toBe('ok');
    expect(fs.renameSync).not.toHaveBeenCalled();
  });

  test('a missing file gives defaults with status missing', () => {
    const s = store(memFs());
    expect(s.load()).toEqual(defaultSettings());
    expect(s.loadStatus()).toBe('missing');
  });

  test.each([
    ['truncated JSON', '{"theme":"sepia","recents":[{"name":"a.md"'],
    ['an empty file', ''],
    ['an array', '[]'],
    ['a bare value', '7'],
    ['null', 'null'],
  ])('R4: %s gives defaults, status corrupt, and the file is kept as settings.json.corrupt-<timestamp>', (_name, damaged) => {
    const fs = memFs({ [FILE]: damaged });
    const s = store(fs);
    expect(s.load()).toEqual(defaultSettings());
    expect(s.loadStatus()).toBe('corrupt');
    expect(fs._files[`${FILE}.corrupt-${STAMP}`]).toBe(damaged);
    s.save({ ...defaultSettings(), theme: 'ink' });
    expect(fs._files[`${FILE}.corrupt-${STAMP}`]).toBe(damaged);
    expect(JSON.parse(fs._files[FILE]).theme).toBe('ink');
  });

  test('R3: corrupt stays the answer for this run, even after a later good load', () => {
    const fs = memFs({ [FILE]: '{ broken' });
    const s = store(fs);
    s.load();
    s.save(defaultSettings());
    expect(s.load()).toEqual(defaultSettings());
    expect(s.loadStatus()).toBe('corrupt');
  });

  test('a file that cannot be read gives defaults with status unreadable and is not renamed', () => {
    const fs = memFs({ [FILE]: 'x' });
    fs.readFileSync = () => { throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' }); };
    const s = store(fs);
    expect(s.load()).toEqual(defaultSettings());
    expect(s.loadStatus()).toBe('unreadable');
    expect(fs.renameSync).not.toHaveBeenCalled();
  });
});

// ── The boot path: registry prune + annotations, through the real bootstrap. ──────────────
describe('boot keeps annotated notes resolvable (R1, R2, R3)', () => {
  const BASE = path.join('/mock/userData/userData');
  const CAPS = path.join(BASE, 'capabilities.json');
  const SETTINGS = path.join(BASE, 'settings.json');
  const ANNOTATIONS = path.join(BASE, 'annotations.json');
  const handler = (electron, name) => electron.ipcMain.handle.mock.calls.find((c) => c[0] === name)?.[1];

  const registry = () => JSON.stringify({
    version: 1,
    vaults: [
      { id: 'cap-v-recent', path: '/v-recent', generation: 1 },
      { id: 'cap-v-annotated', path: '/v-annotated', generation: 1 },
      { id: 'cap-v-stale', path: '/v-stale', generation: 1 },
    ],
    documents: [
      { id: 'cap-d-recent', path: '/loose/recent.md', vaultId: null },
      { id: 'cap-d-annotated', path: '/loose/annotated.md', vaultId: null },
      { id: 'cap-d-stale', path: '/loose/stale.md', vaultId: null },
    ],
  });
  const annotated = () => JSON.stringify({
    version: 1,
    docs: {
      'doc:cap-d-annotated': { highlights: [hl()] },
      'vault:cap-v-annotated notes/a.md': { highlights: [hl({ id: 'h2' })] },
      'doc:cap-d-long-gone': { highlights: [hl({ id: 'h3' })] },
      'vault:cap-v-long-gone a.md': { highlights: [hl({ id: 'h4' })] },
    },
  });
  // Recents no longer mention the annotated note or folder: the user opened other things since.
  const settings = () => JSON.stringify({
    ...defaultSettings(),
    recents: [{ name: 'recent.md', path: 'recent.md', vaultId: 'cap-v-recent', documentId: 'cap-d-recent' }],
  });

  async function boot(seed) {
    const files = { ...seed };
    const fs = buildMockFs({
      readFileSync: (p) => { if (p in files) return files[p]; throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); },
      writeFileSync: vi.fn((p, c) => { files[p] = c; }),
      renameSync: vi.fn((a, b) => { files[b] = files[a]; delete files[a]; }),
      promises: { ...buildMockFs().promises },
    });
    const electron = buildMockElectron();
    bootstrap({ electron, fs, proc: buildMockProc(['node', 'src/main/index.js']) });
    await new Promise((r) => setTimeout(r, 20));
    return { files, electron };
  }
  const ids = (files) => {
    const parsed = JSON.parse(files[CAPS]);
    return { vaults: parsed.vaults.map((v) => v.id), documents: parsed.documents.map((d) => d.id) };
  };

  test('R2: the registry prune keeps the records annotations name, and still drops the rest', async () => {
    const { files } = await boot({ [CAPS]: registry(), [SETTINGS]: settings(), [ANNOTATIONS]: annotated() });
    expect(ids(files)).toEqual({
      vaults: ['cap-v-recent', 'cap-v-annotated'],
      documents: ['cap-d-recent', 'cap-d-annotated'],
    });
  });

  test('R2: an annotated standalone note that later joined a folder is kept together with that folder', async () => {
    const caps = JSON.stringify({
      version: 1,
      vaults: [
        { id: 'cap-v-joined', path: '/v-joined', generation: 1 },
        { id: 'cap-v-stale', path: '/v-stale', generation: 1 },
      ],
      documents: [{ id: 'cap-d-joined', path: path.join('/v-joined', 'n.md'), vaultId: 'cap-v-joined' }],
    });
    const notes = JSON.stringify({ version: 1, docs: { 'doc:cap-d-joined': { highlights: [hl()] } } });
    const { files } = await boot({ [CAPS]: caps, [SETTINGS]: settings(), [ANNOTATIONS]: notes });
    expect(ids(files)).toEqual({ vaults: ['cap-v-joined'], documents: ['cap-d-joined'] });
  });

  test('R1: no stored annotation is removed at boot or on first use, whatever the registry knows', async () => {
    const { files, electron } = await boot({ [CAPS]: registry(), [SETTINGS]: settings(), [ANNOTATIONS]: annotated() });
    for (const [key, id] of [
      ['doc:cap-d-annotated', 'h1'], ['vault:cap-v-annotated notes/a.md', 'h2'],
      ['doc:cap-d-long-gone', 'h3'], ['vault:cap-v-long-gone a.md', 'h4'],
    ]) {
      expect((await handler(electron, 'annotations:get')({}, key)).highlights.map((h) => h.id), key).toEqual([id]);
    }
    await handler(electron, 'annotations:put')({}, { docKey: 'doc:cap-d-recent', highlights: [hl({ id: 'h9' })] });
    expect(Object.keys(JSON.parse(files[ANNOTATIONS]).docs).sort()).toEqual([
      'doc:cap-d-annotated', 'doc:cap-d-long-gone', 'doc:cap-d-recent',
      'vault:cap-v-annotated notes/a.md', 'vault:cap-v-long-gone a.md',
    ]);
  });

  test.each([
    ['truncated', '{"recents":[{"name":"recent.md","vaultId":"cap-v-re'],
    ['empty', ''],
  ])('R3: a %s settings.json prunes nothing from the registry and keeps the damaged file', async (_name, damaged) => {
    const { files } = await boot({ [CAPS]: registry(), [SETTINGS]: damaged, [ANNOTATIONS]: annotated() });
    expect(files[CAPS]).toBe(registry()); // not rewritten at all
    const kept = Object.keys(files).filter((p) => p.startsWith(`${SETTINGS}.corrupt-`));
    expect(kept).toHaveLength(1);
    expect(files[kept[0]]).toBe(damaged);
    expect(JSON.parse(files[ANNOTATIONS])).toEqual(JSON.parse(annotated()));
  });

  test('R3: a missing settings.json prunes nothing either', async () => {
    const { files } = await boot({ [CAPS]: registry(), [ANNOTATIONS]: annotated() });
    expect(files[CAPS]).toBe(registry());
  });

  test('R3: settings truncated to a valid "{}" still keep what annotations name', async () => {
    const { files } = await boot({ [CAPS]: registry(), [SETTINGS]: '{}', [ANNOTATIONS]: annotated() });
    expect(ids(files)).toEqual({ vaults: ['cap-v-annotated'], documents: ['cap-d-annotated'] });
  });

  test.each([
    ['torn', '{"version":1,"docs":{"doc:cap-d-annot'],
    ['from a newer version', JSON.stringify({ version: 2, docs: {} })],
  ])('R2: when annotations.json is %s the ids it named are unknown, so the registry is not pruned', async (_name, damaged) => {
    const { files } = await boot({ [CAPS]: registry(), [SETTINGS]: settings(), [ANNOTATIONS]: damaged });
    expect(files[CAPS]).toBe(registry());
    const kept = Object.keys(files).filter((p) => p.startsWith(`${ANNOTATIONS}.corrupt-`));
    expect(kept).toHaveLength(1);
    expect(files[kept[0]]).toBe(damaged);
  });

  test('with good settings and no annotations file the registry is pruned to what settings name', async () => {
    const { files } = await boot({ [CAPS]: registry(), [SETTINGS]: settings() });
    expect(ids(files)).toEqual({ vaults: ['cap-v-recent'], documents: ['cap-d-recent'] });
  });
});
