/**
 * Unit tests for tag extraction — the real logic in src/renderer/components/tags.js
 * (used by renderTags() in app.js).
 */

import { describe, test, expect } from 'vitest';
import { extractTags, extractTagsFromFiles } from '../../src/renderer/components/tags.js';

describe('Tag extraction', () => {
  test('extracts single tag from text', () => {
    const tags = extractTags('Some content #reading here');
    expect(Object.keys(tags)).toContain('reading');
  });

  test('extracts multiple tags', () => {
    const tags = extractTags('Content #reading #prose and more #draft');
    expect(Object.keys(tags)).toContain('reading');
    expect(Object.keys(tags)).toContain('prose');
    expect(Object.keys(tags)).toContain('draft');
  });

  test('extracts Arabic tags', () => {
    const tags = extractTags('محتوى #قراءة و #أدب');
    expect(Object.keys(tags)).toContain('قراءة');
    expect(Object.keys(tags)).toContain('أدب');
  });

  test('deduplicates tags across files', () => {
    const files = [
      { content: 'File one #reading #prose' },
      { content: 'File two #reading #draft' }
    ];
    const tagMap = extractTagsFromFiles(files);
    expect(tagMap['reading']).toEqual([0, 1]);
    expect(tagMap['prose']).toEqual([0]);
    expect(tagMap['draft']).toEqual([1]);
  });

  test('handles empty content', () => {
    const tags = extractTags('');
    expect(Object.keys(tags)).toHaveLength(0);
  });

  test('handles content with no tags', () => {
    const tags = extractTags('Just plain text with no tags here.');
    expect(Object.keys(tags)).toHaveLength(0);
  });

  test('extracts tags with hyphens and underscores', () => {
    const tags = extractTags('Content #my-tag and #my_tag and #tag123');
    expect(Object.keys(tags)).toContain('my-tag');
    expect(Object.keys(tags)).toContain('my_tag');
    expect(Object.keys(tags)).toContain('tag123');
  });

  test('does not match hashtag inside a word', () => {
    const tags = extractTags('word#notag');
    expect(Object.keys(tags)).toHaveLength(0);
  });

  test('counts repeated tags in same file', () => {
    const tags = extractTags('#tag #tag #tag');
    expect(tags['tag']).toBe(3);
  });

  test('extractTagsFromFiles returns {} for null/undefined input', () => {
    expect(extractTagsFromFiles(null)).toEqual({});
    expect(extractTagsFromFiles(undefined)).toEqual({});
  });

  test('extractTagsFromFiles tolerates files with missing/empty content', () => {
    const tagMap = extractTagsFromFiles([{ name: 'a.md' }, { content: '' }, { content: '#reading' }]);
    expect(tagMap['reading']).toEqual([2]);
  });

  test('extractTagsFromFiles records a file index once even when a tag repeats in that file', () => {
    const tagMap = extractTagsFromFiles([{ content: '#reading and again #reading here' }]);
    expect(tagMap['reading']).toEqual([0]);
  });
  test('reserved Object prototype names are ordinary safe tags', () => {
    const tags = extractTags('#constructor #toString #hasOwnProperty #__proto__');
    expect(Object.entries(tags)).toEqual([
      ['constructor', 1], ['toString', 1], ['hasOwnProperty', 1], ['__proto__', 1],
    ]);
    const byFile = extractTagsFromFiles([{ content: '#constructor #__proto__' }, { content: '#constructor' }]);
    expect(byFile.constructor).toEqual([0, 1]);
    expect(byFile.__proto__).toEqual([0]);
  });
});

// audit PERF-05: the per-file tag list is cached on the file object, keyed by CONTENT (so a
// mutated buffer re-extracts) — a tree repaint must not re-regex the whole vault.
describe('extractTagsFromFiles caching (audit PERF-05)', () => {
  test('repeated calls over the same file objects return identical results', () => {
    const files = [
      { content: 'File one #reading #prose' },
      { content: 'File two #reading #draft' },
    ];
    const first = extractTagsFromFiles(files);
    const second = extractTagsFromFiles(files);
    expect(second).toEqual(first);
    expect(second.reading).toEqual([0, 1]);
  });

  test('the cache is keyed on content, not object identity: an edited buffer is re-scanned', () => {
    const files = [{ content: 'nothing here' }];
    expect(extractTagsFromFiles(files)).toEqual({});
    files[0].content = 'now with #fresh';
    expect(extractTagsFromFiles(files)).toEqual({ fresh: [0] });
    files[0].content = 'nothing here';
    expect(extractTagsFromFiles(files)).toEqual({});
  });

  test('a repeated tag still yields ONE index per file, even with the cached list', () => {
    const files = [
      { content: '#reading #reading and #reading' },
      { content: '#reading' },
    ];
    expect(extractTagsFromFiles(files).reading).toEqual([0, 1]);
    expect(extractTagsFromFiles(files).reading).toEqual([0, 1]);
  });

  test('files with missing/empty content share the empty result and never collide', () => {
    const files = [{ name: 'a.md' }, { content: '' }, { content: '#x' }, { name: 'b.md' }];
    expect(extractTagsFromFiles(files)).toEqual({ x: [2] });
  });
});
