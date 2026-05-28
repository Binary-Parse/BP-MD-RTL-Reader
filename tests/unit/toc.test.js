/**
 * Unit tests for buildTOC() heading extraction logic.
 */

import { describe, test, expect } from 'vitest';

function extractHeadings(markdown) {
  const lines = markdown.split('\n');
  const headings = [];
  for (const line of lines) {
    const m = /^(#{1,6})\s+(.+)$/.exec(line.trim());
    if (m) {
      const level = m[1].length;
      const text = m[2].trim();
      const slug = text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s-]/gu, '')
        .trim()
        .replace(/\s+/g, '-');
      headings.push({ level, text, slug });
    }
  }
  return headings;
}

describe('buildTOC() heading extraction', () => {
  test('extracts H1 heading', () => {
    const md = '# My Title\n\nSome content.';
    const headings = extractHeadings(md);
    expect(headings).toHaveLength(1);
    expect(headings[0]).toMatchObject({ level: 1, text: 'My Title', slug: 'my-title' });
  });

  test('extracts H2 heading', () => {
    const md = '## Section Title\n\nContent here.';
    const headings = extractHeadings(md);
    expect(headings).toHaveLength(1);
    expect(headings[0]).toMatchObject({ level: 2, text: 'Section Title', slug: 'section-title' });
  });

  test('extracts H3 heading', () => {
    const md = '### Sub Section\n\nContent.';
    const headings = extractHeadings(md);
    expect(headings).toHaveLength(1);
    expect(headings[0]).toMatchObject({ level: 3, text: 'Sub Section', slug: 'sub-section' });
  });

  test('extracts multiple headings in correct order', () => {
    const md = ['# Title', '', 'Intro paragraph.', '', '## Section', '', 'Section content.', '', '### Sub', '', 'Sub content.'].join('\n');
    const headings = extractHeadings(md);
    expect(headings).toHaveLength(3);
    expect(headings[0]).toMatchObject({ level: 1, text: 'Title', slug: 'title' });
    expect(headings[1]).toMatchObject({ level: 2, text: 'Section', slug: 'section' });
    expect(headings[2]).toMatchObject({ level: 3, text: 'Sub', slug: 'sub' });
  });

  test('handles Arabic headings', () => {
    const md = '## عنوان القسم\n\nMuhContent.';
    const headings = extractHeadings(md);
    expect(headings).toHaveLength(1);
    expect(headings[0].level).toBe(2);
    expect(headings[0].text).toBe('عنوان القسم');
  });

  test('returns empty array for content with no headings', () => {
    const md = 'Just some paragraph text.\n\nAnother paragraph.';
    const headings = extractHeadings(md);
    expect(headings).toHaveLength(0);
  });

  test('ignores lines that look like headings but are not', () => {
    const md = '####### Too many hashes\n#NoSpaceAfterHash';
    const headings = extractHeadings(md);
    expect(headings).toHaveLength(0);
  });

  test('trims whitespace from heading text', () => {
    const md = '#   Spaced Out Title   ';
    const headings = extractHeadings(md);
    expect(headings[0].text).toBe('Spaced Out Title');
  });

  test('slugifies special characters away', () => {
    const md = '# Title: With *Special* Chars!';
    const headings = extractHeadings(md);
    expect(headings[0].slug).toBe('title-with-special-chars');
  });
});
