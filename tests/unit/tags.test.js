/**
 * Unit tests for tag extraction logic (renderTags)
 */

import { describe, test, expect } from 'vitest';

function extractTags(content) {
  const tagMap = {};
  const re = /(?:^|\s)#([\p{L}\p{N}_-]+)/gu;
  let m;
  while ((m = re.exec(content)) !== null) {
    if (!tagMap[m[1]]) tagMap[m[1]] = 0;
    tagMap[m[1]]++;
  }
  return tagMap;
}

function extractTagsFromFiles(files) {
  const tagMap = {};
  files.forEach((f, i) => {
    const re = /(?:^|\s)#([\p{L}\p{N}_-]+)/gu;
    let m;
    while ((m = re.exec(f.content || '')) !== null) {
      if (!tagMap[m[1]]) tagMap[m[1]] = [];
      if (!tagMap[m[1]].includes(i)) tagMap[m[1]].push(i);
    }
  });
  return tagMap;
}

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
});
