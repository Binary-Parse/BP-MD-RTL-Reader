/**
 * Unit tests for vaultSearch() pure function
 */

import { describe, test, expect } from 'vitest';
import { vaultSearch } from '../../src/renderer/search.js';

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
