/**
 * annotations-store.test.js — T5.1a. The store is main-side and fed by the renderer, so
 * every validation branch gets a case (it is also the security boundary for stored text).
 */
import { describe, test, expect, vi } from 'vitest';
import path from 'node:path';
import {
  createAnnotationsStore,
  sanitizeHighlight,
  sanitizeHighlights,
  MAX_HIGHLIGHTS_PER_DOC,
} from '../../src/main/annotations-store.js';

const FILE = path.posix.join('/user', 'annotations.json');

function memFs(seed = {}) {
  const files = { ...seed };
  return {
    _files: files,
    readFileSync(file) {
      if (!(file in files)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return files[file];
    },
    writeFileSync: vi.fn((file, content) => { files[file] = content; }),
    renameSync: vi.fn((from, to) => { files[to] = files[from]; delete files[from]; }),
  };
}

const store = (fs) => createAnnotationsStore({ fs, path: path.posix, userDataDir: '/user' });
const good = (over = {}) => ({
  id: 'h1', text: 'the highlighted words', note: 'why it matters', at: 1000,
  anchor: { headingSlug: 'intro', ordinal: 2 }, ...over,
});

describe('sanitizeHighlight', () => {
  test('accepts a well-formed highlight and normalises the optional parts', () => {
    expect(sanitizeHighlight(good())).toEqual({
      id: 'h1', text: 'the highlighted words', note: 'why it matters', at: 1000,
      anchor: { headingSlug: 'intro', ordinal: 2 },
    });
    expect(sanitizeHighlight(good({ note: undefined })).note).toBe('');
    expect(sanitizeHighlight(good({ anchor: undefined })).anchor).toEqual({ headingSlug: '', ordinal: 0 });
    expect(sanitizeHighlight(good({ anchor: { headingSlug: 7, ordinal: -3 } })).anchor)
      .toEqual({ headingSlug: '', ordinal: 0 });
  });

  test('rejects every malformed shape', () => {
    const bad = [
      null, undefined, 'text', 42, {},
      good({ id: '' }), good({ id: 7 }), good({ id: 'x'.repeat(129) }),
      good({ text: '' }), good({ text: 7 }), good({ text: 'x'.repeat(5001) }),
      good({ note: 'x'.repeat(5001) }),
      good({ at: 0 }), good({ at: -1 }), good({ at: NaN }), good({ at: 'now' }), good({ at: undefined }),
    ];
    for (const entry of bad) expect(sanitizeHighlight(entry), JSON.stringify(entry)).toBeNull();
  });
});

describe('sanitizeHighlights', () => {
  test('non-arrays are empty; bad entries drop; the per-document cap applies', () => {
    expect(sanitizeHighlights('nope')).toEqual([]);
    expect(sanitizeHighlights([good(), null, good({ id: 'h2' })])).toHaveLength(2);
    const many = Array.from({ length: MAX_HIGHLIGHTS_PER_DOC + 20 }, (_, i) => good({ id: `h${i}` }));
    expect(sanitizeHighlights(many)).toHaveLength(MAX_HIGHLIGHTS_PER_DOC);
  });
});

describe('createAnnotationsStore', () => {
  test('get() on an absent file returns no highlights, and a document round-trips', () => {
    const fs = memFs();
    const s = store(fs);
    expect(s.get('doc:cap-1')).toEqual({ highlights: [] });
    expect(s.put('doc:cap-1', [good()])).toEqual({ ok: true, count: 1 });
    expect(s.get('doc:cap-1').highlights).toHaveLength(1);
    // atomic: written to a random O_EXCL tmp name then renamed
    const tmp = fs.writeFileSync.mock.calls[0][0];
    expect(tmp.startsWith(`${FILE}.tmp-`)).toBe(true);
    expect(fs.writeFileSync).toHaveBeenCalledWith(tmp, expect.any(String), { encoding: 'utf8', flag: 'wx' });
    expect(fs.renameSync).toHaveBeenCalledWith(tmp, FILE);
    expect(JSON.parse(fs._files[FILE])).toEqual({
      version: 1,
      docs: { 'doc:cap-1': { highlights: [good()] } },
    });
  });

  test('a second store instance reads what the first wrote (persistence)', () => {
    const fs = memFs();
    store(fs).put('doc:cap-1', [good()]);
    expect(store(fs).get('doc:cap-1').highlights).toEqual([good()]);
  });

  test('rejects an invalid key, a non-array, a malformed entry, and over-cap lists', () => {
    const fs = memFs();
    const s = store(fs);
    for (const key of ['', null, undefined, 7, 'x'.repeat(513)]) {
      expect(s.get(key)).toEqual({ error: 'invalid-key' });
      expect(s.put(key, [good()])).toEqual({ error: 'invalid-key' });
    }
    expect(s.put('doc:cap-1', 'nope')).toEqual({ error: 'invalid-highlights' });
    expect(s.put('doc:cap-1', [good(), { id: 'bad' }])).toEqual({ error: 'invalid-highlight' });
    expect(s.put('doc:cap-1', Array.from({ length: MAX_HIGHLIGHTS_PER_DOC + 1 }, (_, i) => good({ id: `h${i}` }))))
      .toEqual({ error: 'too-many' });
    expect(fs.writeFileSync).not.toHaveBeenCalled(); // nothing was persisted
  });

  test('an empty list clears the document without touching the others', () => {
    const fs = memFs();
    const s = store(fs);
    s.put('a', [good()]);
    s.put('b', [good({ id: 'h2' })]);
    expect(s.put('a', [])).toEqual({ ok: true, count: 0 });
    expect(s.get('a').highlights).toEqual([]);
    expect(s.get('b').highlights).toHaveLength(1);
    expect(JSON.parse(fs._files[FILE]).docs).not.toHaveProperty('a');
  });

  test('a corrupt or unknown-version file degrades to empty instead of throwing', () => {
    const torn = memFs({ [FILE]: '{"version": 1, "docs": {"a":' });
    expect(store(torn).get('a')).toEqual({ highlights: [] });
    const old = memFs({ [FILE]: JSON.stringify({ version: 0, docs: { a: { highlights: [good()] } } }) });
    expect(store(old).get('a')).toEqual({ highlights: [] });
    const weird = memFs({ [FILE]: '"just a string"' });
    expect(store(weird).get('a')).toEqual({ highlights: [] });
  });

  test('load() drops malformed stored entries and keeps the valid ones', () => {
    const fs = memFs({
      [FILE]: JSON.stringify({
        version: 1,
        docs: {
          good: { highlights: [good(), { id: 'nope' }] },
          '': { highlights: [good()] },
          empty: { highlights: [] },
          notobj: 7,
        },
      }),
    });
    const s = store(fs);
    expect(s.get('good').highlights).toEqual([good()]);
    expect(s.get('').error).toBe('invalid-key');
    expect(s.get('empty')).toEqual({ highlights: [] });
    expect(s.get('notobj')).toEqual({ highlights: [] });
  });

  test('a failed save rolls the in-memory state back (memory and disk never disagree)', () => {
    const fs = memFs();
    const s = store(fs);
    s.put('a', [good()]);
    fs.writeFileSync.mockImplementationOnce(() => { throw new Error('ENOSPC'); });
    expect(s.put('a', [good({ id: 'h2', text: 'other' })])).toEqual({ error: 'write-failed' });
    expect(s.get('a').highlights).toEqual([good()]); // the previous value survived
  });

  test('the 2MB total cap refuses the write rather than dropping user data', () => {
    const fs = memFs();
    const s = store(fs);
    const big = Array.from({ length: 500 }, (_, i) => good({ id: `h${i}`, text: 'x'.repeat(5000) }));
    expect(s.put('a', big)).toEqual({ error: 'too-large' });
    expect(fs.writeFileSync).not.toHaveBeenCalled();
    expect(s.get('a')).toEqual({ highlights: [] });
  });

  test('sizeInBytes reflects the serialized document set', () => {
    const fs = memFs();
    const s = store(fs);
    const before = s.sizeInBytes();
    s.put('a', [good()]);
    expect(s.sizeInBytes()).toBeGreaterThan(before);
  });
});

// The pruneOrphanDocKeys suite that stood here asserted the bulk delete that defect B3 removed
// (highlights vanished once a note fell off the recents list). What replaced it is covered by
// tests/unit/b3-annotations-survive.test.js.
