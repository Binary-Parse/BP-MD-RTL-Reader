/**
 * Unit tests for vaultSearch() pure function
 */

import { describe, test, expect } from 'vitest';
import { vaultSearch, warmSearchIndexSlice } from '../../src/renderer/components/search.js';

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function createVaultSearch(files) {
  return (query) => vaultSearch(query, files);
}

describe('vaultSearch()', () => {
  test('empty query returns []', () => {
    const search = createVaultSearch([{ name: 'a.md', content: 'hello world' }]);
    expect(search('')).toEqual([]);
    expect(search('a')).toEqual([]);
  });

  test('empty files returns []', () => {
    expect(vaultSearch('hello', [])).toEqual([]);
  });

  test('match in content returns hit with context', () => {
    const files = [{ name: 'note.md', content: 'This is a test note with hello inside.' }];
    const results = vaultSearch('hello', files);
    expect(results).toHaveLength(1);
    expect(results[0].fileIdx).toBe(0);
    expect(results[0].hits).toHaveLength(1);
    expect(results[0].hits[0].match).toBe('hello');
  });

  test('two-file vault returns 2 results', () => {
    const files = [
      { name: 'alpha.md', content: 'The quick brown fox jumps over the lazy dog' },
      { name: 'beta.md', content: 'Another quick reference for testing purposes' }
    ];
    const results = vaultSearch('quick', files);
    expect(results).toHaveLength(2);
    expect(results.some(r => r.name === 'alpha.md')).toBe(true);
    expect(results.some(r => r.name === 'beta.md')).toBe(true);
  });

  test('5-hit cap per file enforced', () => {
    const content = Array.from({ length: 10 }, (_, i) => `hit${i} target`).join('\n\n');
    const files = [{ name: 'many.md', content }];
    const results = vaultSearch('target', files);
    expect(results).toHaveLength(1);
    expect(results[0].hits.length).toBeLessThanOrEqual(5);
  });

  test('name-only match returns file with empty hits', () => {
    const files = [
      { name: 'project-notes.md', content: 'Something unrelated entirely.' },
      { name: 'recipes.md', content: 'More unrelated content.' }
    ];
    const results = vaultSearch('project', files);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('project-notes.md');
    expect(results[0].hits).toHaveLength(0);
  });

  test('case-insensitive matching', () => {
    const files = [{ name: 'case.md', content: 'Hello WORLD hello World' }];
    const results = vaultSearch('hello', files);
    expect(results).toHaveLength(1);
    expect(results[0].hits.length).toBe(2);
  });

  test('no match returns []', () => {
    const files = [{ name: 'a.md', content: 'cats and dogs' }];
    expect(vaultSearch('zzznomatch', files)).toEqual([]);
  });

  test('caps total result cards for very large vaults', () => {
    const files = Array.from({ length: 150 }, (_, i) => ({ name: `${i}.md`, content: 'shared needle' }));
    expect(vaultSearch('needle', files)).toHaveLength(100);
  });

  test('query at start of content produces no ellipsis prefix', () => {
    const files = [{ name: 'a.md', content: 'hello world' }];
    const results = vaultSearch('hello', files);
    expect(results[0].hits[0].ellipsisBefore).toBe(false);
  });

  test('query near end of long content produces ellipsis suffix', () => {
    const longContent = 'a'.repeat(200) + ' hello' + 'b'.repeat(50);
    const files = [{ name: 'a.md', content: longContent }];
    const results = vaultSearch('hello', files);
    expect(results[0].hits[0].ellipsisAfter).toBe(true);
  });
});

describe('vaultSearch — mutation killers (audit #8)', () => {
  // L7:17 — query.length < 2 → query.length <= 2: only 3+ char queries allowed.
  test('2-char query is accepted (kills L7 EqualityOperator mutant)', () => {
    const files = [{ name: 'a.md', content: 'go for it' }];
    const r = vaultSearch('go', files);
    expect(r).toHaveLength(1);
    expect(r[0].hits[0].match).toBe('go');
  });

  // L20:36 — idx + query.length + 40 → idx - query.length: snippet 'after'
  // ends way before the match. With mutant, the after region is gone/wrong.
  test('snippet "after" contains text following the match (kills L20 ArithmeticOperator)', () => {
    const files = [{ name: 'a.md', content: 'before hello world after' }];
    const r = vaultSearch('hello', files);
    expect(r[0].hits[0].after).toContain('world');
  });

  // L21:41 — /\n+/g → /\n/g changes collapse-then-space to per-newline-space.
  // Content 'foo\n\nbar' → original: 'foo bar' (1 space), mutant: 'foo  bar' (2 spaces).
  test('multiple consecutive newlines collapse to a single space in raw (kills L21:41 Regex)', () => {
    const files = [{ name: 'a.md', content: 'foo\n\n\nhello\n\nbar' }];
    const r = vaultSearch('hello', files);
    const raw = r[0].hits[0].before + r[0].hits[0].match + r[0].hits[0].after;
    // Original collapses 3 newlines → 1 space; mutant leaves 3 spaces.
    expect(raw).not.toMatch(/  /);
  });

  // L21:19 — c.slice(a, b).replace(...) → c.replace(...): snippet becomes
  // entire file content. before would contain the whole pre-match text.
  test('snippet "before" stays within the 40-char context window (kills L21:19 slice removal)', () => {
    const files = [{ name: 'a.md', content: 'x'.repeat(100) + 'hello' + 'y'.repeat(100) }];
    const r = vaultSearch('hello', files);
    // before should be at most ~40 chars; mutant would be ~100
    expect(r[0].hits[0].before.length).toBeLessThanOrEqual(40);
  });

  // L21:49 — replace's second arg ' ' → '': newlines stripped not spaced.
  // Content 'foo\nhello\nbar' → original 'foo hello bar', mutant 'foohellobar'.
  test('newline replacement uses a SPACE not empty string (kills L21:49 StringLiteral)', () => {
    const files = [{ name: 'a.md', content: 'alpha\nhello\nomega' }];
    const r = vaultSearch('hello', files);
    const reconstructed = r[0].hits[0].before + r[0].hits[0].match + r[0].hits[0].after;
    // Original: 'alpha hello omega'; mutant: 'alphahelloomega'
    expect(reconstructed).toContain('alpha hello');
    expect(reconstructed).toContain('hello omega');
  });

  // L22:22 — relIdx = idx - a → idx + a: relIdx points wrong → match field wrong.
  test('hit.match equals the original query text (kills L22 ArithmeticOperator)', () => {
    const files = [{ name: 'a.md', content: 'x'.repeat(100) + 'hello' + 'y'.repeat(100) }];
    const r = vaultSearch('hello', files);
    expect(r[0].hits[0].match).toBe('hello');
  });

  // L24:17 — before: raw.slice(0, relIdx) → raw: before becomes whole snippet.
  test('hit.before does NOT contain the match itself (kills L24 MethodExpression)', () => {
    const files = [{ name: 'a.md', content: 'before hello after' }];
    const r = vaultSearch('hello', files);
    expect(r[0].hits[0].before).not.toContain('hello');
  });

  // L26:16 — after: raw.slice(relIdx + query.length) → raw: after = whole snippet.
  test('hit.after does NOT contain the match itself (kills L26:16 MethodExpression)', () => {
    const files = [{ name: 'a.md', content: 'before hello after' }];
    const r = vaultSearch('hello', files);
    expect(r[0].hits[0].after).not.toContain('hello');
  });

  // L26:26 — slice(relIdx + query.length) → slice(relIdx - query.length):
  // after region overlaps backward into the match/before. Easy to detect
  // because after would start with the LAST chars of the query.
  test('hit.after starts AFTER the match (kills L26:26 ArithmeticOperator)', () => {
    const files = [{ name: 'a.md', content: 'pre hello tail' }];
    const r = vaultSearch('hello', files);
    // Original after starts with ' tail'; mutant starts with chars from inside 'hello'
    expect(r[0].hits[0].after.startsWith(' tail')).toBe(true);
  });

  // L27:25 — ellipsisBefore: a > 0 → false: never sets the prefix ellipsis.
  // Test: query in the middle of long content → a > 0 → ellipsisBefore = true.
  test('ellipsisBefore is TRUE when match is far from start (kills L27 ConditionalExpression)', () => {
    const files = [{ name: 'a.md', content: 'x'.repeat(200) + ' hello world' }];
    const r = vaultSearch('hello', files);
    expect(r[0].hits[0].ellipsisBefore).toBe(true);
  });

  // L28:24 ConditionalExpression → true: ellipsisAfter always true.
  // Test: query AT END → b === c.length → ellipsisAfter = false.
  test('ellipsisAfter is FALSE when match reaches end of content (kills L28 ConditionalExpression)', () => {
    const files = [{ name: 'a.md', content: 'pretext hello' }];
    const r = vaultSearch('hello', files);
    expect(r[0].hits[0].ellipsisAfter).toBe(false);
  });

  // L28:24 EqualityOperator b < c.length → b <= c.length: when b exactly
  // equals c.length, original is false, mutant is true. The case "query
  // exactly at end" hits this — same test as above asserts ellipsisAfter
  // is false. Mutant would return true. ✓
});

describe('vaultSearch — audit #7 survivors', () => {
  // (a) L20:36 — b = Math.min(c.length, idx + query.length + 40).
  // The prior "after contains world" test does NOT kill the
  // "+ query.length" → "- query.length" mutant: in short content c.length
  // caps b identically for both. We must pin the snippet's END offset where
  // (idx + query.length + 40) is the LIMITING term, not c.length.
  //
  // Layout: 50×'X' + 'hello' (5) + 50×'Y'  → length 105, idx('hello') = 50.
  //   a = max(0, 50 - 40)            = 10
  //   b = min(105, 50 + 5 + 40)      = min(105, 95)  = 95   (95 < 105 → cap is the arithmetic)
  //   raw    = c.slice(10, 95)                       length 85
  //   relIdx = 50 - 10 = 40
  //   after  = raw.slice(40 + 5) = c.slice(55, 95)   = 40×'Y'
  // Mutant ("- query.length"):
  //   b = min(105, 50 - 5 + 40)      = min(105, 85)  = 85
  //   after = c.slice(55, 85)        = 30×'Y'  → length differs (30 vs 40).
  test('snippet context window extends query.length+40 past the match (kills L20 "+ query.length" survivor)', () => {
    const content = 'X'.repeat(50) + 'hello' + 'Y'.repeat(50);
    const files = [{ name: 'win.md', content }];
    const r = vaultSearch('hello', files);
    const hit = r[0].hits[0];
    // Exact END-of-window assertion: 40 trailing chars survive; mutant yields 30.
    expect(hit.after).toBe('Y'.repeat(40));
    expect(hit.after.length).toBe(40);
    // And ellipsisAfter must be true since b (95) < c.length (105).
    expect(hit.ellipsisAfter).toBe(true);
  });

  // (b) L33:51 — hits: hits.length > 0 ? hits : []. The ternary has two
  // arms; pin BOTH so flipping the condition or swapping arms fails.
  test('content match populates hits via the truthy arm of the ternary (kills L33 survivor)', () => {
    const files = [{ name: 'has-hit.md', content: 'word and more words here' }];
    const r = vaultSearch('word', files);
    expect(r).toHaveLength(1);
    // Truthy arm: must be the real hits array, non-empty.
    expect(Array.isArray(r[0].hits)).toBe(true);
    expect(r[0].hits.length).toBeGreaterThan(0);
    expect(r[0].hits[0].match).toBe('word');
  });

  test('name-only match takes the falsy arm and yields exactly [] (kills L33 survivor)', () => {
    // "guide" matches the NAME only; content has no occurrence → hits === [].
    const files = [{ name: 'guide.md', content: 'totally unrelated body text' }];
    const r = vaultSearch('guide', files);
    expect(r).toHaveLength(1);
    expect(r[0].hits).toEqual([]);
    expect(r[0].hits).toHaveLength(0);
  });

  // (c) L11:13 — const c = f.content || ''. Exercise the falsy-content branch:
  // '', undefined, and a missing key must not crash and must behave sensibly.
  test('empty-string content does not crash; name match still returns file with [] hits (kills L11 || "" no-coverage)', () => {
    const files = [{ name: 'empty.md', content: '' }];
    const r = vaultSearch('empty', files); // matches name only
    expect(r).toHaveLength(1);
    expect(r[0].name).toBe('empty.md');
    expect(r[0].hits).toEqual([]);
  });

  // Pins that the falsy-content DEFAULT is an EMPTY string (not any sentinel).
  // A StringLiteral mutant '' → "<something>" would let a content search of
  // that sentinel match; with the real empty default it must find nothing.
  test('falsy content default is empty — sentinel-like search over no-body file finds nothing (kills L11 StringLiteral mutant)', () => {
    const files = [{ name: 'x.md', content: undefined }];
    // "stryker" and "here" are words a mutated default string might contain.
    expect(vaultSearch('stryker', files)).toEqual([]);
    expect(vaultSearch('here', files)).toEqual([]);
    expect(vaultSearch('was', files)).toEqual([]);
  });

  test('undefined content does not crash and is treated as no body (kills L11 || "" no-coverage)', () => {
    const files = [{ name: 'topic.md', content: undefined }];
    // Query matches the name → file returned with empty hits, no throw.
    expect(() => vaultSearch('topic', files)).not.toThrow();
    const r = vaultSearch('topic', files);
    expect(r).toHaveLength(1);
    expect(r[0].hits).toEqual([]);
  });

  test('missing content key + query absent from name returns no result (kills L11 || "" no-coverage)', () => {
    const files = [{ name: 'plain.md' }]; // no content property at all
    expect(() => vaultSearch('zzz-nowhere', files)).not.toThrow();
    expect(vaultSearch('zzz-nowhere', files)).toEqual([]);
  });
});

// audit UX-03: Arabic queries additionally match a tashkeel-stripped, hamza-folded
// normalization of each file, while hits still report ORIGINAL (as-written) spans.
describe('vaultSearch — Arabic normalization (audit UX-03)', () => {
  const vocalized = {
    name: 'note.md',
    content: 'ذَكَرَ الكِتَابُ في مُحَمَّد بن عبد الله',
  };

  test('a bare query matches the fully vocalized text and maps back to the original span', () => {
    const r = vaultSearch('محمد', [vocalized]);
    expect(r).toHaveLength(1);
    expect(r[0].hits).toHaveLength(1);
    expect(r[0].hits[0].match).toBe('مُحَمَّد');
  });

  test('كتاب matches the vocalized الكِتَابُ (and الكتاب includes the article)', () => {
    const r = vaultSearch('كتاب', [vocalized]);
    expect(r).toHaveLength(1);
    // The query is matched in normalized space and mapped back to the vocalized original
    // span — exactly the letters that were matched, diacritics included.
    expect(r[0].hits[0].match).toBe('كِتَابُ');
    expect(vaultSearch('الكتاب', [vocalized])[0].hits[0].match).toBe('الكِتَابُ');
  });

  test('a vocalized query matches the bare text too', () => {
    const r = vaultSearch('مُحَمَّد', [{ name: 'bare.md', content: 'قال محمد بن عبد الله' }]);
    expect(r).toHaveLength(1);
    expect(r[0].hits[0].match).toBe('محمد');
  });

  test('a Latin query on the same file keeps the original fast path (no spurious match)', () => {
    expect(vaultSearch('muhammad', [vocalized])).toEqual([]);
    expect(vaultSearch('zzz', [vocalized])).toEqual([]);
  });

  test('matching is case-insensitive for Latin exactly as before', () => {
    const files = [{ name: 'a.md', content: 'Hello WORLD' }];
    expect(vaultSearch('hello', files)[0].hits[0].match).toBe('Hello');
  });

  test('name matching also folds hamza (إسلام.md found by اسلام)', () => {
    const files = [{ name: 'إسلام.md', content: 'no body match here' }];
    const r = vaultSearch('اسلام', files);
    expect(r).toHaveLength(1);
    expect(r[0].name).toBe('إسلام.md');
    expect(r[0].hits).toEqual([]);
  });

  test('Arabic hits respect the 5-per-file cap and the 40-char snippet window', () => {
    const content = Array.from({ length: 8 }, () => 'مُحَمَّد هنا').join('\n\n');
    const r = vaultSearch('محمد', [{ name: 'many.md', content }]);
    expect(r[0].hits.length).toBe(5);
    expect(r[0].hits[0].match).toBe('مُحَمَّد');
  });

  test('an Arabic name + Arabic body still returns content hits with original spelling', () => {
    const files = [{ name: 'مذكرة.md', content: 'مُحَمَّد كتب' }];
    const r = vaultSearch('محمد', files);
    expect(r).toHaveLength(1);
    expect(r[0].hits[0].match).toBe('مُحَمَّد');
  });

  // 'İ'.toLowerCase() is 'i' + combining dot (U+0307): its UTF-16 length GROWS, so
  // lowercasing AFTER building the index map left map[] and the searched string indexed
  // differently — a large İ prefix made map[idx] undefined and NaN-spilled the whole file
  // into the hit's "after" region. The map is now built over the lowercased text, so map
  // and search string are the same string.
  test('an İ prefix no longer desyncs the Arabic map from the searched string', () => {
    const files = [{ name: 'i.md', content: 'İİİİİİكتاب' }];
    const r = vaultSearch('كتاب', files);
    expect(r).toHaveLength(1);
    expect(r[0].hits).toHaveLength(1);
    expect(r[0].hits[0].after).toBe('');
  });
});

// audit PERF-06: the idle pre-warm walks the vault in slices. Warming must only populate
// the same cache the real query uses — never change what a search returns.
describe('warmSearchIndexSlice (audit PERF-06)', () => {
  const files = () => [
    { name: 'a.md', content: 'Alpha needle' },
    { name: 'b.md', content: 'Beta needle' },
    { name: 'c.md', content: 'Gamma needle' },
  ];

  test('warms a whole 3-file slice and reports how many files it saw', () => {
    expect(warmSearchIndexSlice(files(), 0, 3)).toBe(3);
    expect(warmSearchIndexSlice(files(), 0, 1)).toBe(1);
    expect(warmSearchIndexSlice(files(), 1, 3)).toBe(2);
  });

  test('the warm step is idempotent (the cache is keyed per file/content)', () => {
    const vault = files();
    expect(warmSearchIndexSlice(vault, 0, 3)).toBe(3);
    expect(warmSearchIndexSlice(vault, 0, 3)).toBe(3); // second pass reuses, still counts
  });

  test('warming does not change the results a cold query returns', () => {
    const cold = vaultSearch('needle', files());
    const vault = files();
    warmSearchIndexSlice(vault, 0, 3);
    const warm = vaultSearch('needle', vault);
    expect(warm).toEqual(cold);
    expect(warm).toHaveLength(3);
  });

  test('out-of-range and degenerate slices are no-ops', () => {
    const vault = files();
    expect(warmSearchIndexSlice(vault, 5, 9)).toBe(0);   // from > length
    expect(warmSearchIndexSlice(vault, 3, 3)).toBe(0);   // empty slice
    expect(warmSearchIndexSlice(vault, -2, 0)).toBe(0);  // from < 0 is not a valid start
    expect(warmSearchIndexSlice(vault, 0, 1)).toBe(1);   // still usable afterwards
    expect(warmSearchIndexSlice(null, 0, 1)).toBe(0);    // non-array
    expect(warmSearchIndexSlice([null, undefined], 0, 2)).toBe(0); // falsy entries skipped
  });
});

// RTL-M5 (2026-09-26): a query of pure tashkeel/tatweel normalizes to '' — that is a
// miss for everything, not a match for everything (indexOf('') flooded every file).
describe('vaultSearch empty normalization (RTL-M5)', () => {
  test('a pure-diacritics query returns no results instead of matching every file', () => {
    const files = [
      { name: 'a.md', path: 'a.md', content: 'محمد' },
      { name: 'b.md', path: 'b.md', content: 'other' },
    ];
    expect(vaultSearch('ًّ', files)).toEqual([]);
    expect(vaultSearch('َُ', files)).toEqual([]);
  });
});
