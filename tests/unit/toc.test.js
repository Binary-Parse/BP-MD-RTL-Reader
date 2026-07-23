/**
 * Unit tests for extractHeadings() — the real document-outline logic in
 * src/renderer/components/outline.js. Uses the real `marked` lexer (devDependency) for
 * integration-level confidence, matching tests/unit/rendering.test.js.
 */

import { describe, test, expect } from 'vitest';
import { marked } from 'marked';
import { extractHeadings, sourceHeadingPositions } from '../../src/renderer/components/outline.js';

describe('extractHeadings() heading extraction', () => {
  test('source positions include Setext headings and keep duplicate text identities', () => {
    const md = 'Same\n====\n\n# Same\n\nSub\n---\n';
    expect(sourceHeadingPositions(md)).toEqual([
      { pos: 0, level: 1, text: 'Same' },
      { pos: 11, level: 1, text: 'Same' },
      { pos: 19, level: 2, text: 'Sub' },
    ]);
  });
  test('extracts H1 heading', () => {
    const headings = extractHeadings('# My Title\n\nSome content.', { marked });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toMatchObject({ level: 1, text: 'My Title', slug: 'my-title' });
  });

  test('extracts H2 heading', () => {
    const headings = extractHeadings('## Section Title\n\nContent here.', { marked });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toMatchObject({ level: 2, text: 'Section Title', slug: 'section-title' });
  });

  test('extracts H3 heading', () => {
    const headings = extractHeadings('### Sub Section\n\nContent.', { marked });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toMatchObject({ level: 3, text: 'Sub Section', slug: 'sub-section' });
  });

  test('extracts multiple headings in correct order', () => {
    const md = ['# Title', '', 'Intro paragraph.', '', '## Section', '', 'Section content.', '', '### Sub', '', 'Sub content.'].join('\n');
    const headings = extractHeadings(md, { marked });
    expect(headings).toHaveLength(3);
    expect(headings[0]).toMatchObject({ level: 1, text: 'Title', slug: 'title' });
    expect(headings[1]).toMatchObject({ level: 2, text: 'Section', slug: 'section' });
    expect(headings[2]).toMatchObject({ level: 3, text: 'Sub', slug: 'sub' });
  });

  test('handles Arabic headings', () => {
    const headings = extractHeadings('## عنوان القسم\n\nMuhContent.', { marked });
    expect(headings).toHaveLength(1);
    expect(headings[0].level).toBe(2);
    expect(headings[0].text).toBe('عنوان القسم');
  });

  test('returns empty array for content with no headings', () => {
    const headings = extractHeadings('Just some paragraph text.\n\nAnother paragraph.', { marked });
    expect(headings).toHaveLength(0);
  });

  test('ignores lines that look like headings but are not', () => {
    const headings = extractHeadings('####### Too many hashes\n#NoSpaceAfterHash', { marked });
    expect(headings).toHaveLength(0);
  });

  test('trims whitespace from heading text', () => {
    const headings = extractHeadings('#   Spaced Out Title   ', { marked });
    expect(headings[0].text).toBe('Spaced Out Title');
  });

  test('slugifies special characters away', () => {
    const headings = extractHeadings('# Title: With *Special* Chars!', { marked });
    expect(headings[0].slug).toBe('title-with-special-chars');
  });

  test('returns empty array when marked is not supplied', () => {
    expect(extractHeadings('# Title')).toHaveLength(0);
  });
});
