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
