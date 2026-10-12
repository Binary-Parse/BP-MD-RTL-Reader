/**
 * workspace-external-reload-baseline.test.js — defect B6.
 *
 * Requirement (the spec, not the code): when a CLEAN open note is changed on disk by another
 * program, the app reloads the new text AND moves the file's saved baseline to that text.
 *   R1  after the reload: baseline == new disk text, the tab is clean and shows the new text
 *   R2  editing to ANY value different from the new disk text (including exactly the OLD text)
 *       makes the tab dirty
 *   R3  editing back to exactly the new disk text makes it clean again
 *   R4  a DIRTY tab keeps the user's text, is flagged as a conflict, and its baseline AND disk
 *       identity (hash) are not advanced, so a later save still detects the conflict
 *   R5  "Reload from disk" / "Keep my edits" acknowledge the disk text as the baseline
 *       (the tab-level resolve lives in app.js; this file proves the shared helper it calls)
 *   R6  identical on the full re-read path and the incremental readVaultChanges path
 */
import { describe, expect, test, vi } from 'vitest';
import { createWorkspaceController, mergeVaultSlice } from '../../src/renderer/components/workspace-controller.js';
import { applyEdit } from '../../src/renderer/components/dirty-state.js';

const note = (path, content, hash, extra = {}) => ({
  name: path.split('/').pop(), path, content, savedContent: content, meta: { hash }, vaultId: 'v', documentId: `cap-${path}`, dirty: false, ...extra,
});
const entry = (relPath, content, hash) => ({
  name: relPath.split('/').pop(), relPath, content, meta: { hash }, documentId: `cap-${relPath}`,
});
const read = (entries, generation = 1) => ({ vault: { id: 'v', name: 'Vault', generation }, entries, skipped: {} });

// One scenario driver per read path; both feed the SAME fresh disk entries through the real
// handleVaultChanged so R6 holds by construction rather than by a copy of the assertions.
const PATHS = [
  ['full re-read', (freshEntries) => ({
    api: { readVault: vi.fn(async () => read(freshEntries)) },
    event: { vaultId: 'v', generation: 1 },
  })],
  ['incremental readVaultChanges', (freshEntries) => ({
    api: { readVault: vi.fn(), readVaultChanges: vi.fn(async () => read(freshEntries)) },
    event: { vaultId: 'v', generation: 1, files: freshEntries.map((e) => e.relPath) },
  })],
];

async function externalChange(files, freshEntries, makeScenario, activeFile = 0) {
  const { api, event } = makeScenario(freshEntries);
  const state = { files, activeFile, vaultName: 'Vault', recents: [] };
  const controller = createWorkspaceController({
    state,
    hostWindow: { electronAPI: api },
    hostDocument: { createElement: vi.fn() },
    fileInput: { click: vi.fn() },
    showToast: () => {}, renderFile: () => {}, renderTree: () => {}, renderTabs: () => {},
  });
  controller.setVaultIdentity('v', 1);
  await controller.handleVaultChanged(event);
  return state;
}

describe.each(PATHS)('B6 — external change of a clean open note — %s', (_label, makeScenario) => {
  const reload = (files, text = 'two', hash = 'h2') => externalChange(files, [entry('a.md', text, hash)], makeScenario);

  test('R1: the reloaded tab is clean, shows the new text and its baseline IS the new disk text', async () => {
    const state = await reload([note('a.md', 'one', 'h1')]);
    const f = state.files[0];
    expect(f.content).toBe('two');
    expect(f.savedContent).toBe('two');
    expect(f.dirty).toBe(false);
    expect(f.conflict).toBe(false);
  });

  test('R2: typing the text back to exactly the OLD text makes the tab dirty (the B6 data-loss case)', async () => {
    const state = await reload([note('a.md', 'one', 'h1')]);
    const f = state.files[0];
    applyEdit(f, 'one');
    expect(f.content).toBe('one');
    expect(f.dirty).toBe(true);
  });

  test('R2: editing to any other value is dirty too', async () => {
    const state = await reload([note('a.md', 'one', 'h1')]);
    const f = state.files[0];
    applyEdit(f, 'three');
    expect(f.dirty).toBe(true);
    applyEdit(f, '');
    expect(f.dirty).toBe(true);
  });

  test('R3: returning to exactly the new disk text is clean again; the baseline never moved', async () => {
    const state = await reload([note('a.md', 'one', 'h1')]);
    const f = state.files[0];
    applyEdit(f, 'one');
    applyEdit(f, 'x');
    expect(f.dirty).toBe(true);
    applyEdit(f, 'two');
    expect(f.dirty).toBe(false);
    expect(f.savedContent).toBe('two');
  });

  test('R1/R2: a second external change reloads again and moves the baseline again', async () => {
    const files = [note('a.md', 'one', 'h1')];
    const first = await reload(files);
    const second = await externalChange(first.files, [entry('a.md', 'three', 'h3')], makeScenario);
    const f = second.files[0];
    expect(f.savedContent).toBe('three');
    expect(f.content).toBe('three');
    applyEdit(f, 'two');
    expect(f.dirty).toBe(true);
  });

  test('R1: a note with no hash baseline (content-compare fallback) also moves its baseline', async () => {
    const state = await reload([note('a.md', 'one', undefined, { meta: {} })], 'two', undefined);
    const f = state.files[0];
    expect(f.content).toBe('two');
    expect(f.savedContent).toBe('two');
    applyEdit(f, 'one');
    expect(f.dirty).toBe(true);
  });

  test('R1: the reload works for a background (non-active) tab as well', async () => {
    const files = [note('b.md', 'B', 'hb'), note('a.md', 'one', 'h1')];
    const state = await externalChange(files, [entry('a.md', 'two', 'h2')], makeScenario, 0);
    const f = state.files.find((x) => x.path === 'a.md');
    expect(f.savedContent).toBe('two');
    applyEdit(f, 'one');
    expect(f.dirty).toBe(true);
  });

  test('R1: the baseline is the text the tab shows, not an EOL-different copy of it', async () => {
    const state = await reload([note('a.md', 'one', 'h1')], 'line 1\nline 2');
    const f = state.files[0];
    expect(f.savedContent).toBe(f.content);
    expect(f.savedContent).toBe('line 1\nline 2');
  });

  test('an unchanged disk copy leaves a clean note exactly as it was (same object, baseline kept)', async () => {
    const original = note('a.md', 'one', 'h1');
    const state = await reload([original], 'one', 'h1');
    expect(state.files[0]).toBe(original);
    expect(original.savedContent).toBe('one');
  });

  test('R4: a DIRTY note keeps the user text, becomes a conflict, and neither baseline nor disk identity advance', async () => {
    const state = await reload([note('a.md', 'mine', 'h1', { savedContent: 'one', dirty: true })]);
    const f = state.files[0];
    expect(f.content).toBe('mine');
    expect(f.dirty).toBe(true);
    expect(f.conflict).toBe(true);
    expect(f.diskContent).toBe('two');
    expect(f.savedContent).toBe('one');   // baseline not advanced
    expect(f.meta.hash).toBe('h1');       // a later save still sends the OLD baseHash -> main reports the conflict
  });

  test('R4: a second external change while the conflict is open updates only the stashed disk copy', async () => {
    const first = await reload([note('a.md', 'mine', 'h1', { savedContent: 'one', dirty: true })]);
    const second = await externalChange(first.files, [entry('a.md', 'three', 'h3')], makeScenario);
    const f = second.files[0];
    expect(f).toMatchObject({ content: 'mine', savedContent: 'one', dirty: true, conflict: true, diskContent: 'three' });
    expect(f.meta.hash).toBe('h1');
  });
});

describe('B6 — mergeVaultSlice (pure)', () => {
  test('R1/R2: a clean note whose disk copy changed gets baseline == disk text', () => {
    const merged = mergeVaultSlice([note('a.md', 'one', 'h1')], 'v', [entry('a.md', 'two', 'h2')]);
    expect(merged[0]).toMatchObject({ content: 'two', savedContent: 'two', dirty: false, conflict: false, diskContent: null });
    expect(merged[0].meta.hash).toBe('h2');
  });

  test('the previous object is not mutated (merge stays pure)', () => {
    const prev = note('a.md', 'one', 'h1');
    mergeVaultSlice([prev], 'v', [entry('a.md', 'two', 'h2')]);
    expect(prev).toMatchObject({ content: 'one', savedContent: 'one', dirty: false });
  });

  test('a note that is new on disk starts with its text as baseline', () => {
    const merged = mergeVaultSlice([], 'v', [entry('n.md', 'fresh', 'hn')]);
    expect(merged[0]).toMatchObject({ content: 'fresh', savedContent: 'fresh', dirty: false });
  });

  test('R4: a dirty note whose disk copy changed keeps content, baseline and hash', () => {
    const prev = note('a.md', 'mine', 'h1', { savedContent: 'one', dirty: true });
    const merged = mergeVaultSlice([prev], 'v', [entry('a.md', 'two', 'h2')]);
    expect(merged[0]).toMatchObject({ content: 'mine', savedContent: 'one', dirty: true, conflict: true, diskContent: 'two' });
    expect(merged[0].meta.hash).toBe('h1');
    expect(merged[0].diskMeta.hash).toBe('h2');
  });
});
