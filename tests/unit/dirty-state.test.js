import { describe, test, expect } from 'vitest';
import { applyEdit, markClean, adoptDiskText, discardEdits } from '../../src/renderer/components/dirty-state.js';

describe('applyEdit — a note is dirty only while its text differs from the last saved text', () => {
  test('first edit of a clean note makes it dirty and remembers the pre-edit text as the saved baseline', () => {
    const f = { content: 'abc', dirty: false };
    applyEdit(f, 'abcd');
    expect(f.content).toBe('abcd');
    expect(f.dirty).toBe(true);
    expect(f.savedContent).toBe('abc');
  });

  test('undo back to the saved text clears the dirty flag', () => {
    const f = { content: 'abc', dirty: false };
    applyEdit(f, 'abcd');
    applyEdit(f, 'abc');
    expect(f.dirty).toBe(false);
    expect(f.content).toBe('abc');
  });

  test('a partial undo (still different from saved) stays dirty', () => {
    const f = { content: 'abc', dirty: false };
    applyEdit(f, 'abcde');
    applyEdit(f, 'abcd');
    expect(f.dirty).toBe(true);
  });

  test('a note that was never saved (dirty from creation, no baseline) stays dirty even when the text is empty again', () => {
    const f = { content: '# New\n\n', dirty: true };
    applyEdit(f, '');
    expect(f.dirty).toBe(true);
    expect(f.savedContent).toBeUndefined();
  });

  test('an existing baseline is never replaced by a later edit', () => {
    const f = { content: 'one', dirty: false, savedContent: 'one' };
    applyEdit(f, 'two');
    applyEdit(f, 'three');
    expect(f.savedContent).toBe('one');
    applyEdit(f, 'one');
    expect(f.dirty).toBe(false);
  });

  test('editing a dirty note that has no baseline does not invent one from the edited text', () => {
    const f = { content: 'x', dirty: true };
    applyEdit(f, 'xy');
    expect(f.savedContent).toBeUndefined();
    expect(f.dirty).toBe(true);
  });
});

describe('markClean — saving moves the baseline', () => {
  test('after a save the saved text becomes the new baseline and undo to the OLD text is dirty again', () => {
    const f = { content: 'old', dirty: false };
    applyEdit(f, 'new');
    markClean(f, 'new');
    expect(f.dirty).toBe(false);
    expect(f.savedContent).toBe('new');
    applyEdit(f, 'old');
    expect(f.dirty).toBe(true);
    applyEdit(f, 'new');
    expect(f.dirty).toBe(false);
  });

  test('defaults to the current content', () => {
    const f = { content: 'text', dirty: true };
    markClean(f);
    expect(f.dirty).toBe(false);
    expect(f.savedContent).toBe('text');
  });
});

// B6: the text on disk was changed by another program. The disk text is the new baseline.
describe('adoptDiskText — the disk text becomes the baseline', () => {
  test('reload (default): content and baseline both become the disk text, the note is clean', () => {
    const f = { content: 'mine', savedContent: 'one', dirty: true };
    adoptDiskText(f, 'two');
    expect(f).toMatchObject({ content: 'two', savedContent: 'two', dirty: false });
  });

  test('reload of a clean note: typing the OLD text back is dirty, typing the new disk text is clean', () => {
    const f = { content: 'one', savedContent: 'one', dirty: false };
    adoptDiskText(f, 'two');
    applyEdit(f, 'one');
    expect(f.dirty).toBe(true);
    applyEdit(f, 'two');
    expect(f.dirty).toBe(false);
  });

  test('reload gives a note that never had a baseline one', () => {
    const f = { content: 'new note', dirty: true };
    adoptDiskText(f, 'on disk');
    expect(f).toMatchObject({ content: 'on disk', savedContent: 'on disk', dirty: false });
  });

  test('reload to an empty disk text is a real, clean baseline', () => {
    const f = { content: 'x', savedContent: 'x', dirty: false };
    adoptDiskText(f, '');
    expect(f).toMatchObject({ content: '', savedContent: '', dirty: false });
    applyEdit(f, 'x');
    expect(f.dirty).toBe(true);
  });

  test('keepEdits: the user text stays, the baseline moves to the disk text, dirty is recomputed against it', () => {
    const f = { content: 'mine', savedContent: 'one', dirty: true };
    adoptDiskText(f, 'two', { keepEdits: true });
    expect(f).toMatchObject({ content: 'mine', savedContent: 'two', dirty: true });
    applyEdit(f, 'one'); // the OLD baseline text is no longer what is on disk
    expect(f.dirty).toBe(true);
    applyEdit(f, 'two');
    expect(f.dirty).toBe(false);
  });

  test('keepEdits when the user text already equals the disk text: clean', () => {
    const f = { content: 'same', savedContent: 'old', dirty: true };
    adoptDiskText(f, 'same', { keepEdits: true });
    expect(f).toMatchObject({ content: 'same', savedContent: 'same', dirty: false });
  });
});

// B2: "Don't Save" throws the edits away; the note goes back to exactly its last saved text.
describe('discardEdits — Don\'t Save returns the note to its saved text', () => {
  test('an edited note holds its saved text again and is clean', () => {
    const f = { content: 'ORIGINAL', dirty: false };
    applyEdit(f, 'ORIGINAL\nDISCARDED-EDIT\n');
    expect(discardEdits(f)).toBe(true);
    expect(f).toMatchObject({ content: 'ORIGINAL', savedContent: 'ORIGINAL', dirty: false });
  });

  test('the baseline after a save is what comes back, not the text it was first opened with', () => {
    const f = { content: 'old', dirty: false };
    applyEdit(f, 'saved');
    markClean(f, 'saved');
    applyEdit(f, 'saved plus more');
    discardEdits(f);
    expect(f).toMatchObject({ content: 'saved', savedContent: 'saved', dirty: false });
  });

  test('an empty saved text is a real baseline: the note is emptied again', () => {
    const f = { content: '', savedContent: '', dirty: false };
    applyEdit(f, 'typed');
    expect(discardEdits(f)).toBe(true);
    expect(f).toMatchObject({ content: '', savedContent: '', dirty: false });
  });

  test('a note that is already clean is left as it is', () => {
    const f = { content: 'same', savedContent: 'same', dirty: false };
    expect(discardEdits(f)).toBe(true);
    expect(f).toMatchObject({ content: 'same', savedContent: 'same', dirty: false });
  });

  test('after the discard a new edit is judged against the same baseline', () => {
    const f = { content: 'one', dirty: false };
    applyEdit(f, 'two');
    discardEdits(f);
    applyEdit(f, 'three');
    expect(f.dirty).toBe(true);
    applyEdit(f, 'one');
    expect(f.dirty).toBe(false);
  });

  test('a note that was never saved has nothing to go back to: it is left untouched and false is returned', () => {
    const f = { content: 'never saved', dirty: true };
    expect(discardEdits(f)).toBe(false);
    expect(f).toEqual({ content: 'never saved', dirty: true });
  });

  test('a note with a pending disk conflict goes back to the disk text, like "Reload from disk"', () => {
    const meta = { hash: 'new' };
    const f = {
      content: 'mine', savedContent: 'one', dirty: true, meta: { hash: 'old' },
      conflict: true, diskContent: 'two', diskMeta: meta,
    };
    expect(discardEdits(f)).toBe(true);
    expect(f).toMatchObject({
      content: 'two', savedContent: 'two', dirty: false, conflict: false, diskContent: null, diskMeta: null, meta,
    });
  });

  test('a conflict without a disk copy to adopt reverts to the saved text', () => {
    const f = { content: 'mine', savedContent: 'one', dirty: true, conflict: true, diskContent: null };
    expect(discardEdits(f)).toBe(true);
    expect(f).toMatchObject({ content: 'one', savedContent: 'one', dirty: false });
  });

  test('a conflict without a disk copy stays flagged: nothing was reloaded, so it is not resolved', () => {
    const meta = { hash: 'old' };
    const f = { content: 'mine', savedContent: 'one', dirty: true, conflict: true, diskContent: null, diskMeta: { hash: 'new' }, meta };
    discardEdits(f);
    expect(f).toMatchObject({ conflict: true, diskContent: null, diskMeta: { hash: 'new' } });
    expect(f.meta).toBe(meta);
  });

  test('a note without a conflict keeps its own identity and has no conflict state invented', () => {
    const meta = { hash: 'h' };
    const f = { content: 'edit', savedContent: 'one', dirty: true, meta, diskMeta: { hash: 'stale' } };
    discardEdits(f);
    expect(f.meta).toBe(meta);
    expect(f.conflict).toBeUndefined();
    expect(f.diskMeta).toEqual({ hash: 'stale' });
  });

  test('a conflict whose disk text is empty still adopts it (empty is a real text)', () => {
    const f = { content: 'mine', savedContent: 'one', dirty: true, conflict: true, diskContent: '', diskMeta: null };
    discardEdits(f);
    expect(f).toMatchObject({ content: '', savedContent: '', dirty: false, conflict: false });
  });

  test('a conflict whose disk identity is unknown keeps the note\'s own identity', () => {
    const meta = { hash: 'old' };
    const f = { content: 'mine', savedContent: 'one', dirty: true, meta, conflict: true, diskContent: 'two', diskMeta: null };
    discardEdits(f);
    expect(f.meta).toBe(meta);
  });
});

describe('applyEdit — the baseline is only ever taken once', () => {
  test('a note that already has a baseline keeps it even if the file object is marked clean', () => {
    const f = { content: 'abc', dirty: false, savedContent: 'xyz' };
    applyEdit(f, 'xyz');
    expect(f.savedContent).toBe('xyz');
    expect(f.dirty).toBe(false);
  });

  test('an empty saved text is a real baseline, not "missing"', () => {
    const f = { content: '', dirty: false, savedContent: '' };
    applyEdit(f, 'x');
    expect(f.savedContent).toBe('');
    applyEdit(f, '');
    expect(f.dirty).toBe(false);
  });
});
