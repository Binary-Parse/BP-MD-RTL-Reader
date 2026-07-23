/**
 * rendering.test.js — T-F14 callouts, T-F7 outline, T-F15 task lists.
 * Uses the real `marked` (devDependency) for integration-level confidence.
 */
import { describe, test, expect } from 'vitest';
import { marked } from 'marked';
import { parseCalloutHeader, CALLOUT_TYPES, parseMarkdown, configureMarked } from '../../src/renderer/markdown/markdown.js';
import { extractHeadings, activeHeading } from '../../src/renderer/components/outline.js';

describe('callouts (T-F14)', () => {
  test('parses [!TYPE] with and without title', () => {
    expect(parseCalloutHeader('[!NOTE]')).toEqual({ type: 'note', title: 'Note' });
    expect(parseCalloutHeader('[!warning] Careful!')).toEqual({ type: 'warning', title: 'Careful!' });
  });
  test('rejects unknown type / plain text', () => {
    expect(parseCalloutHeader('[!bogus]')).toBeNull();
    expect(parseCalloutHeader('just a quote')).toBeNull();
  });
  test('all five GFM alert types recognized', () => {
    for (const t of ['note', 'tip', 'important', 'warning', 'caution']) {
      expect(CALLOUT_TYPES).toContain(t);
      expect(parseCalloutHeader(`[!${t.toUpperCase()}]`).type).toBe(t);
    }
  });
});

describe('outline (T-F7)', () => {
  const md = '# Title\n\n## Section A\n\ntext\n\n## Section A\n\n### في فعل القراءة\n';
  test('extracts h1–h3 with deduped, Arabic-aware slugs', () => {
    const h = extractHeadings(md, { marked });
    expect(h.map(x => `${x.level}:${x.slug}`)).toEqual([
      '1:title', '2:section-a', '2:section-a-1', '3:في-فعل-القراءة',
    ]);
  });
  test('activeHeading scroll-sync', () => {
    const offsets = [0, 200, 600];
    expect(activeHeading(0, offsets)).toBe(0);
    expect(activeHeading(250, offsets)).toBe(1);
    expect(activeHeading(10000, offsets)).toBe(2);
    expect(activeHeading(0, [])).toBe(-1);
  });
});

describe('task lists (T-F15)', () => {
  test('GFM checkboxes render as inputs', () => {
    configureMarked(marked);
    const html = parseMarkdown('- [ ] todo\n- [x] done', { marked, DOMPurify: { sanitize: (s) => s } });
    expect(html).toMatch(/type="checkbox"/);
    expect(html).toMatch(/checked/);
  });
});
