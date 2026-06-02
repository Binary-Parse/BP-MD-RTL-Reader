/**
 * @vitest-environment jsdom
 *
 * export.test.js — T-F12: the export-document builder, extracted from app.js into an
 * import-testable module. jsdom-tested with an injected fake parseMarkdown (the app's
 * real configured marked + DOMPurify are exercised by the e2e).
 */
import { describe, test, expect } from 'vitest';
import { buildExportDoc } from '../../src/renderer/export.js';

const md = (s) => `<p>${s}</p>`; // a trivial fake parseMarkdown

describe('buildExportDoc (T-F12)', () => {
  test('returns a standalone HTML doc + the extension-stripped base name', () => {
    const { fullHtml, baseName } = buildExportDoc({ name: 'Report.md', content: 'hi' }, { parseMarkdown: md });
    expect(baseName).toBe('Report');
    expect(fullHtml).toContain('<!DOCTYPE html>');
    expect(fullHtml).toMatch(/<p[^>]*>hi<\/p>/); // applyBidi adds a dir attribute to the block
    expect(fullHtml).toContain('<title>Report</title>');
  });

  test('strips .md/.markdown/.txt case-insensitively; empty name → "document"', () => {
    expect(buildExportDoc({ name: 'A.MARKDOWN', content: '' }, { parseMarkdown: md }).baseName).toBe('A');
    expect(buildExportDoc({ name: 'notes.TXT', content: '' }, { parseMarkdown: md }).baseName).toBe('notes');
    expect(buildExportDoc({ name: '.md', content: '' }, { parseMarkdown: md }).baseName).toBe('document');
  });

  test('csp:true embeds a strict CSP meta; csp:false (default) does not', () => {
    expect(buildExportDoc({ name: 'a', content: '' }, { parseMarkdown: md, csp: true }).fullHtml)
      .toMatch(/Content-Security-Policy[^>]*default-src 'none'/);
    expect(buildExportDoc({ name: 'a', content: '' }, { parseMarkdown: md }).fullHtml)
      .not.toContain('Content-Security-Policy');
  });

  test('manualRtl forces an RTL document (lang=ar, dir=rtl)', () => {
    const { fullHtml } = buildExportDoc({ name: 'a', content: 'hello' }, { parseMarkdown: md, manualRtl: true });
    expect(fullHtml).toMatch(/<html lang="ar" dir="rtl">/);
  });

  test('Arabic content (first-strong) derives RTL even without a manual override', () => {
    const { fullHtml } = buildExportDoc({ name: 'ar', content: 'مرحبا بكم' }, { parseMarkdown: md });
    expect(fullHtml).toMatch(/dir="rtl"/);
  });

  test('front-matter direction overrides content first-strong', () => {
    const { fullHtml } = buildExportDoc({ name: 'fm', content: '---\ndirection: rtl\n---\nEnglish body' }, { parseMarkdown: md });
    expect(fullHtml).toMatch(/dir="rtl"/);
  });

  test('without katex, restoreMath is skipped (no crash when math globals absent)', () => {
    expect(() => buildExportDoc({ name: 'a', content: '$x$' }, { parseMarkdown: md, katex: null })).not.toThrow();
  });
});
