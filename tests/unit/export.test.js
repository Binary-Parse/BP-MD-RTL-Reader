/**
 * @vitest-environment jsdom
 *
 * export.test.js — T-F12: the export-document builder, extracted from app.js into an
 * import-testable module. jsdom-tested with an injected fake parseMarkdown (the app's
 * real configured marked + DOMPurify are exercised by the e2e).
 */
import { describe, test, expect } from 'vitest';
import { buildExportDoc, buildExportDocAsync } from '../../src/renderer/export.js';

const md = (s) => `<p>${s}</p>`; // a trivial fake parseMarkdown

describe('buildExportDoc (T-F12)', () => {
  test('returns a standalone HTML doc + the extension-stripped base name', () => {
    const { fullHtml, baseName } = buildExportDoc({ name: 'Report.md', content: 'hi' }, { parseMarkdown: md });
    expect(baseName).toBe('Report');
    expect(fullHtml).toContain('<!DOCTYPE html>');
    expect(fullHtml).toMatch(/<p[^>]*>hi<\/p>/); // applyBidi adds a dir attribute to the block
    expect(fullHtml).toContain('<title>Report</title>');
    expect(fullHtml).toContain('img { max-width: 100%; height: auto; }'); // responsive images in PDF
  });

  test('strips .md/.markdown/.txt case-insensitively; empty name → "document"', () => {
    expect(buildExportDoc({ name: 'A.MARKDOWN', content: '' }, { parseMarkdown: md }).baseName).toBe('A');
    expect(buildExportDoc({ name: 'notes.TXT', content: '' }, { parseMarkdown: md }).baseName).toBe('notes');
    expect(buildExportDoc({ name: '.md', content: '' }, { parseMarkdown: md }).baseName).toBe('document');
  });

  test('every standalone export embeds a network-denying CSP', () => {
    expect(buildExportDoc({ name: 'a', content: '' }, { parseMarkdown: md }).fullHtml)
      .toMatch(/Content-Security-Policy[^>]*default-src 'none'/);
  });

  test('explicit rtl forces an RTL document (lang=ar, dir=rtl)', () => {
    const { fullHtml } = buildExportDoc({ name: 'a', content: 'hello' }, { parseMarkdown: md, direction: 'rtl' });
    expect(fullHtml).toMatch(/<html lang="ar" dir="rtl">/);
  });

  test('explicit ltr is not collapsed back to automatic direction', () => {
    const { fullHtml } = buildExportDoc({ name: 'a', content: 'مرحبا بكم' }, { parseMarkdown: md, direction: 'ltr' });
    expect(fullHtml).toMatch(/<html lang="en" dir="ltr">/);
  });

  test('preserves a valid front-matter language independent of script direction', () => {
    const content = '---\nlang: fa\ndirection: rtl\n---\nمتن فارسی';
    expect(buildExportDoc({ name: 'fa', content }, { parseMarkdown: md }).fullHtml)
      .toMatch(/<html lang="fa" dir="rtl">/);
  });

  test('neutralizes remote and local images so opening an export cannot request them', () => {
    const parseMarkdown = () => '<p><img src="https://tracker.test/pixel" alt="remote"><img src="local.png" alt="local"></p>';
    const { fullHtml } = buildExportDoc({ name: 'safe', content: 'x' }, { parseMarkdown });
    expect(fullHtml).not.toContain('tracker.test');
    expect(fullHtml).not.toContain('src="local.png"');
    expect(fullHtml).toContain('[Image: remote]');
    expect(fullHtml).toContain('[Image: local]');
  });

  test('applies callout semantics and injected code highlighting before serialization', () => {
    const parseMarkdown = () => '<blockquote><p>[!NOTE] Heads up\nBody.</p></blockquote><pre><code class="language-js">const x=1</code></pre>';
    const hljs = { getLanguage: () => true, highlight: () => ({ value: '<span class="kw">const</span> x=1' }) };
    const { fullHtml } = buildExportDoc({ name: 'parity', content: 'x' }, { parseMarkdown, hljs, sanitizeHighlight: (s) => s });
    expect(fullHtml).toContain('<aside class="callout callout-note"');
    expect(fullHtml).toContain('role="note"');
    expect(fullHtml).toContain('class="language-js hljs"');
  });

  test('async export renders Mermaid when the optional local engine is available', async () => {
    const parseMarkdown = () => '<pre><code class="language-mermaid">graph TD; A--&gt;B</code></pre>';
    const loadMermaid = async () => ({ render: async () => ({ svg: '<svg><text>diagram</text></svg>' }) });
    const DOMPurify = { sanitize: (value) => value };
    const { fullHtml } = await buildExportDocAsync({ name: 'diagram', content: 'x' }, { parseMarkdown, loadMermaid, DOMPurify });
    expect(fullHtml).toContain('<div class="mermaid" dir="ltr">');
    expect(fullHtml).toContain('<svg><text>diagram</text></svg>');
    expect(fullHtml).not.toContain('language-mermaid');
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

// ── Mutation-hardening (audit F-3): direction precedence, csp meta, baseName, math. ──
describe('buildExportDoc — exact output (mutation kills)', () => {
  const P = (s) => `<p>${s}</p>`;
  test('manual RTL override forces dir=rtl / lang=ar', () => {
    const { fullHtml } = buildExportDoc({ name: 'n.md', content: 'hello' }, { direction: 'rtl', parseMarkdown: P });
    expect(fullHtml).toContain('dir="rtl"');
    expect(fullHtml).toContain('lang="ar"');
  });
  test('LTR content → dir=ltr / lang=en (no override)', () => {
    const { fullHtml } = buildExportDoc({ name: 'n.md', content: 'plain english' }, { parseMarkdown: P });
    expect(fullHtml).toContain('dir="ltr"');
    expect(fullHtml).toContain('lang="en"');
  });
  test('Arabic content auto-resolves to rtl without a manual flag', () => {
    const { fullHtml } = buildExportDoc({ name: 'n.md', content: 'هذا نص عربي طويل بما يكفي' }, { parseMarkdown: P });
    expect(fullHtml).toContain('dir="rtl"');
  });
  test('strict CSP is unconditional', () => {
    expect(buildExportDoc({ name: 'n.md', content: 'x' }, { parseMarkdown: P }).fullHtml)
      .toContain("default-src 'none'");
  });
  test('baseName strips .md/.markdown/.txt (case-insensitive); empty → "document"', () => {
    expect(buildExportDoc({ name: 'Note.MD', content: 'x' }, { parseMarkdown: P }).baseName).toBe('Note');
    expect(buildExportDoc({ name: 'a.markdown', content: 'x' }, { parseMarkdown: P }).baseName).toBe('a');
    expect(buildExportDoc({ name: 'b.txt', content: 'x' }, { parseMarkdown: P }).baseName).toBe('b');
    expect(buildExportDoc({ name: '', content: 'x' }, { parseMarkdown: P }).baseName).toBe('document');
    expect(buildExportDoc({ content: 'x' }, { parseMarkdown: P }).baseName).toBe('document');
  });
  test('the parsed body text is embedded in the document body', () => {
    const { fullHtml } = buildExportDoc({ name: 'n.md', content: 'hi there' }, { parseMarkdown: P });
    expect(fullHtml).toContain('hi there');   // body text survives the bidi pass (attrs may be added)
    expect(fullHtml).toContain('<body>');
  });
  test('katex injected → restoreMath runs (no throw, body text preserved)', () => {
    const katex = { renderToString: (t) => `<span class="katex">${t}</span>` };
    const { fullHtml } = buildExportDoc({ name: 'm.md', content: 'E=mc^2' }, { parseMarkdown: P, katex, DOMPurify: null });
    expect(fullHtml).toContain('E=mc^2'); // builds without error when katex is present
  });
});
