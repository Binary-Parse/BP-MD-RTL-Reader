// @vitest-environment jsdom
/**
 * epub.test.js — T6.1b: the bidi-aware EPUB builder.
 *
 * The archive is validated the way a reader would: walk EOCD → central directory → local
 * headers (a small independent reader lives here), then parse the OCF/OPF/NAV documents as
 * XML with DOMParser, so a malformed byte or a stray unescaped `&` fails the test.
 */
import { describe, test, expect } from 'vitest';
import {
  buildEpub,
  buildEpubFromNote,
  buildEpubFromNoteAsync,
  splitChapters,
  serializeXhtml,
} from '../../src/renderer/markdown/epub.js';
import { footnoteExtension } from '../../src/renderer/markdown/footnotes.js';

const decoder = new TextDecoder();

/** Minimal independent ZIP reader (mirrors what an EPUB reader does). */
function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = bytes.length - 22;
  const count = view.getUint16(eocdOffset + 10, true);
  const centralOffset = view.getUint32(eocdOffset + 16, true);
  const entries = [];
  let p = centralOffset;
  for (let i = 0; i < count; i += 1) {
    const nameLength = view.getUint16(p + 28, true);
    const localOffset = view.getUint32(p + 42, true);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const size = view.getUint32(p + 24, true);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    entries.push({
      name: decoder.decode(bytes.slice(p + 46, p + 46 + nameLength)),
      method: view.getUint16(p + 10, true),
      text: decoder.decode(bytes.slice(start, start + size)),
      size,
    });
    p += 46 + nameLength;
  }
  return {
    names: entries.map((e) => e.name),
    entries,
    find: (name) => entries.find((e) => e.name === name),
  };
}

/** A trivial markdown → HTML fake (headings + paragraphs + images). */
const md = (source) => source
  .split(/\n{2,}/)
  .map((block) => {
    const heading = /^(#{1,2})\s+(.*)$/.exec(block.trim());
    if (heading) return `<h${heading[1].length}>${heading[2]}</h${heading[1].length}>`;
    const image = /^!\[(.*?)\]\((.*?)\)$/.exec(block.trim());
    if (image) return `<p><img src="${image[2]}" alt="${image[1]}"></p>`;
    return `<p>${block.trim()}</p>`;
  })
  .join('\n');

const parseXml = (text, label) => {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const error = doc.querySelector('parsererror');
  expect(error, `${label} must be well-formed XML: ${error ? error.textContent : ''}`).toBeNull();
  return doc;
};

const CHAPTERS = [
  { title: 'First', nodes: ['<h1>First</h1>', '<p>Alpha</p>'].map((html) => {
    const el = document.createElement('div');
    el.innerHTML = html;
    return el.firstChild;
  }) },
  { title: 'Second', nodes: ['<h2>Second</h2>', '<p>Beta</p>'].map((html) => {
    const el = document.createElement('div');
    el.innerHTML = html;
    return el.firstChild;
  }) },
];

const FIXED = new Date(Date.UTC(2026, 0, 2, 3, 4, 5));

describe('splitChapters (T6.1b)', () => {
  const rootWith = (html) => {
    const root = document.createElement('div');
    root.innerHTML = html;
    return root;
  };

  test('opens a chapter at every h1/h2 and titles it from the heading', () => {
    const chapters = splitChapters(rootWith('<h1>One</h1><p>a</p><h2>Two</h2><p>b</p><h1>Three</h1>'));
    expect(chapters.map((c) => c.title)).toEqual(['One', 'Two', 'Three']);
    expect(chapters[1].nodes.map((n) => n.tagName)).toEqual(['H2', 'P']);
  });

  test('content before the first heading opens a leading, untitled chapter', () => {
    const chapters = splitChapters(rootWith('<p>intro</p><h1>Body</h1><p>x</p>'));
    expect(chapters.map((c) => c.title)).toEqual(['', 'Body']);
    expect(chapters[0].nodes).toHaveLength(1);
  });

  test('a document with no h1/h2 is a single chapter, and an empty one still yields a chapter', () => {
    expect(splitChapters(rootWith('<p>only</p><p>text</p>'))).toHaveLength(1);
    expect(splitChapters(rootWith('<h3>deep</h3>')).map((c) => c.title)).toEqual(['']);
    expect(splitChapters(null)).toHaveLength(1);
    expect(splitChapters(rootWith(''))).toHaveLength(1);
  });

  test('whitespace between blocks is not chapter content', () => {
    const chapters = splitChapters(rootWith('<h1>One</h1>\n\n<p>a</p>\n\n<h1>Two</h1>\n<p>b</p>\n'));
    expect(chapters.map((c) => c.title)).toEqual(['One', 'Two']);
    expect(chapters[0].nodes.map((n) => n.nodeName)).toEqual(['H1', 'P']);
    expect(chapters[1].nodes.map((n) => n.nodeName)).toEqual(['H1', 'P']);
  });
});

describe('serializeXhtml (T6.1b)', () => {
  const el = (html) => {
    const root = document.createElement('div');
    root.innerHTML = html;
    return root.firstChild;
  };

  test('escapes text and attribute values, and self-closes void elements', () => {
    expect(serializeXhtml(el('<p>a &amp; b &lt; c</p>'))).toBe('<p>a &amp; b &lt; c</p>');
    expect(serializeXhtml(el('<p title="a &quot;b&quot;">x</p>'))).toBe('<p title="a &quot;b&quot;">x</p>');
    expect(serializeXhtml(el('<p>line<br>break</p>'))).toBe('<p>line<br/>break</p>');
    expect(serializeXhtml(el('<hr>'))).toBe('<hr/>');
  });

  test('drops comments, event-handler attributes and non-element nodes', () => {
    expect(serializeXhtml(el('<p>a<!-- note -->b</p>'))).toBe('<p>ab</p>');
    expect(serializeXhtml(el('<p onclick="evil()" dir="rtl">x</p>'))).toBe('<p dir="rtl">x</p>');
    expect(serializeXhtml(null)).toBe('');
    expect(serializeXhtml(document.createComment('x'))).toBe('');
    expect(serializeXhtml(document.createTextNode('a<b'))).toBe('a&lt;b');
  });

  test('keeps nesting and inline markup intact', () => {
    expect(serializeXhtml(el('<blockquote><p><em>hi</em></p></blockquote>')))
      .toBe('<blockquote><p><em>hi</em></p></blockquote>');
  });
});

describe('buildEpub — OCF structure (T6.1b)', () => {
  const zip = readZip(buildEpub({ title: 'My Book', lang: 'en', chapters: CHAPTERS, modified: FIXED }));

  test('the first entry is an uncompressed mimetype, then container.xml, then OEBPS', () => {
    expect(zip.names).toEqual([
      'mimetype',
      'META-INF/container.xml',
      'OEBPS/content.opf',
      'OEBPS/nav.xhtml',
      'OEBPS/style.css',
      'OEBPS/chapter-1.xhtml',
      'OEBPS/chapter-2.xhtml',
    ]);
    const mimetype = zip.find('mimetype');
    expect(mimetype.method).toBe(0); // stored — the whole reason for zip-store.js
    expect(mimetype.text).toBe('application/epub+zip');
  });

  test('container.xml points at the package document', () => {
    const doc = parseXml(zip.find('META-INF/container.xml').text, 'container.xml');
    const rootfile = doc.querySelector('rootfile');
    expect(rootfile.getAttribute('full-path')).toBe('OEBPS/content.opf');
    expect(rootfile.getAttribute('media-type')).toBe('application/oebps-package+xml');
  });

  test('content.opf is an EPUB 3 package with metadata, manifest and a matching spine', () => {
    const doc = parseXml(zip.find('OEBPS/content.opf').text, 'content.opf');
    const pkg = doc.documentElement;
    expect(pkg.tagName).toBe('package');
    expect(pkg.getAttribute('version')).toBe('3.0');
    expect(pkg.getAttribute('unique-identifier')).toBe('pub-id');
    expect(doc.querySelector('metadata > identifier')?.getAttribute('id')).toBe('pub-id');
    expect(doc.querySelector('metadata > title')?.textContent).toBe('My Book');
    expect(doc.querySelector('metadata > language')?.textContent).toBe('en');
    expect(doc.querySelector('meta[property="dcterms:modified"]')?.textContent).toBe('2026-01-02T03:04:05Z');
    // manifest: nav + style + one item per chapter
    const ids = [...doc.querySelectorAll('manifest > item')].map((i) => i.getAttribute('id'));
    expect(ids).toEqual(['nav', 'style', 'chapter-1', 'chapter-2']);
    expect(doc.querySelector('manifest > item[id="nav"]')?.getAttribute('properties')).toBe('nav');
    // spine: one itemref per chapter, in order
    expect([...doc.querySelectorAll('spine > itemref')].map((i) => i.getAttribute('idref')))
      .toEqual(['chapter-1', 'chapter-2']);
  });

  test('nav.xhtml is the toc, listing every chapter in order', () => {
    const doc = parseXml(zip.find('OEBPS/nav.xhtml').text, 'nav.xhtml');
    expect(doc.querySelector('nav')?.getAttribute('epub:type')).toBe('toc');
    const links = [...doc.querySelectorAll('nav a')];
    expect(links.map((a) => a.textContent)).toEqual(['First', 'Second']);
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['chapter-1.xhtml', 'chapter-2.xhtml']);
  });

  test('each chapter is a well-formed XHTML document carrying its own content', () => {
    const first = parseXml(zip.find('OEBPS/chapter-1.xhtml').text, 'chapter-1.xhtml');
    expect(first.documentElement.getAttribute('xmlns')).toBe('http://www.w3.org/1999/xhtml');
    expect(first.documentElement.getAttribute('dir')).toBe('ltr');
    expect(first.querySelector('title')?.textContent).toBe('First');
    expect(first.querySelector('link')?.getAttribute('href')).toBe('style.css');
    expect(first.querySelector('h1')?.textContent).toBe('First');
    expect(zip.find('OEBPS/chapter-2.xhtml').text).toContain('<h2>Second</h2>');
  });

  test('the stylesheet ships the paper palette and is referenced, not inlined per chapter', () => {
    const css = zip.find('OEBPS/style.css').text;
    expect(css).toContain('#2B2620'); // paper --ink
    expect(css).toContain('#F6F2E7'); // paper --paper
    expect(zip.find('OEBPS/chapter-1.xhtml').text).toContain('<link rel="stylesheet"');
  });
});

describe('buildEpub — direction, language and identity (T6.1b)', () => {
  test('rtl sets dir on the package + chapters and a right-to-left page progression', () => {
    const zip = readZip(buildEpub({ title: 'كتاب', lang: 'ar', direction: 'rtl', chapters: CHAPTERS, modified: FIXED }));
    const opf = parseXml(zip.find('OEBPS/content.opf').text, 'content.opf');
    expect(opf.documentElement.getAttribute('dir')).toBe('rtl');
    expect(opf.querySelector('metadata > language')?.textContent).toBe('ar');
    expect(opf.querySelector('spine')?.getAttribute('page-progression-direction')).toBe('rtl');
    const chapter = parseXml(zip.find('OEBPS/chapter-1.xhtml').text, 'chapter-1');
    expect(chapter.documentElement.getAttribute('dir')).toBe('rtl');
    expect(chapter.body.getAttribute('dir')).toBe('rtl');
    expect(chapter.documentElement.getAttribute('xml:lang')).toBe('ar');
  });

  test('ltr omits the page-progression-direction attribute entirely', () => {
    const zip = readZip(buildEpub({ title: 'Book', lang: 'en', direction: 'ltr', chapters: CHAPTERS, modified: FIXED }));
    const opf = parseXml(zip.find('OEBPS/content.opf').text, 'content.opf');
    expect(opf.querySelector('spine')?.hasAttribute('page-progression-direction')).toBe(false);
  });

  test('an explicit identifier wins; otherwise a reproducible urn:uuid is derived', () => {
    const explicit = parseXml(readZip(buildEpub({
      title: 'B', lang: 'en', chapters: CHAPTERS, identifier: 'urn:isbn:9780000000000', modified: FIXED,
    })).find('OEBPS/content.opf').text, 'opf');
    expect(explicit.querySelector('metadata > identifier')?.textContent).toBe('urn:isbn:9780000000000');

    const derive = () => readZip(buildEpub({ title: 'B', lang: 'en', chapters: CHAPTERS, modified: FIXED }))
      .find('OEBPS/content.opf').text.match(/<dc:identifier[^>]*>([^<]+)</)[1];
    expect(derive()).toMatch(/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(derive()).toBe(derive()); // same document → same identifier
  });

  test('a malformed language falls back to the direction default, and a missing title is named', () => {
    const zip = readZip(buildEpub({ title: '', lang: 'not a language!', direction: 'rtl', chapters: CHAPTERS, modified: FIXED }));
    const opf = parseXml(zip.find('OEBPS/content.opf').text, 'opf');
    expect(opf.querySelector('metadata > language')?.textContent).toBe('ar');
    expect(opf.querySelector('metadata > title')?.textContent).toBe('Untitled');
  });

  test('chapters with no title still get a distinct nav label, and an empty book yields one chapter', () => {
    const at = (readZip(buildEpub({ title: 'Book', lang: 'en', chapters: [{ nodes: [] }, { nodes: [] }], modified: FIXED })));
    const nav = parseXml(at.find('OEBPS/nav.xhtml').text, 'nav');
    expect([...nav.querySelectorAll('nav a')].map((a) => a.textContent)).toEqual(['Book', 'Book 2']);
    const empty = readZip(buildEpub({ title: 'Empty', lang: 'en', chapters: [], modified: FIXED }));
    expect(empty.names).toContain('OEBPS/chapter-1.xhtml');
  });
});

describe('buildEpubFromNote (T6.1b)', () => {
  test('splits the rendered note into chapters and carries the image policy of export.js', () => {
    const file = {
      name: 'Report.md',
      content: '# Chapter One\n\nText with an image.\n\n![a diagram](bpmd://vault/cap-v/diagram.png)\n\n## Chapter Two\n\nMore text.\n',
    };
    const { bytes, baseName, dir } = buildEpubFromNote(file, { parseMarkdown: md, modified: FIXED });
    expect(baseName).toBe('Report');
    expect(dir).toBe('ltr');

    const zip = readZip(bytes);
    // Two headings (h1 + h2) → exactly two chapters.
    expect(zip.names).toContain('OEBPS/chapter-2.xhtml');
    expect(zip.names).not.toContain('OEBPS/chapter-3.xhtml');
    const nav = parseXml(zip.find('OEBPS/nav.xhtml').text, 'nav');
    expect([...nav.querySelectorAll('nav a')].map((a) => a.textContent))
      .toEqual(['Chapter One', 'Chapter Two']);
    const one = zip.find('OEBPS/chapter-1.xhtml').text;
    // The vault image becomes the SAME textual placeholder the HTML/PDF export emits.
    expect(one).toContain('[Image: a diagram]');
    expect(one).not.toContain('bpmd://');
  });

  test('Arabic content derives RTL and the title from front matter when present', () => {
    const arabic = buildEpubFromNote({ name: 'n.md', content: '# عنوان\n\nنص عربي طويل بما يكفي لتحديد الاتجاه.\n' }, { parseMarkdown: md, modified: FIXED });
    expect(arabic.dir).toBe('rtl');
    const opf = parseXml(readZip(arabic.bytes).find('OEBPS/content.opf').text, 'opf');
    expect(opf.querySelector('metadata > language')?.textContent).toBe('ar');
    expect(opf.documentElement.getAttribute('dir')).toBe('rtl');

    const titled = buildEpubFromNote({
      name: 'n.md',
      content: '---\ntitle: Declared Title\nlang: fr\n---\n\n# Heading\n\nFrench text.\n',
    }, { parseMarkdown: md, modified: FIXED });
    const opf2 = parseXml(readZip(titled.bytes).find('OEBPS/content.opf').text, 'opf');
    expect(opf2.querySelector('metadata > title')?.textContent).toBe('Declared Title');
    expect(opf2.querySelector('metadata > language')?.textContent).toBe('fr');
  });

  test('a manual direction override beats the content script, and the file name is the last title fallback', () => {
    const forced = buildEpubFromNote(
      { name: 'n.md', content: '# عنوان\n\nنص عربي طويل.\n' },
      { parseMarkdown: md, direction: 'ltr', modified: FIXED }
    );
    expect(forced.dir).toBe('ltr');
    const plain = buildEpubFromNote({ name: 'no-headings.md', content: 'Just a paragraph.' }, { parseMarkdown: md, modified: FIXED });
    const opf = parseXml(readZip(plain.bytes).find('OEBPS/content.opf').text, 'opf');
    expect(opf.querySelector('metadata > title')?.textContent).toBe('no-headings');
  });
});

describe('RTL-H3: EPUB code stays LTR inside an RTL book', () => {
  test('the stylesheet pins pre and code to ltr', () => {
    const zip = readZip(buildEpub({ title: 'كتاب', lang: 'ar', direction: 'rtl', chapters: CHAPTERS, modified: FIXED }));
    const css = zip.find('OEBPS/style.css').text;
    expect(css).toContain('direction: ltr; text-align: start;');
    expect(css).toContain('direction: ltr; unicode-bidi: isolate;');
  });
});

// ── Audit 3: footnote ids, inert local links, cross-chapter anchors, mermaid parity. ──
describe('EPUB link + anchor hygiene (audit 3)', () => {
  const chapterWith = (html) => {
    const el = document.createElement('div');
    el.innerHTML = html;
    return { title: '', nodes: Array.from(el.childNodes) };
  };

  test('a relative (local-file) link is neutralized to inert text; web links survive', () => {
    const parseMarkdown = () => '<p>See <a href="README.md">docs</a> and <a href="https://ok.test/x">web</a>.</p>';
    const { bytes } = buildEpubFromNote({ name: 'n.md', content: '# H\n\nbody' }, { parseMarkdown, modified: FIXED });
    const one = readZip(bytes).find('OEBPS/chapter-1.xhtml').text;
    expect(one).not.toContain('README.md');
    expect(one).toContain('<span>docs</span>');
    expect(one).toContain('<a href="https://ok.test/x">web</a>');
  });

  test('a kept data: image loses any srcset naming local variants', () => {
    const parseMarkdown = () => '<p><img src="data:image/png;base64,AA" alt="e" srcset="local-2x.png 2x"></p>';
    const { bytes } = buildEpubFromNote({ name: 'n.md', content: '# H\n\nbody' }, { parseMarkdown, modified: FIXED });
    const one = readZip(bytes).find('OEBPS/chapter-1.xhtml').text;
    expect(one).toContain('src="data:image/png;base64,AA"');
    expect(one).not.toContain('local-2x.png');
  });

  test('footnote references across a chapter split are rewritten to the target chapter file', () => {
    const chapters = [
      chapterWith('<h1>One</h1><p>See <sup class="fn-ref" id="fnref-1"><a href="#fn-1">1</a></sup></p>'),
      chapterWith('<h2>Two</h2><section class="footnotes"><ol><li id="fn-1">body <a href="#fnref-1" class="fn-back">↩</a></li></ol></section>'),
    ];
    const zip = readZip(buildEpub({ title: 'B', lang: 'en', chapters, modified: FIXED }));
    const one = zip.find('OEBPS/chapter-1.xhtml').text;
    const two = zip.find('OEBPS/chapter-2.xhtml').text;
    // the reference (chapter 1) now points INTO the chapter file that holds the note body…
    expect(one).toContain('href="chapter-2.xhtml#fn-1"');
    // …and the backlink (chapter 2) points back at the chapter holding the reference.
    expect(two).toContain('href="chapter-1.xhtml#fnref-1"');
  });

  test('a same-chapter anchor stays as-is, and a dead anchor drops its href but keeps the text', () => {
    const chapters = [
      chapterWith('<h1 id="intro">One</h1><p><a href="#intro">top</a> <a href="#nowhere">gone</a></p>'),
    ];
    const zip = readZip(buildEpub({ title: 'B', lang: 'en', chapters, modified: FIXED }));
    const one = zip.find('OEBPS/chapter-1.xhtml').text;
    expect(one).toContain('<a href="#intro">top</a>');
    expect(one).not.toContain('href="#nowhere"');
    expect(one).toContain('<a>gone</a>');
  });

  test('duplicate fnref ids are unique in the packaged chapter (two refs, one footnote)', async () => {
    const { Marked } = await import('marked');
    const inst = new Marked();
    inst.use(footnoteExtension());
    const file = {
      name: 'refs.md',
      content: '# Chapter One\n\nAlpha[^1] and beta[^1].\n\n[^1]: The body.\n',
    };
    const { bytes } = buildEpubFromNote(file, { parseMarkdown: (src) => inst.parse(src), modified: FIXED });
    const one = readZip(bytes).find('OEBPS/chapter-1.xhtml').text;
    expect(one).toContain('id="fnref-1"');
    expect(one).toContain('id="fnref-1-2"');
    expect(one.match(/id="fnref-1"/g)).toHaveLength(1);
  });
});

describe('buildEpubFromNoteAsync — mermaid parity with the HTML export (audit 3c)', () => {
  const parseMarkdown = () => '<h1>H</h1><pre><code class="language-mermaid">graph TD; A--&gt;B</code></pre>';

  test('a provided mermaid engine renders its (sanitized) SVG into the chapter body', async () => {
    const loadMermaid = async () => ({ render: async () => ({ svg: '<svg><text>diagram</text></svg>' }) });
    const DOMPurify = { sanitize: (value) => value };
    const { bytes } = await buildEpubFromNoteAsync(
      { name: 'd.md', content: 'x' },
      { parseMarkdown, loadMermaid, DOMPurify, modified: FIXED },
    );
    const one = readZip(bytes).find('OEBPS/chapter-1.xhtml').text;
    expect(one).toContain('<svg xmlns="http://www.w3.org/2000/svg"><text>diagram</text></svg>');
    expect(one).toContain('class="mermaid"');
    expect(one).not.toContain('language-mermaid');
  });

  test('a failing engine falls back to the raw code block (no throw)', async () => {
    const { bytes } = await buildEpubFromNoteAsync(
      { name: 'd.md', content: 'x' },
      { parseMarkdown, loadMermaid: async () => { throw new Error('load failed'); }, modified: FIXED },
    );
    expect(readZip(bytes).find('OEBPS/chapter-1.xhtml').text).toContain('language-mermaid');
  });

  test('without loadMermaid the sync result is returned unchanged', async () => {
    const { bytes } = await buildEpubFromNoteAsync({ name: 'd.md', content: 'x' }, { parseMarkdown, modified: FIXED });
    expect(readZip(bytes).find('OEBPS/chapter-1.xhtml').text).toContain('language-mermaid');
  });
});

// UX-02 (2026-09-26): SVG element names are case-sensitive in XML — lowercasing
// linearGradient/clipPath turned mermaid gradients/clips into unknown elements and
// dropped the subtree's xmlns. serializeXhtml now defers SVG subtrees to XMLSerializer.
describe('serializeXhtml SVG case preservation (UX-02)', () => {
  test('camelCase SVG elements keep their case and the svg carries its xmlns', () => {
    const root = document.createElement('div');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const grad = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
    grad.setAttribute('id', 'g1');
    defs.appendChild(grad);
    svg.appendChild(defs);
    root.appendChild(svg);
    const out = serializeXhtml(root);
    expect(out).toContain('<linearGradient id="g1"/>');
    expect(out).not.toContain('<lineargradient');
    expect(out).toContain('xmlns="http://www.w3.org/2000/svg"');
  });
});

// UX-01 (2026-09-26): EPUB readers cannot load the app's KaTeX stylesheet, so the span
// copy of every formula is stripped and the native MathML kept — no double formulas.
describe('stripKatexHtml (UX-01)', () => {
  test('the span copy is removed and the mathml wrapper unwraps to native math', async () => {
    const { stripKatexHtml } = await import('../../src/renderer/markdown/export.js');
    const root = document.createElement('div');
    root.innerHTML = '<p><span class="katex"><span class="katex-mathml"><math><mi>x</mi></math></span><span class="katex-html" aria-hidden="true"><span class="base">xx</span></span></span></p>';
    stripKatexHtml(root);
    expect(root.querySelector('.katex-html')).toBeNull();
    expect(root.querySelector('.katex-mathml')).toBeNull();
    expect(root.querySelector('math')).not.toBeNull();
    expect(root.querySelector('math mi')).not.toBeNull();
  });
});
