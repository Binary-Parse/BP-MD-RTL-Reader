/**
 * workspace-incremental-refresh.test.js — H15 step 3, renderer side.
 *
 * Requirement: when a vault:changed event names a handful of notes the renderer re-reads
 * ONLY those (electronAPI.readVaultChanges) and merges them through mergeVaultSlice, with the
 * same outcome a full re-read would give: edits are never overwritten, a conflict is flagged,
 * a deleted note stays in the tree marked missing, a new note appears, other folders are not
 * touched. Whenever the shortcut cannot be trusted (many files, a folder event, any error,
 * an old bridge) it falls back to the full readVault.
 */
import { describe, expect, test, vi } from 'vitest';
import {
  createWorkspaceController,
  completeIncrementalSlice,
  mergeVaultSlice,
} from '../../src/renderer/components/workspace-controller.js';

function setup({ files, readVaultChanges, readVault, activeFile = null }) {
  const state = { files, activeFile, vaultName: 'Vault', recents: [] };
  const calls = { toasts: [], renderFile: [], renderTree: 0, renderTabs: 0 };
  const electronAPI = {};
  if (readVaultChanges) electronAPI.readVaultChanges = readVaultChanges;
  if (readVault) electronAPI.readVault = readVault;
  const controller = createWorkspaceController({
    state,
    hostWindow: { electronAPI },
    hostDocument: { createElement: vi.fn() },
    fileInput: { click: vi.fn() },
    showToast: (...a) => calls.toasts.push(a),
    renderFile: (i) => calls.renderFile.push(i),
    renderTree: () => { calls.renderTree++; },
    renderTabs: () => { calls.renderTabs++; },
  });
  controller.setVaultIdentity('v', 1);
  return { state, calls, controller, electronAPI };
}
const note = (path, content, hash, extra = {}) => ({
  name: path.split('/').pop(), path, content, savedContent: content, meta: { hash }, vaultId: 'v', documentId: `cap-${path}`, dirty: false, ...extra,
});
const entry = (relPath, content, hash) => ({
  name: relPath.split('/').pop(), relPath, content, meta: { hash }, documentId: `cap-${relPath}`,
});
const fullReadResult = (entries) => ({ vault: { id: 'v', name: 'Vault', generation: 2 }, entries, skipped: {} });
const partialResult = (entries) => ({ vault: { id: 'v', name: 'Vault', generation: 1 }, entries, skipped: {} });

describe('handleVaultChanged — incremental path', () => {
  test('asks only for the changed notes and never walks the folder', async () => {
    const readVaultChanges = vi.fn(async () => partialResult([entry('b.md', 'B2', 'hb2')]));
    const readVault = vi.fn();
    const t = setup({ files: [note('a.md', 'A', 'ha'), note('b.md', 'B', 'hb')], readVaultChanges, readVault });
    await t.controller.handleVaultChanged({ vaultId: 'v', generation: 1, files: ['b.md'] });
    expect(readVaultChanges).toHaveBeenCalledTimes(1);
    expect(readVaultChanges).toHaveBeenCalledWith('v', ['b.md']);
    expect(readVault).not.toHaveBeenCalled();
  });

  test('the changed note adopts the disk content; every other note is the very same object', async () => {
    const files = [note('a.md', 'A', 'ha'), note('b.md', 'B', 'hb'), note('c.md', 'C', 'hc')];
    const [a, , c] = files;
    const t = setup({ files, readVaultChanges: async () => partialResult([entry('b.md', 'B2', 'hb2')]), readVault: vi.fn() });
    await t.controller.handleVaultChanged({ vaultId: 'v', generation: 1, files: ['b.md'] });
    expect(t.state.files.map((f) => f.path)).toEqual(['a.md', 'b.md', 'c.md']);
    expect(t.state.files[0]).toBe(a);
    expect(t.state.files[2]).toBe(c);
    expect(t.state.files[1]).toMatchObject({ content: 'B2', meta: { hash: 'hb2' }, conflict: false });
    expect(t.state.files.some((f) => f.missing)).toBe(false);
  });

  test('a dirty note whose disk copy changed is flagged as a conflict, its edits kept', async () => {
    const files = [note('a.md', 'my unsaved edits', 'ha', { dirty: true })];
    const t = setup({ files, activeFile: 0, readVaultChanges: async () => partialResult([entry('a.md', 'changed elsewhere', 'ha2')]), readVault: vi.fn() });
    await t.controller.handleVaultChanged({ vaultId: 'v', generation: 1, files: ['a.md'] });
    expect(t.state.files[0]).toMatchObject({ content: 'my unsaved edits', dirty: true, conflict: true, diskContent: 'changed elsewhere' });
    expect(t.calls.toasts.map((x) => x[1])).toContain('error');
    expect(t.calls.renderFile).toEqual([0]);
  });

  test('an unchanged dirty note elsewhere in the folder is not flagged', async () => {
    const files = [note('a.md', 'edits', 'ha', { dirty: true }), note('b.md', 'B', 'hb')];
    const t = setup({ files, activeFile: 1, readVaultChanges: async () => partialResult([entry('b.md', 'B2', 'hb2')]), readVault: vi.fn() });
    await t.controller.handleVaultChanged({ vaultId: 'v', generation: 1, files: ['b.md'] });
    expect(!!t.state.files[0].conflict).toBe(false);
    expect(t.state.files[0].content).toBe('edits');
  });

  test('a note that vanished (named in the event, absent from the answer) stays in the tree marked missing', async () => {
    const files = [note('a.md', 'A', 'ha'), note('b.md', 'B', 'hb')];
    const t = setup({ files, readVaultChanges: async () => partialResult([]), readVault: vi.fn() });
    await t.controller.handleVaultChanged({ vaultId: 'v', generation: 1, files: ['b.md'] });
    expect(t.state.files.map((f) => [f.path, !!f.missing])).toEqual([['a.md', false], ['b.md', true]]);
    expect(t.state.files[0]).toBe(files[0]);
  });

  test('a note that was already missing and is not in the event stays missing (not resurrected)', async () => {
    const files = [note('a.md', 'A', 'ha'), note('gone.md', 'G', 'hg', { missing: true })];
    const t = setup({ files, readVaultChanges: async () => partialResult([entry('a.md', 'A2', 'ha2')]), readVault: vi.fn() });
    await t.controller.handleVaultChanged({ vaultId: 'v', generation: 1, files: ['a.md'] });
    expect(t.state.files.find((f) => f.path === 'gone.md').missing).toBe(true);
  });

  test('a missing note that comes back is live again', async () => {
    const files = [note('b.md', 'B', 'hb', { missing: true })];
    const t = setup({ files, readVaultChanges: async () => partialResult([entry('b.md', 'B', 'hb')]), readVault: vi.fn() });
    await t.controller.handleVaultChanged({ vaultId: 'v', generation: 1, files: ['b.md'] });
    expect(t.state.files[0].missing).toBe(false);
  });

  test('a changed note inside a sub-folder is replaced in place (matched by its relative path, not its file name)', async () => {
    const files = [note('sub/b.md', 'B', 'hb'), note('b.md', 'top-level B', 'ht')];
    const t = setup({ files, readVaultChanges: async () => partialResult([entry('sub/b.md', 'B2', 'hb2')]), readVault: vi.fn() });
    await t.controller.handleVaultChanged({ vaultId: 'v', generation: 1, files: ['sub/b.md'] });
    expect(t.state.files.map((f) => [f.path, f.content])).toEqual([['sub/b.md', 'B2'], ['b.md', 'top-level B']]);
  });

  test('a brand-new note appears next to the existing ones', async () => {
    const files = [note('a.md', 'A', 'ha')];
    const t = setup({ files, readVaultChanges: async () => partialResult([entry('sub/new.md', '# new', 'hn')]), readVault: vi.fn() });
    await t.controller.handleVaultChanged({ vaultId: 'v', generation: 1, files: ['sub/new.md'] });
    expect(t.state.files.map((f) => f.path)).toEqual(['a.md', 'sub/new.md']);
    expect(t.state.files[1]).toMatchObject({ vaultId: 'v', content: '# new' });
    expect(t.state.files[0]).toBe(files[0]);
  });

  test('other folders and loose files are untouched', async () => {
    const other = note('x.md', 'X', 'hx', { vaultId: 'other' });
    const loose = { name: 'loose.md', path: 'loose.md', content: 'L', vaultId: null, meta: {} };
    const t = setup({ files: [other, note('a.md', 'A', 'ha'), loose], readVaultChanges: async () => partialResult([entry('a.md', 'A2', 'ha2')]), readVault: vi.fn() });
    await t.controller.handleVaultChanged({ vaultId: 'v', generation: 1, files: ['a.md'] });
    expect(t.state.files).toContain(other);
    expect(t.state.files).toContain(loose);
  });

  test('the active tab keeps pointing at the same note after the merge', async () => {
    const files = [note('a.md', 'A', 'ha'), note('b.md', 'B', 'hb')];
    const t = setup({ files, activeFile: 1, readVaultChanges: async () => partialResult([entry('b.md', 'B2', 'hb2')]), readVault: vi.fn() });
    await t.controller.handleVaultChanged({ vaultId: 'v', generation: 1, files: ['b.md'] });
    expect(t.state.files[t.state.activeFile].path).toBe('b.md');
    expect(t.state.files[t.state.activeFile].content).toBe('B2');
    expect(t.calls.renderFile).toEqual([1]); // silent reload of the active note re-renders it
  });

  test('50 changed notes still go the incremental way', async () => {
    const names = Array.from({ length: 50 }, (_, i) => `n${i}.md`);
    const readVaultChanges = vi.fn(async () => partialResult([]));
    const readVault = vi.fn();
    const t = setup({ files: names.map((n) => note(n, n, `h${n}`)), readVaultChanges, readVault });
    await t.controller.handleVaultChanged({ vaultId: 'v', generation: 1, files: names });
    expect(readVaultChanges).toHaveBeenCalledTimes(1);
    expect(readVault).not.toHaveBeenCalled();
  });

  test('keeps the generation (the main watcher was not replaced)', async () => {
    const t = setup({ files: [note('a.md', 'A', 'ha')], readVaultChanges: async () => partialResult([entry('a.md', 'A2', 'ha2')]), readVault: vi.fn() });
    await t.controller.handleVaultChanged({ vaultId: 'v', generation: 1, files: ['a.md'] });
    // a second event for the SAME generation is still accepted
    await t.controller.handleVaultChanged({ vaultId: 'v', generation: 1, files: ['a.md'] });
    expect(t.state.files[0].content).toBe('A2');
  });
});

describe('handleVaultChanged — falls back to the full read', () => {
  const full = () => vi.fn(async () => fullReadResult([entry('a.md', 'FULL', 'hf')]));
  async function run(event, extra = {}) {
    const readVaultChanges = extra.readVaultChanges === undefined ? vi.fn(async () => partialResult([])) : extra.readVaultChanges;
    const readVault = full();
    const t = setup({ files: [note('a.md', 'A', 'ha')], readVaultChanges, readVault });
    await t.controller.handleVaultChanged({ vaultId: 'v', generation: 1, ...event });
    return { t, readVaultChanges, readVault };
  }

  test.each([
    ['no file list', {}],
    ['an empty file list', { files: [] }],
    ['a non-array file list', { files: 'a.md' }],
  ])('%s', async (_l, event) => {
    const { readVaultChanges, readVault, t } = await run(event);
    expect(readVaultChanges).not.toHaveBeenCalled();
    expect(readVault).toHaveBeenCalledTimes(1);
    expect(t.state.files[0].content).toBe('FULL');
  });

  test('more than 50 changed notes', async () => {
    const files = Array.from({ length: 51 }, (_, i) => `n${i}.md`);
    const { readVaultChanges, readVault } = await run({ files });
    expect(readVaultChanges).not.toHaveBeenCalled();
    expect(readVault).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['a directory event (no note extension)', ['sub']],
    ['a note mixed with a directory event', ['a.md', 'sub']],
    ['a non-string entry', ['a.md', 7]],
    ['a txt file', ['a.txt']],
    ['a nested array that stringifies like a note', [['a.md']]],
    ['a name that merely ends in the letters md', ['readmd']],
    ['a note extension in the middle of the name', ['a.md.png']],
    ['a longer extension', ['a.mdx']],
  ])('%s', async (_l, files) => {
    const { readVaultChanges, readVault } = await run({ files });
    expect(readVaultChanges).not.toHaveBeenCalled();
    expect(readVault).toHaveBeenCalledTimes(1);
  });

  test('an old bridge without readVaultChanges', async () => {
    const { readVault, t } = await run({ files: ['a.md'] }, { readVaultChanges: null });
    expect(readVault).toHaveBeenCalledTimes(1);
    expect(t.state.files[0].content).toBe('FULL');
  });

  test.each([
    ['an error result', { error: 'invalid-paths' }],
    ['a truncated refusal', { error: 'truncated' }],
    ['null', null],
    ['entries that are not an array', { vault: { id: 'v' }, entries: 'nope' }],
    ['no entries', { vault: { id: 'v' } }],
    ['a bare array (legacy shape)', [{ relPath: 'a.md' }]],
  ])('the incremental call answers %s', async (_l, answer) => {
    const readVaultChanges = vi.fn(async () => answer);
    const { readVault, t } = await run({ files: ['a.md'] }, { readVaultChanges });
    expect(readVaultChanges).toHaveBeenCalledTimes(1);
    expect(readVault).toHaveBeenCalledTimes(1);
    expect(t.state.files[0].content).toBe('FULL');
  });

  test('the incremental call throws', async () => {
    const readVaultChanges = vi.fn(async () => { throw new Error('ipc down'); });
    const { readVault, t } = await run({ files: ['a.md'] }, { readVaultChanges });
    expect(readVault).toHaveBeenCalledTimes(1);
    expect(t.state.files[0].content).toBe('FULL');
    expect(t.calls.toasts).toEqual([]); // the fallback worked: nothing to tell the user
  });

  test('both calls failing still reports the stale tree once', async () => {
    const t = setup({
      files: [note('a.md', 'A', 'ha')],
      readVaultChanges: async () => { throw new Error('x'); },
      readVault: async () => { throw new Error('y'); },
    });
    await t.controller.handleVaultChanged({ vaultId: 'v', generation: 1, files: ['a.md'] });
    await t.controller.handleVaultChanged({ vaultId: 'v', generation: 1, files: ['a.md'] });
    expect(t.calls.toasts).toHaveLength(1);
    expect(t.calls.toasts[0][1]).toBe('info');
  });

  test('a stale generation is ignored before either call', async () => {
    const readVaultChanges = vi.fn();
    const readVault = vi.fn();
    const t = setup({ files: [note('a.md', 'A', 'ha')], readVaultChanges, readVault });
    await t.controller.handleVaultChanged({ vaultId: 'v', generation: 99, files: ['a.md'] });
    expect(readVaultChanges).not.toHaveBeenCalled();
    expect(readVault).not.toHaveBeenCalled();
  });

  test('an answer that arrives after the folder was re-read (new generation) is discarded', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const readVaultChanges = vi.fn(async () => { await gate; return partialResult([entry('a.md', 'LATE', 'hl')]); });
    const t = setup({ files: [note('a.md', 'A', 'ha')], readVaultChanges, readVault: vi.fn() });
    const pending = t.controller.handleVaultChanged({ vaultId: 'v', generation: 1, files: ['a.md'] });
    t.controller.setVaultIdentity('v', 2); // a full re-read happened meanwhile
    release();
    await pending;
    expect(t.state.files[0].content).toBe('A');
  });
});

describe('completeIncrementalSlice', () => {
  test('keeps the existing order, swaps in fresh entries, appends new ones, drops vanished ones', () => {
    const existing = [note('a.md', 'A', 'ha'), note('b.md', 'B', 'hb'), note('c.md', 'C', 'hc')];
    const out = completeIncrementalSlice(existing, 'v', ['b.md', 'c.md', 'z.md'], [entry('b.md', 'B2', 'hb2'), entry('z.md', 'Z', 'hz')]);
    expect(out.map((e) => e.relPath)).toEqual(['a.md', 'b.md', 'z.md']);
    expect(out[1].content).toBe('B2');
    expect(out[0]).toMatchObject({ name: 'a.md', relPath: 'a.md', content: 'A', meta: { hash: 'ha' }, documentId: 'cap-a.md' });
  });

  test('an entry that carries only a name (legacy shape) is matched by that name', () => {
    const existing = [note('a.md', 'A', 'ha')];
    const out = completeIncrementalSlice(existing, 'v', ['a.md'], [{ name: 'a.md', content: 'A2', meta: { hash: 'h2' } }]);
    expect(out).toHaveLength(1);
    expect(out[0].content).toBe('A2');
  });

  test('ignores other folders and already-missing notes', () => {
    const existing = [note('a.md', 'A', 'ha'), note('x.md', 'X', 'hx', { vaultId: 'other' }), note('m.md', 'M', 'hm', { missing: true })];
    expect(completeIncrementalSlice(existing, 'v', [], []).map((e) => e.relPath)).toEqual(['a.md']);
  });

  test('merging the completed list leaves every unchanged note as the same object', () => {
    const existing = [note('a.md', 'A', 'ha'), note('b.md', 'B', 'hb', { dirty: true, content: 'dirty buffer' })];
    const merged = mergeVaultSlice(existing, 'v', completeIncrementalSlice(existing, 'v', [], []));
    expect(merged[0]).toBe(existing[0]);
    expect(merged[1]).toBe(existing[1]);
  });

  test('a note with no hash baseline is still left alone (content compare on itself)', () => {
    const noHash = { name: 'a.md', path: 'a.md', content: 'A\r\nB', vaultId: 'v', meta: {}, dirty: true };
    const merged = mergeVaultSlice([noHash], 'v', completeIncrementalSlice([noHash], 'v', [], []));
    expect(merged[0]).toBe(noHash);
  });
});
