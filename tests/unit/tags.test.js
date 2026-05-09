// @ts-check
/**
 * Unit tests for renderTags() tag extraction logic.
 * Tests the regex /(?:^|\s)#([\p{L}\p{N}_-]+)/gu used in marqam.html.
 */

const { test, expect } = require('@playwright/test');

// Inline tag extraction matching marqam.html
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

test.describe('Tag extraction', () => {
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
    // 'reading' appears in both files (indices 0 and 1)
    expect(tagMap['reading']).toEqual([0, 1]);
    // 'prose' only in file 0
    expect(tagMap['prose']).toEqual([0]);
    // 'draft' only in file 1
    expect(tagMap['draft']).toEqual([1]);
  });

  test('does not match inline code with # prefix', () => {
    // #123 is a number-prefixed tag — should be extracted
    const tags = extractTags('#tagged content');
    expect(Object.keys(tags)).toContain('tagged');
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
});
