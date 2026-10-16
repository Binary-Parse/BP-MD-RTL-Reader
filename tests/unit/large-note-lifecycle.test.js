/**
 * large-note-lifecycle.test.js — a note's size tier follows the note, not only its first read.
 *
 * Review of the large-note work found the tier (sizeBytes / largeTier) was set once at open and
 * never again: a 4.9 MiB note grown to 60 MiB and saved stayed NORMAL (and a HUGE note edited
 * down stayed in large-file mode until reopened); the conflict re-read passed confirmLarge:true
 * blindly; reopening an open HUGE note asked again; a deferred (HUGE) note could be copied by the
 * folder merge and lose its pending edits. These tests pin the repairs.
 */
import { describe, expect, test, vi } from 'vitest';
import {
  createWorkspaceController,
  mergeVaultSlice,
} from '../../src/renderer/components/workspace-controller.js';
import {
  MIB, TIER, applyNoteSize, mirrorSignature, serialQueue,
} from '../../src/renderer/components/large-file.js';

function harness({ state, electronAPI, confirmLargeOpen } = {}) {
  const calls = { addFile: [], renderFile: [], toasts: [], confirmLarge: [] };
  const controller = createWorkspaceController({
    state,
    hostWindow: { electronAPI },
    hostDocument: { createElement: vi.fn() },
    fileInput: { click: vi.fn() },
    closeMenu: () => {},
    showToast: (...args) => calls.toasts.push(args),
    showWelcome: () => {},
    confirmDiscard: vi.fn(() => true),
    confirmLargeOpen: confirmLargeOpen || (async (info) => { calls.confirmLarge.push(info); return true; }),
    addFile: (file) => calls.addFile.push(file),
    renderFile: (index) => calls.renderFile.push(index),
    renderTree: () => {},
    renderTabs: () => {},
    setVaultUi: () => {},
  });
  return { controller, calls };
}

const noteAt = (bytes, over = {}) => ({
  name: 'a.md', path: 'a.md', content: 'body', savedContent: 'old', dirty: true, documentId: 'doc',
  meta: { hash: 'h0' }, revision: 0, sizeBytes: bytes, largeTier: bytes > 20 * MIB ? TIER.HUGE : (bytes > 5 * MIB ? TIER.LARGE : TIER.NORMAL),
  ...over,
});

describe('applyNoteSize', () => {
  test('moves sizeBytes and the tier together, and says whether the tier changed', () => {
    const file = { sizeBytes: 4.9 * MIB, largeTier: TIER.NORMAL };
    expect(applyNoteSize(file, 60 * MIB)).toBe(true);
    expect(file).toMatchObject({ sizeBytes: 60 * MIB, largeTier: TIER.HUGE });
    expect(applyNoteSize(file, 61 * MIB)).toBe(false);
    expect(file.sizeBytes).toBe(61 * MIB);
    expect(applyNoteSize(file, MIB)).toBe(true);
    expect(file.largeTier).toBe(TIER.NORMAL);
  });

  test('a size that is not a number changes nothing; a file with no tier counts as NORMAL', () => {
    const file = { sizeBytes: 1, largeTier: TIER.LARGE };
    for (const bad of [undefined, null, NaN, -1, '5']) expect(applyNoteSize(file, bad)).toBe(false);
    expect(file).toEqual({ sizeBytes: 1, largeTier: TIER.LARGE });
    const fresh = {};
    expect(applyNoteSize(fresh, 6 * MIB)).toBe(true);
    expect(fresh.largeTier).toBe(TIER.LARGE);
    expect(applyNoteSize({}, MIB)).toBe(false);
  });

  test('a size past the open limit still maps to HUGE (a note that is open stays editable)', () => {
    const file = {};
    applyNoteSize(file, 150 * MIB);
    expect(file.largeTier).toBe(TIER.HUGE);
  });
});

describe('a save moves the tier', () => {
  const stateOf = (file) => ({ files: [file], activeFile: 0, recents: [] });

  test('a 4.9 MiB note saved at 60 MiB becomes HUGE and the note is shown again in the new mode', async () => {
    const file = noteAt(4.9 * MIB);
    const { controller, calls } = harness({
      state: stateOf(file),
      electronAPI: { writeFile: vi.fn(async () => ({ ok: true, size: 60 * MIB, meta: { hash: 'h1' } })) },
    });
    await controller.saveCurrent();
    expect(file).toMatchObject({ sizeBytes: 60 * MIB, largeTier: TIER.HUGE, dirty: false });
    expect(calls.renderFile).toEqual([0]);
  });

  test('a HUGE note saved at 1 MiB becomes NORMAL again', async () => {
    const file = noteAt(60 * MIB);
    const { controller, calls } = harness({
      state: stateOf(file),
      electronAPI: { writeFile: vi.fn(async () => ({ ok: true, size: MIB, meta: { hash: 'h1' } })) },
    });
    await controller.saveCurrent();
    expect(file).toMatchObject({ sizeBytes: MIB, largeTier: TIER.NORMAL });
    expect(calls.renderFile).toEqual([0]);
  });

  test('a save that stays in its tier records the size and does not redraw the note', async () => {
    const file = noteAt(3 * MIB);
    const { controller, calls } = harness({
      state: stateOf(file),
      electronAPI: { writeFile: vi.fn(async () => ({ ok: true, size: 3.5 * MIB, meta: { hash: 'h1' } })) },
    });
    await controller.saveCurrent();
    expect(file).toMatchObject({ sizeBytes: 3.5 * MIB, largeTier: TIER.NORMAL });
    expect(calls.renderFile).toEqual([]);
  });

  test('a background note that changes tier is not redrawn (it is on screen only when active)', async () => {
    const other = { name: 'b.md', path: 'b.md', content: 'x', dirty: false };
    const file = noteAt(4.9 * MIB);
    const state = { files: [other, file], activeFile: 0, recents: [] };
    const { controller, calls } = harness({
      state,
      electronAPI: { writeFile: vi.fn(async () => ({ ok: true, size: 30 * MIB, meta: { hash: 'h1' } })) },
    });
    await controller.saveCurrent(file);
    expect(file.largeTier).toBe(TIER.HUGE);
    expect(calls.renderFile).toEqual([]);
  });

  test('Save As takes the size of what it wrote', async () => {
    const file = noteAt(2 * MIB, { documentId: null });
    const { controller, calls } = harness({
      state: stateOf(file),
      electronAPI: { saveFileAs: vi.fn(async () => ({ ok: true, documentId: 'd2', name: 'b.md', size: 25 * MIB, meta: { hash: 'h2' } })) },
    });
    await controller.saveAs(file);
    expect(file).toMatchObject({ sizeBytes: 25 * MIB, largeTier: TIER.HUGE, documentId: 'd2' });
    expect(calls.renderFile).toContain(0);
  });

  test('a failed save leaves the tier alone', async () => {
    const file = noteAt(4.9 * MIB);
    const { controller } = harness({
      state: stateOf(file),
      electronAPI: { writeFile: vi.fn(async () => ({ error: 'enospc', size: 60 * MIB })) },
    });
    await controller.saveCurrent();
    expect(file).toMatchObject({ sizeBytes: 4.9 * MIB, largeTier: TIER.NORMAL });
  });
});

describe('the conflict re-read does not skip the large-note question', () => {
  const conflictCase = (readFile, { confirm, interactive }) => {
    const file = noteAt(MIB, { content: 'my edits' });
    const state = { files: [file], activeFile: 0, recents: [] };
    const { controller, calls } = harness({
      state,
      confirmLargeOpen: confirm,
      electronAPI: { writeFile: vi.fn(async () => ({ error: 'conflict' })), readFile },
    });
    return { file, calls, run: () => controller.writeThrough(file, { interactive }) };
  };

  test('a disk copy that grew past 20 MiB is not read behind the reader\'s back (autosave)', async () => {
    const readFile = vi.fn(async (_id, opts) => (opts && opts.confirmLarge
      ? { content: 'x'.repeat(10), size: 30 * MIB, meta: { hash: 'h9' } }
      : { error: 'confirm-large', documentId: 'doc', name: 'a.md', size: 30 * MIB }));
    const confirm = vi.fn(async () => true);
    const { file, run } = conflictCase(readFile, { confirm, interactive: false });
    expect(await run()).toBe('conflict');
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(readFile.mock.calls[0][1]?.confirmLarge).toBeFalsy();
    expect(confirm).not.toHaveBeenCalled();
    expect(file).toMatchObject({ conflict: true, content: 'my edits', dirty: true });
    expect(file.diskContent == null).toBe(true);
    expect(file.diskSize).toBe(30 * MIB);
  });

  test('on a Save the reader is asked; yes loads the disk copy and records its size', async () => {
    const readFile = vi.fn(async (_id, opts) => (opts && opts.confirmLarge
      ? { content: 'disk', size: 30 * MIB, meta: { hash: 'h9' } }
      : { error: 'confirm-large', documentId: 'doc', name: 'a.md', size: 30 * MIB }));
    const confirm = vi.fn(async () => true);
    const { file, run } = conflictCase(readFile, { confirm, interactive: true });
    expect(await run()).toBe('conflict');
    expect(confirm).toHaveBeenCalledWith({ name: 'a.md', size: 30 * MIB });
    expect(file).toMatchObject({ conflict: true, content: 'my edits', diskContent: 'disk', diskSize: 30 * MIB });
  });

  test('on a Save, "no" keeps the edits and loads nothing', async () => {
    const readFile = vi.fn(async (_id, opts) => (opts && opts.confirmLarge
      ? { content: 'disk', size: 30 * MIB, meta: { hash: 'h9' } }
      : { error: 'confirm-large', documentId: 'doc', name: 'a.md', size: 30 * MIB }));
    const confirm = vi.fn(async () => false);
    const { file, run } = conflictCase(readFile, { confirm, interactive: true });
    expect(await run()).toBe('conflict');
    expect(readFile.mock.calls.every(([, opts]) => !(opts && opts.confirmLarge))).toBe(true);
    expect(file).toMatchObject({ conflict: true, content: 'my edits', dirty: true });
    expect(file.diskContent == null).toBe(true);
  });

  test('an ordinary disk copy is read as before and its size kept for a later Reload', async () => {
    const readFile = vi.fn(async () => ({ content: 'disk', size: 2 * MIB, meta: { hash: 'h9' } }));
    const { file, run } = conflictCase(readFile, { confirm: vi.fn(), interactive: false });
    expect(await run()).toBe('conflict');
    expect(file).toMatchObject({ diskContent: 'disk', diskSize: 2 * MIB, diskMeta: { hash: 'h9' } });
  });
});

describe('opening a large note that is already open', () => {
  const stateWith = (file) => ({ files: [file], activeFile: null, recents: [] });
  const pending = { error: 'confirm-large', documentId: 'doc', name: 'a.md', size: 40 * MIB };

  test('the picker shows the open tab without asking again', async () => {
    const file = noteAt(40 * MIB, { dirty: false });
    const readFile = vi.fn();
    const { controller, calls } = harness({
      state: stateWith(file),
      electronAPI: { openFile: vi.fn(async () => pending), readFile },
    });
    await controller.openSingleFile();
    expect(calls.confirmLarge).toEqual([]);
    expect(readFile).not.toHaveBeenCalled();
    expect(calls.addFile).toEqual([]);
    expect(calls.renderFile).toEqual([0]);
  });

  test('"Open with" does the same', async () => {
    const file = noteAt(40 * MIB, { dirty: false });
    const readFile = vi.fn();
    const { controller, calls } = harness({ state: stateWith(file), electronAPI: { readFile } });
    await controller.openExternalFile(pending);
    expect(calls.confirmLarge).toEqual([]);
    expect(readFile).not.toHaveBeenCalled();
    expect(calls.renderFile).toEqual([0]);
  });

  test('a note that is not open is still asked about, then read with the answer', async () => {
    const readFile = vi.fn(async () => ({ documentId: 'doc2', name: 'a.md', content: 'text', size: 40 * MIB, meta: {} }));
    const { controller, calls } = harness({
      state: { files: [], activeFile: null, recents: [] },
      electronAPI: { openFile: vi.fn(async () => ({ ...pending, documentId: 'doc2' })), readFile },
    });
    await controller.openSingleFile();
    expect(calls.confirmLarge).toEqual([{ name: 'a.md', size: 40 * MIB }]);
    expect(readFile).toHaveBeenCalledWith('doc2', { confirmLarge: true });
    expect(calls.addFile).toHaveLength(1);
    expect(calls.addFile[0]).toMatchObject({ sizeBytes: 40 * MIB, largeTier: TIER.HUGE });
  });
});

describe('serialQueue', () => {
  test('runs one task at a time, in order, and every task settles', async () => {
    const run = serialQueue();
    const log = [];
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const first = run(async () => { log.push('first:start'); await gate; log.push('first:end'); return 1; });
    const second = run(async () => { log.push('second:start'); return 2; });
    await Promise.resolve();
    expect(log).toEqual(['first:start']);
    release();
    expect(await first).toBe(1);
    expect(await second).toBe(2);
    expect(log).toEqual(['first:start', 'first:end', 'second:start']);
  });

  test('a task that throws does not block the next one', async () => {
    const run = serialQueue();
    const bad = run(async () => { throw new Error('boom'); });
    const good = run(async () => 'fine');
    await expect(bad).rejects.toThrow('boom');
    expect(await good).toBe('fine');
  });
});

describe('mergeVaultSlice never copies a note in large-file mode', () => {
  const incoming = (hash, content = 'disk') => [{ relPath: 'a.md', name: 'a.md', content, meta: { hash }, size: 3 * MIB }];

  // What the app does to a note in large-file mode: `content` becomes an accessor that first
  // asks the editor for its pending text. A copy ({...file}) would freeze that into a value and
  // orphan the edits still pending in the editor.
  function deferredNote(over = {}) {
    let raw = 'pending-free text';
    const file = {
      name: 'a.md', path: 'a.md', vaultId: 'v', dirty: false, savedContent: raw, meta: { hash: 'h0' },
      sizeBytes: 40 * MIB, largeTier: TIER.HUGE, ...over,
    };
    let reads = 0;
    Object.defineProperty(file, 'content', {
      enumerable: true,
      configurable: true,
      get() { reads++; return raw; },
      set(value) { raw = value; },
    });
    return { file, reads: () => reads };
  }

  test('a changed disk copy flags the same object as a conflict even when the note is clean', () => {
    const { file } = deferredNote();
    const merged = mergeVaultSlice([file], 'v', incoming('h1'));
    expect(merged[0]).toBe(file);
    expect(typeof Object.getOwnPropertyDescriptor(merged[0], 'content').get).toBe('function');
    expect(file).toMatchObject({ conflict: true, diskContent: 'disk' });
  });

  test('a dirty note keeps its edits and its accessor', () => {
    const { file } = deferredNote({ dirty: true });
    const merged = mergeVaultSlice([file], 'v', incoming('h1'));
    expect(merged[0]).toBe(file);
    expect(typeof Object.getOwnPropertyDescriptor(merged[0], 'content').get).toBe('function');
    expect(file.conflict).toBe(true);
  });

  test('a note that is no longer in the folder read is marked missing on the same object', () => {
    const { file } = deferredNote();
    const merged = mergeVaultSlice([file], 'v', []);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toBe(file);
    expect(file.missing).toBe(true);
    expect(typeof Object.getOwnPropertyDescriptor(merged[0], 'content').get).toBe('function');
  });

  test('an unchanged disk copy keeps the very same object', () => {
    const { file } = deferredNote();
    expect(mergeVaultSlice([file], 'v', incoming('h0'))[0]).toBe(file);
  });

  test('an ordinary clean note still reloads silently, and takes the new size', () => {
    const file = {
      name: 'a.md', path: 'a.md', vaultId: 'v', dirty: false, content: 'old', savedContent: 'old',
      meta: { hash: 'h0' }, sizeBytes: MIB, largeTier: TIER.NORMAL,
    };
    const merged = mergeVaultSlice([file], 'v', [{ ...incoming('h1', 'new')[0], size: 7 * MIB }]);
    expect(merged[0]).not.toBe(file);
    expect(merged[0]).toMatchObject({ content: 'new', dirty: false, sizeBytes: 7 * MIB, largeTier: TIER.LARGE });
  });
});

describe('mirrorSignature', () => {
  test('reads the text before the revision, so a flush that bumps the revision is part of the signature', () => {
    // The text of a note in large-file mode comes through an accessor that hands over the pending
    // edit first, which raises the revision. The same-length edit below must change the signature.
    const note = { name: 'a.md', revision: 1 };
    let text = 'abcdef';
    Object.defineProperty(note, 'content', {
      get() { if (text === 'abcdef' && note.pending) { text = 'abcdeX'; note.revision += 1; note.pending = false; } return text; },
    });
    const before = mirrorSignature([note]);
    note.pending = true;
    const after = mirrorSignature([note]);
    expect(after).not.toBe(before);
    expect(after).toBe('a.md:2:6');
  });

  test('joins several notes and tolerates a missing text', () => {
    expect(mirrorSignature([{ name: 'a', revision: 0, content: 'xy' }, { name: 'b', revision: 3 }])).toBe('a:0:2|b:3:0');
    expect(mirrorSignature([])).toBe('');
  });
});
