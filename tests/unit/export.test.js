/**
 * @vitest-environment jsdom
 *
 * export.test.js — T-F12: the export-document builder, extracted from app.js into an
 * import-testable module. jsdom-tested with an injected fake parseMarkdown (the app's
 * real configured marked + DOMPurify are exercised by the e2e).
 */
import { describe, test, expect, vi, afterEach } from 'vitest';
import { buildExportDoc, buildExportDocAsync, rtlLanguage } from '../../src/renderer/markdown/export.js';

const md = (s) => `<p>${s}</p>`; // a trivial fake parseMarkdown

describe('buildExportDoc (T-F12)', () => {
  test('QA-L3: headings carry the same unique ids as the reading view, so #links work', () => {
    const parse = () => '<h2>Notes</h2><p><a href="#notes-1">next</a></p><h2>Notes</h2>';
    const { fullHtml } = buildExportDoc({ name: 'a.md', content: 'x' }, { parseMarkdown: parse });
    expect(fullHtml).toMatch(/<h2[^>]*id="notes"/);
    expect(fullHtml).toMatch(/<h2[^>]*id="notes-1"/);
  });

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

  // frame-ancestors is ignored when a policy is delivered by <meta http-equiv> (W3C CSP3
  // §3.3), so declaring it here protected nothing and made every opened export log a console
  // error. The app's own document moved it to a real response header; a static exported file
  // has no response layer to move it to, so it is dropped instead of left to read as
  // protection. This assertion is what stops it drifting back in.
  test('does not embed directives that <meta> delivery ignores', () => {
    const { fullHtml } = buildExportDoc({ name: 'a', content: '' }, { parseMarkdown: md });
    expect(fullHtml).not.toContain('frame-ancestors');
    expect(fullHtml).not.toContain('report-uri');
    expect(fullHtml).not.toMatch(/Content-Security-Policy[^>]*sandbox/);
    // The directives that <meta> DOES honour must survive the removal.
    for (const kept of ['default-src', 'img-src', 'object-src', 'base-uri', 'form-action']) {
      expect(fullHtml, kept).toContain(kept);
    }
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

  // QA-M22: every RTL note without `lang:` used to be exported as Arabic.
  test('an RTL note without lang: is tagged by its letters (he / fa / ur / ar)', () => {
    const lang = (content) => buildExportDoc({ name: 'x', content }, { parseMarkdown: md }).fullHtml.match(/<html lang="([^"]*)"/)[1];
    expect(lang('שלום עולם, זה טקסט')).toBe('he');
    expect(lang('این یک متن فارسی است که گفتگو دارد')).toBe('fa');
    expect(lang('یہ اردو کا ایک جملہ ہے')).toBe('ur');
    expect(lang('هذا نص عربي خالص')).toBe('ar');
    expect(rtlLanguage('')).toBe('ar');
  });

  test('neutralizes remote and local images so opening an export cannot request them', () => {
    const parseMarkdown = () => '<p><img src="https://tracker.test/pixel" alt="remote"><img src="local.png" alt="local"></p>';
    const { fullHtml } = buildExportDoc({ name: 'safe', content: 'x' }, { parseMarkdown });
    expect(fullHtml).not.toContain('tracker.test');
    expect(fullHtml).not.toContain('src="local.png"');
    expect(fullHtml).toContain('[Image: remote]');
    expect(fullHtml).toContain('[Image: local]');
  });

  test('keeps embedded data images, strips media URLs, and converts wikilinks to inert text', () => {
    const parseMarkdown = () => [
      '<img src="data:image/png;base64,AA" alt="embedded">',
      '<video src="movie.mp4" poster="poster.png"></video>',
      '<audio src="sound.mp3"></audio>',
      '<source src="clip.mp4" srcset="clip-2x.mp4">',
      '<a class="wikilink" data-target="Target"></a>',
    ].join('');
    const { fullHtml } = buildExportDoc({ name: 'safe', content: 'x' }, { parseMarkdown });
    expect(fullHtml).toContain('src="data:image/png;base64,AA"');
    expect(fullHtml).not.toMatch(/movie\.mp4|poster\.png|sound\.mp3|clip-2x\.mp4/);
    expect(fullHtml).toContain('<span class="wikilink">Target</span>');
  });

  // Audit 3a: local-file markdown links would survive as dead links / epubcheck errors;
  // the shared pipeline neutralizes them for EVERY artifact (HTML, PDF, EPUB).
  test('neutralizes local-file links to inert text; web/mail/tel/anchors survive', () => {
    const parseMarkdown = () => [
      '<p><a href="README.md">docs</a></p>',
      '<p><a href="bpmd://vault/note">vault</a></p>',
      '<p><a href="https://x.test/a">web</a><a href="mailto:a@b">mail</a><a href="tel:+1">tel</a><a href="#sec">anchor</a></p>',
    ].join('');
    const { fullHtml } = buildExportDoc({ name: 'safe', content: 'x' }, { parseMarkdown });
    expect(fullHtml).not.toContain('README.md');
    expect(fullHtml).not.toContain('bpmd://');
    expect(fullHtml).toContain('<span>docs</span>');
    expect(fullHtml).toContain('<span>vault</span>');
    for (const kept of ['href="https://x.test/a"', 'href="mailto:a@b"', 'href="tel:+1"', 'href="#sec"']) {
      expect(fullHtml).toContain(kept);
    }
  });

  test('a kept data: image loses any srcset naming local variants', () => {
    const parseMarkdown = () => '<p><img src="data:image/png;base64,AA" alt="e" srcset="local-2x.png 2x"></p>';
    const { fullHtml } = buildExportDoc({ name: 'safe', content: 'x' }, { parseMarkdown });
    expect(fullHtml).toContain('src="data:image/png;base64,AA"');
    expect(fullHtml).not.toContain('local-2x.png');
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

  test('async export returns the built document when Mermaid is absent or fails to load', async () => {
    const ordinary = await buildExportDocAsync({ name: 'plain', content: 'x' }, { parseMarkdown: md });
    expect(ordinary.fullHtml).toMatch(/<p[^>]*dir="ltr"[^>]*>x<\/p>/);
    const parseMarkdown = () => '<pre><code class="language-mermaid">graph TD</code></pre>';
    const failed = await buildExportDocAsync(
      { name: 'diagram', content: 'x' },
      { parseMarkdown, loadMermaid: async () => { throw new Error('load failed'); } },
    );
    expect(failed.fullHtml).toContain('language-mermaid');
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

// T5.1c: the Notes appendix — the exported artifact carries the reader's highlights/notes
// when the open document has any, and stays byte-identical to before when it has none.
describe('buildExportDoc — Notes appendix (T5.1c)', () => {
  const P = (s) => `<p>${s}</p>`;
  const notes = [
    { id: 'h1', text: 'the first passage', note: 'Worth quoting', at: 1, anchor: { headingSlug: '', ordinal: 0 } },
    { id: 'h2', text: 'a bare highlight', note: '', at: 2, anchor: { headingSlug: '', ordinal: 0 } },
  ];

  test('no annotations → no appendix at all', () => {
    const { fullHtml } = buildExportDoc({ name: 'n.md', content: 'x' }, { parseMarkdown: P });
    // The stylesheet always names the class, so assert on the MARKUP form.
    expect(fullHtml).not.toContain('class="export-annotations"');
    expect(fullHtml).not.toContain('>Notes</h2>');
    // …including an explicitly empty array, which is what the renderer passes for a
    // document whose stored annotations belong to a DIFFERENT file.
    expect(buildExportDoc({ name: 'n.md', content: 'x' }, { parseMarkdown: P, annotations: [] }).fullHtml)
      .not.toContain('class="export-annotations"');
  });

  test('renders a section after the body with the label, each excerpt and each note', () => {
    const { fullHtml } = buildExportDoc({ name: 'n.md', content: 'body text' }, {
      parseMarkdown: P, annotations: notes, annotationsLabel: 'الملاحظات',
    });
    expect(fullHtml).toContain('<section class="export-annotations">');
    expect(fullHtml).toContain('الملاحظات');
    expect(fullHtml).toContain('the first passage');
    expect(fullHtml).toContain('Worth quoting');
    expect(fullHtml).toContain('a bare highlight');
    // The appendix sits at the END: after the rendered body paragraph (the stylesheet also
    // names the class, so search for the section MARKUP).
    expect(fullHtml.indexOf('<section class="export-annotations"')).toBeGreaterThan(fullHtml.indexOf('body text'));
    // A highlight without a note contributes no empty note paragraph (the stylesheet also
    // names the class, so count the MARKUP form only).
    expect(fullHtml.match(/class="export-annotation-note"/g)).toHaveLength(1);
  });

  test('the label defaults to "Notes" and note text is escaped, never markup', () => {
    const { fullHtml } = buildExportDoc({ name: 'n.md', content: 'x' }, {
      parseMarkdown: P,
      annotations: [{ id: 'h1', text: '<img src=x onerror=1>', note: '<script>bad()</script>', at: 1, anchor: {} }],
    });
    // applyBidi adds dir/data-dir to every block, so assert the heading TEXT, not the tag.
    expect(fullHtml).toContain('>Notes</h2>');
    expect(fullHtml).toContain('&lt;img src=x onerror=1&gt;');
    expect(fullHtml).toContain('&lt;script&gt;bad()&lt;/script&gt;');
    expect(fullHtml).not.toContain('<script>bad()');
  });

  test('malformed entries are skipped rather than throwing', () => {
    expect(() => buildExportDoc({ name: 'n.md', content: 'x' }, { parseMarkdown: P, annotations: [null, { text: '' }] }))
      .not.toThrow();
    const { fullHtml } = buildExportDoc({ name: 'n.md', content: 'x' }, {
      parseMarkdown: P, annotations: [null, { text: '' }, 'nope'],
    });
    expect(fullHtml).not.toContain('class="export-annotations"');
  });
});

describe('M19: the export keeps the column alignment and ties it to the direction', () => {
  test('left is the start of the cell, right its end, centre the centre', () => {
    const { fullHtml } = buildExportDoc({ name: 't.md', content: '| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |\n' }, { parseMarkdown: md });
    expect(fullHtml).toContain('th[align="left"], td[align="left"] { text-align: start; }');
    expect(fullHtml).toContain('th[align="right"], td[align="right"] { text-align: end; }');
    expect(fullHtml).toContain('th[align="center"], td[align="center"] { text-align: center; }');
  });
});

describe('RTL-H3: exported code stays LTR inside an RTL document', () => {
  test('the HTML export stylesheet pins pre and code to ltr', () => {
    const { fullHtml } = buildExportDoc({ name: 'كتاب.md', content: 'نص\n' }, { parseMarkdown: md, direction: 'rtl' });
    expect(fullHtml).toContain('direction: ltr; text-align: start;');
    expect(fullHtml).toContain('direction: ltr; unicode-bidi: isolate;');
  });
});

// W1 (owner report 2026-10-10): wrapping in the exported document. The geometry is measured in a
// real browser by tests/e2e/wrap-matrix.spec.js; these pin the document the export produces.
describe('W1: the exported document wraps instead of scrolling the page', () => {
  const table = () => '<p>before</p><table><thead><tr><th>a</th></tr></thead><tbody><tr><td>b</td></tr></tbody></table><table><tbody><tr><td>c</td></tr></tbody></table>';
  const bodyOf = (fullHtml) => {
    const host = document.createElement('div');
    host.innerHTML = fullHtml.slice(fullHtml.indexOf('<body>') + 6, fullHtml.indexOf('</body>'));
    return host;
  };

  test('every table sits alone inside its own scroll frame', () => {
    const body = bodyOf(buildExportDoc({ name: 'a.md', content: 'x' }, { parseMarkdown: table }).fullHtml);
    const tables = [...body.querySelectorAll('table')];
    expect(tables).toHaveLength(2);
    for (const t of tables) {
      expect(t.parentElement.className).toBe('table-frame');
      expect(t.parentElement.children).toHaveLength(1);
    }
    expect(body.querySelectorAll('.table-frame')).toHaveLength(2);
    expect(body.querySelector('.table-frame td').textContent).toBe('b');
    expect(body.firstElementChild.textContent).toBe('before'); // order kept: the frame replaces the table in place
    expect(body.children[1].className).toBe('table-frame');
  });

  test('the frame is a labelled region reachable by keyboard (the file runs no script)', () => {
    const en = bodyOf(buildExportDoc({ name: 'a.md', content: 'text' }, { parseMarkdown: table }).fullHtml).querySelector('.table-frame');
    expect(en.getAttribute('role')).toBe('region');
    expect(en.getAttribute('tabindex')).toBe('0');
    expect(en.getAttribute('aria-label')).toBe('Scrollable table');
  });

  test('the frame label follows the document language', () => {
    const label = (content) => bodyOf(buildExportDoc({ name: 'a.md', content }, { parseMarkdown: table }).fullHtml)
      .querySelector('.table-frame').getAttribute('aria-label');
    expect(label('نص عربي')).toBe('جدول قابل للتمرير أفقيًا');
    expect(label('---\nlang: AR-eg\n---\ntext')).toBe('جدول قابل للتمرير أفقيًا');
    expect(label('---\nlang: fa\n---\nنص')).toBe('Scrollable table');
  });

  test('the async export frames tables too', async () => {
    const { fullHtml } = await buildExportDocAsync({ name: 'a.md', content: 'x' }, { parseMarkdown: table });
    expect(bodyOf(fullHtml).querySelectorAll('.table-frame > table')).toHaveLength(2);
  });

  test('the stylesheet wraps prose and code and keeps wide blocks in their own box', () => {
    const { fullHtml } = buildExportDoc({ name: 'a.md', content: 'x' }, { parseMarkdown: md });
    const css = fullHtml.slice(fullHtml.indexOf('<style>'), fullHtml.indexOf('</style>'));
    expect(css).toMatch(/\nbody \{[^}]*overflow-wrap: anywhere;/);
    expect(css).toMatch(/\npre \{[^}]*white-space: pre-wrap; overflow-wrap: anywhere;/);
    expect(css).toMatch(/\n\.table-frame \{[^}]*max-width: 100%;[^}]*overflow-x: auto;/);
    expect(css).toMatch(/\n\.math-block, \.mermaid \{[^}]*max-width: 100%; overflow-x: auto;/);
    expect(css).toMatch(/@media print \{[^@]*table \{ table-layout: fixed; \}[^@]*th, td \{ min-width: 0; \}/);
  });
});

// Audit H1: the async path used to re-parse the finished document with DOMParser. Under the
// app's Trusted Types policy that string is sanitized as a fragment, which drops <html lang/dir>,
// <meta charset>, the CSP meta and <title> — every export with math or a diagram lost them.
// The async transforms now run on the detached body element and the document is assembled once.
describe('buildExportDocAsync — document head survives math and Mermaid (audit H1)', () => {
  const KATEX_HTML = '<p><span class="katex"><span class="katex-mathml"><math><mi>x</mi></math></span>'
    + '<span class="katex-html" aria-hidden="true">x</span></span></p>';
  const MERMAID_HTML = '<pre><code class="language-mermaid">graph TD; A--&gt;B</code></pre>';
  const loadMermaid = async () => ({ render: async () => ({ svg: '<svg><text>diagram</text></svg>' }) });
  const DOMPurify = { sanitize: (value) => value };

  async function freshExport() {
    vi.resetModules(); // the KaTeX stylesheet is cached per module instance
    return import('../../src/renderer/markdown/export.js');
  }
  function expectFullHead(fullHtml, { lang, dir, title }) {
    expect(fullHtml.startsWith(`<!DOCTYPE html>\n<html lang="${lang}" dir="${dir}">\n<head>\n<meta charset="UTF-8">`)).toBe(true);
    expect(fullHtml).toMatch(/<meta http-equiv="Content-Security-Policy" content="default-src 'none';/);
    expect(fullHtml).toContain(`<title>${title}</title>`);
    expect(fullHtml).toContain('<meta name="viewport" content="width=device-width, initial-scale=1.0">');
  }

  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  test('a math note keeps charset, CSP, title, lang and dir', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: true, text: async () => '.katex{font:1em KaTeX_Main}' }));
    const { buildExportDocAsync: build } = await freshExport();
    const { fullHtml, baseName } = await build({ name: 'math.md', content: 'x' }, { parseMarkdown: () => KATEX_HTML });
    expect(baseName).toBe('math');
    expectFullHead(fullHtml, { lang: 'en', dir: 'ltr', title: 'math' });
  });

  test('an Arabic math note exports lang=ar dir=rtl', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: true, text: async () => '.katex{font:1em KaTeX_Main}' }));
    const { buildExportDocAsync: build } = await freshExport();
    const { fullHtml } = await build(
      { name: 'معادلة.md', content: 'هذه معادلة مهمة جدا' },
      { parseMarkdown: (s) => `<p>${s}</p>${KATEX_HTML}` },
    );
    expectFullHead(fullHtml, { lang: 'ar', dir: 'rtl', title: 'معادلة' });
  });

  test('a Mermaid note keeps the full head and still renders the diagram', async () => {
    const { buildExportDocAsync: build } = await freshExport();
    const { fullHtml } = await build({ name: 'diagram.md', content: 'x' }, { parseMarkdown: () => MERMAID_HTML, loadMermaid, DOMPurify });
    expectFullHead(fullHtml, { lang: 'en', dir: 'ltr', title: 'diagram' });
    expect(fullHtml).toContain('<svg><text>diagram</text></svg>');
  });

  test('never re-parses the assembled document', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: true, text: async () => '.katex{font:1em KaTeX_Main}' }));
    const parse = vi.spyOn(DOMParser.prototype, 'parseFromString');
    const { buildExportDocAsync: build } = await freshExport();
    await build({ name: 'both.md', content: 'x' }, { parseMarkdown: () => KATEX_HTML + MERMAID_HTML, loadMermaid, DOMPurify });
    expect(parse).not.toHaveBeenCalled();
  });

  test('inlines the KaTeX stylesheet without its font faces and keeps both formula copies', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      text: async () => '@font-face{font-family:KaTeX_Main;src:url(fonts/KaTeX_Main.woff2)}.katex{font:1em KaTeX_Main}',
    }));
    const { buildExportDocAsync: build } = await freshExport();
    const { fullHtml } = await build({ name: 'math.md', content: 'x' }, { parseMarkdown: () => KATEX_HTML });
    const head = fullHtml.slice(0, fullHtml.indexOf('</head>'));
    expect(head).toContain('<style>\n.katex{font:1em KaTeX_Main}\n</style>\n');
    expect(fullHtml).not.toContain('@font-face');
    expect(fullHtml).not.toContain('KaTeX_Main.woff2');
    expect(fullHtml).toContain('class="katex-html"');
    expect(fullHtml).toContain('<math><mi>x</mi></math>');
  });

  test('falls back to the MathML copy alone when the stylesheet cannot be loaded', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 404, text: async () => '' }));
    const { buildExportDocAsync: build } = await freshExport();
    const { fullHtml } = await build({ name: 'math.md', content: 'x' }, { parseMarkdown: () => KATEX_HTML });
    expectFullHead(fullHtml, { lang: 'en', dir: 'ltr', title: 'math' });
    expect(fullHtml).not.toContain('katex-html');
    expect(fullHtml).toContain('<math><mi>x</mi></math>');
  });

  test('a rejected stylesheet request also falls back to MathML', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('offline'); });
    const { buildExportDocAsync: build } = await freshExport();
    const { fullHtml } = await build({ name: 'math.md', content: 'x' }, { parseMarkdown: () => KATEX_HTML });
    expect(fullHtml).not.toContain('katex-html');
    expect(fullHtml).toContain('<math><mi>x</mi></math>');
  });

  test('a stylesheet cannot close the style element early', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: true, text: async () => '.katex{}</style><p id="leak">x</p>' }));
    const { buildExportDocAsync: build } = await freshExport();
    const { fullHtml } = await build({ name: 'math.md', content: 'x' }, { parseMarkdown: () => KATEX_HTML });
    const head = fullHtml.slice(0, fullHtml.indexOf('</head>'));
    expect((head.match(/<\/style>/g) || []).length).toBe(2);
    expect(head).toContain('<style>\n.katex{}><p id="leak">x</p>\n</style>\n');
  });

  test('requests the vendored stylesheet and treats a non-OK response as unavailable', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: false, status: 404, text: async () => '.katex{color:red}' }));
    vi.stubGlobal('fetch', fetchSpy);
    const { buildExportDocAsync: build } = await freshExport();
    const { fullHtml } = await build({ name: 'math.md', content: 'x' }, { parseMarkdown: () => KATEX_HTML });
    expect(fetchSpy).toHaveBeenCalledWith('../../resources/vendor/katex/katex.min.css');
    expect(fullHtml).not.toContain('.katex{color:red}');
    expect(fullHtml).not.toContain('katex-html');
  });

  test('the Mermaid engine is loaded only for a note that has a diagram', async () => {
    const loader = vi.fn(loadMermaid);
    const { buildExportDocAsync: build } = await freshExport();
    await build({ name: 'plain.md', content: 'hello' }, { parseMarkdown: md, loadMermaid: loader, DOMPurify });
    expect(loader).not.toHaveBeenCalled();
    await build({ name: 'd.md', content: 'x' }, { parseMarkdown: () => MERMAID_HTML, loadMermaid: loader, DOMPurify });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  test('a file with no content exports an empty body and exactly one stylesheet', async () => {
    const { buildExportDoc: buildSync } = await freshExport();
    const { fullHtml } = buildSync({ name: 'empty.md' }, { parseMarkdown: (s) => `<p>[${s}]</p>` });
    expect(fullHtml).toMatch(/<p[^>]*>\[\]<\/p>/);
    expect((fullHtml.match(/<style>/g) || []).length).toBe(1);
    expect(fullHtml).toContain('.export-annotation-note { margin: 0 0 12px; }\n</style>\n</head>');
  });

  test('a plain note needs no stylesheet request at all', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, text: async () => '' }));
    vi.stubGlobal('fetch', fetchSpy);
    const { buildExportDocAsync: build, buildExportDoc: buildSync } = await freshExport();
    const file = { name: 'plain.md', content: 'hello' };
    const { fullHtml } = await build(file, { parseMarkdown: md });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(fullHtml).toBe(buildSync(file, { parseMarkdown: md }).fullHtml);
  });
});
