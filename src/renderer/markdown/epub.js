/**
 * epub.js — a dependency-free, bidi-aware EPUB 3 builder (T6.1b).
 *
 * The archive comes from zip-store.js (stored-only), the chapter DOM from export.js's shared
 * `renderExportBody` pipeline — so an exported EPUB carries the SAME per-block direction
 * treatment, callout styling, math pre-rendering and image policy as the HTML/PDF export.
 *
 * Layout (OCF):
 *   mimetype                      → application/epub+zip, stored, first (zip-store guarantees it)
 *   META-INF/container.xml        → points at OEBPS/content.opf
 *   OEBPS/content.opf             → EPUB 3 package (dc:title, dc:language, manifest, spine)
 *   OEBPS/nav.xhtml               → the TOC built from the chapter titles
 *   OEBPS/style.css               → a small stylesheet derived from the paper theme tokens
 *   OEBPS/chapter-N.xhtml         → one XHTML document per chapter
 *
 * Everything the renderer hands over is serialized as XML (never as raw innerHTML): text and
 * attributes are escaped, HTML void elements are self-closed, and comments/event handlers are
 * dropped — so the result is well-formed XHTML that epubcheck and real readers accept.
 */
import { zipStore } from './zip-store.js';
import { renderExportBody, isLanguageTag, stripKatexHtml } from './export.js';
import { renderMermaid } from './mermaid.js';
import { sanitizeSvg } from './trusted.js';

const EPUB_MIMETYPE = 'application/epub+zip';
const CONTAINER_PATH = 'META-INF/container.xml';
const OPF_PATH = 'OEBPS/content.opf';
const NAV_PATH = 'OEBPS/nav.xhtml';
const STYLE_PATH = 'OEBPS/style.css';

/** HTML void elements — in XHTML they must be self-closed. */
const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param',
  'source', 'track', 'wbr',
]);

// The paper theme's own tokens (base.css :root), reduced to what a reflowable EPUB needs.
// System font stacks only: an EPUB bundles no font files, so naming Literata would only make
// readers fall back differently per device.
export const PAPER_CSS = `body { font-family: Georgia, "Times New Roman", serif; font-size: 1em; line-height: 1.7; margin: 5%; color: #2B2620; background: #F6F2E7; }
h1, h2, h3, h4 { font-weight: 600; line-height: 1.25; }
h1 { font-size: 1.6em; } h2 { font-size: 1.3em; } h3 { font-size: 1.1em; }
a { color: #35578C; }
code { font-family: "Courier New", monospace; background: #EEE8D8; padding: 0 3px; direction: ltr; unicode-bidi: isolate; }
pre { font-family: "Courier New", monospace; background: #EEE8D8; padding: 12px; border-radius: 6px; overflow-x: auto; direction: ltr; text-align: start; }
blockquote { border-inline-start: 3px solid #35578C; padding-block: 4px; padding-inline-start: 16px; margin: 16px 0; font-style: italic; }
img { max-width: 100%; height: auto; }
hr { border: none; border-top: 1px solid #D9D0BA; }
table { border-collapse: collapse; } td, th { border: 1px solid #D9D0BA; padding: 4px 8px; }
.callout { border-inline-start: 3px solid #35578C; background: #EEE8D8; padding: 10px 14px; margin: 16px 0; }
.export-image-placeholder { color: #544C40; font-style: italic; }
mark.user-hl { background: rgba(168, 132, 44, 0.20); }
`;

function escapeXmlText(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeXmlAttribute(value) {
  return escapeXmlText(value).replace(/"/g, '&quot;');
}

/**
 * Serialize a DOM subtree as XHTML. Comments and processing instructions are dropped, `on*`
 * attributes are dropped (defense in depth behind DOMPurify), and void elements self-close.
 * SVG-namespace subtrees are serialized by XMLSerializer: SVG element names are
 * CASE-SENSITIVE in XML, and lowercasing linearGradient/clipPath/feDropShadow turned
 * mermaid gradients/clips into unknown elements (degraded rendering, epubcheck errors)
 * while also dropping the subtree's xmlns (UX-02).
 */
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
export function serializeXhtml(node) {
  if (!node) return '';
  if (node.nodeType === 3) return escapeXmlText(node.nodeValue || '');
  if (node.nodeType !== 1) return '';
  if (node.namespaceURI === SVG_NAMESPACE && typeof XMLSerializer === 'function') {
    try { return new XMLSerializer().serializeToString(node); } catch (_) { /* fall through */ }
  }
  const tag = String(node.tagName || '').toLowerCase();
  if (tag === '') return '';
  let out = `<${tag}`;
  for (const attr of node.attributes || []) {
    const name = String(attr.name || '');
    if (name === '' || name.toLowerCase().startsWith('on')) continue;
    out += ` ${name}="${escapeXmlAttribute(attr.value)}"`;
  }
  if (VOID_ELEMENTS.has(tag)) return `${out}/>`;
  let inner = '';
  for (const child of node.childNodes) inner += serializeXhtml(child);
  return `${out}>${inner}</${tag}>`;
}

function textOf(node) {
  return String((node && node.textContent) || '').replace(/\s+/g, ' ').trim();
}

/** Walk every element of a chapter's node list, including the top-level nodes themselves. */
function forEachChapterElement(nodes, fn) {
  for (const node of nodes || []) {
    if (!node || node.nodeType !== 1 || typeof node.querySelectorAll !== 'function') continue;
    fn(node);
    for (const el of node.querySelectorAll('*')) fn(el);
  }
}

/**
 * Same-document `#anchor` links may target an id that splitChapters put into a DIFFERENT
 * chapter file (the footnotes section always lands in the LAST chapter). Using the
 * produced documents' id→chapter map, such links are rewritten to the target chapter
 * file (`chapter-3.xhtml#fn-1`); links whose target exists nowhere lose their href but
 * keep the link text.
 */
function rewriteCrossChapterAnchors(chapters) {
  const idChapter = new Map();
  chapters.forEach((chapter, i) => {
    forEachChapterElement(chapter.nodes, (el) => {
      const id = el.getAttribute('id');
      if (id && !idChapter.has(id)) idChapter.set(id, i);
    });
  });
  chapters.forEach((chapter, i) => {
    forEachChapterElement(chapter.nodes, (el) => {
      if (String(el.tagName || '').toLowerCase() !== 'a' || !el.hasAttribute('href')) return;
      const href = el.getAttribute('href') || '';
      if (!href.startsWith('#')) return;
      const target = idChapter.get(href.slice(1));
      if (target === undefined) el.removeAttribute('href');
      else if (target !== i) el.setAttribute('href', `chapter-${target + 1}.xhtml${href}`);
    });
  });
}

/**
 * Split a rendered body into chapters: every h1/h2 opens a chapter, content before the first
 * one opens a leading chapter, and a document with no such heading is a single chapter.
 * @returns {Array<{title: string, nodes: Node[]}>}
 */
export function splitChapters(root) {
  const chapters = [];
  let current = null;
  const start = (title) => { current = { title, nodes: [] }; chapters.push(current); };
  for (const child of root ? Array.from(root.childNodes) : []) {
    // The markdown pipeline leaves the newlines BETWEEN blocks as root text nodes; they are
    // not chapter content, and carried into the archive they only add blank lines to the XHTML.
    if (child.nodeType === 3 && String(child.nodeValue || '').trim() === '') continue;
    const isSectionHeading = child.nodeType === 1 && /^H[12]$/.test(String(child.tagName || ''));
    if (isSectionHeading && (current === null || current.nodes.length > 0)) start(textOf(child));
    else if (current === null) start(''); // leading content with no heading yet
    current.nodes.push(child);
  }
  if (!chapters.length) start('');
  return chapters;
}

/** A stable, well-formed urn:uuid from the document's own text (reproducible exports). */
function identifierFor(seed) {
  const hash = (text) => {
    let value = 0x811C9DC5;
    for (let i = 0; i < text.length; i += 1) {
      value ^= text.charCodeAt(i);
      value = Math.imul(value, 0x01000193) >>> 0;
    }
    return value.toString(16).padStart(8, '0');
  };
  const a = hash(seed);
  const b = hash(`epub|${seed}`);
  // 8-4-4-4-12 hex, with the version (4) and variant (8) nibbles set — a valid UUID URN.
  return `urn:uuid:${a}-${b.slice(0, 4)}-4${b.slice(4, 7)}-8${a.slice(0, 3)}-${a.slice(0, 4)}${b.slice(0, 8)}`;
}

function buildXhtmlDocument({ title, lang, dir, body, stylesheet = true }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeXmlAttribute(lang)}" lang="${escapeXmlAttribute(lang)}" dir="${dir}">
<head>
<meta charset="utf-8"/>
<title>${escapeXmlText(title)}</title>${stylesheet ? `\n<link rel="stylesheet" type="text/css" href="style.css"/>` : ''}
</head>
<body dir="${dir}">
${body}
</body>
</html>
`;
}

function buildContainerXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="${OPF_PATH}" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;
}

function buildNavXhtml({ title, lang, dir, chapters }) {
  const items = chapters
    .map((chapter, i) => `      <li><a href="chapter-${i + 1}.xhtml">${escapeXmlText(chapter.title)}</a></li>`)
    .join('\n');
  return buildXhtmlDocument({
    title,
    lang,
    dir,
    body: `<nav epub:type="toc" id="toc">
  <h1>${escapeXmlText(title)}</h1>
  <ol>
${items}
  </ol>
</nav>`,
  });
}

function buildOpf({ title, lang, dir, identifier, modified, chapterCount }) {
  const items = [];
  items.push('    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>');
  items.push('    <item id="style" href="style.css" media-type="text/css"/>');
  for (let i = 1; i <= chapterCount; i += 1) {
    items.push(`    <item id="chapter-${i}" href="chapter-${i}.xhtml" media-type="application/xhtml+xml"/>`);
  }
  const refs = [];
  for (let i = 1; i <= chapterCount; i += 1) refs.push(`    <itemref idref="chapter-${i}"/>`);
  const progression = dir === 'rtl' ? ' page-progression-direction="rtl"' : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id" xml:lang="${escapeXmlAttribute(lang)}" dir="${dir}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">${escapeXmlText(identifier)}</dc:identifier>
    <dc:title>${escapeXmlText(title)}</dc:title>
    <dc:language>${escapeXmlText(lang)}</dc:language>
    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
${items.join('\n')}
  </manifest>
  <spine${progression}>
${refs.join('\n')}
  </spine>
</package>
`;
}

/**
 * Build a complete EPUB archive.
 * @param {{title?: string, lang?: string, direction?: 'ltr'|'rtl', chapters: Array<{title: string, nodes: Node[]}>, identifier?: string, modified?: Date, css?: string}} options
 * @returns {Uint8Array} the `.epub` bytes (a stored-only ZIP).
 */
export function buildEpub({
  title = 'Untitled',
  lang = 'en',
  direction = 'ltr',
  chapters = [],
  identifier = '',
  modified = new Date(),
  css = PAPER_CSS,
} = {}) {
  const dir = direction === 'rtl' ? 'rtl' : 'ltr';
  const safeTitle = String(title || 'Untitled');
  const safeLang = isLanguageTag(lang) ? String(lang) : (dir === 'rtl' ? 'ar' : 'en');
  const list = (Array.isArray(chapters) ? chapters : []).map((chapter, i) => ({
    // A chapter with no heading still needs a nav label: the document title, numbered.
    title: (chapter && chapter.title) || (i === 0 ? safeTitle : `${safeTitle} ${i + 1}`),
    nodes: (chapter && chapter.nodes) || [],
  }));
  if (!list.length) list.push({ title: safeTitle, nodes: [] });
  rewriteCrossChapterAnchors(list);
  const modifiedIso = `${modified.toISOString().replace(/\.\d{3}Z$/, 'Z')}`;
  const pubId = identifier || identifierFor(`${safeTitle}|${list.length}|${list.map((c) => c.title).join('|')}`);

  const files = [
    { name: 'mimetype', data: EPUB_MIMETYPE },
    { name: CONTAINER_PATH, data: buildContainerXml() },
    { name: OPF_PATH, data: buildOpf({ title: safeTitle, lang: safeLang, dir, identifier: pubId, modified: modifiedIso, chapterCount: list.length }) },
    { name: NAV_PATH, data: buildNavXhtml({ title: safeTitle, lang: safeLang, dir, chapters: list }) },
    { name: STYLE_PATH, data: css },
  ];
  list.forEach((chapter, i) => {
    const body = chapter.nodes.map((node) => serializeXhtml(node)).join('\n');
    files.push({
      name: `OEBPS/chapter-${i + 1}.xhtml`,
      data: buildXhtmlDocument({ title: chapter.title, lang: safeLang, dir, body }),
    });
  });

  return zipStore(files, { now: modified });
}

/** The shared render → split → package tail behind the sync and async entry points. */
function packageRenderedNote(file, { modified = new Date() } = {}, rendered) {
  const { el, dir, lang, data } = rendered;
  const chapters = splitChapters(el);
  const baseName = ((file && file.name) || '').replace(/\.(md|markdown|txt)$/i, '') || 'document';
  // Title: an explicit front-matter title wins, then the first chapter heading, then the file
  // name — the same order a reader sees them in.
  const declaredTitle = (data && typeof data.title === 'string' && data.title.trim()) ? data.title.trim() : '';
  const title = declaredTitle
    || (chapters[0] && chapters[0].title)
    || baseName;
  const bytes = buildEpub({ title, lang, direction: dir, chapters, modified });
  return { bytes, baseName, dir };
}

function renderNoteBody(file, {
  direction = 'auto', parseMarkdown, katex = null, DOMPurify = null,
  hljs = null, sanitizeHighlight = (value) => value,
} = {}) {
  return renderExportBody((file && file.content) || '', {
    direction, parseMarkdown, katex, DOMPurify, hljs, sanitizeHighlight,
  });
}

/**
 * Render a note's markdown and wrap it in an EPUB: the renderer-facing entry point used by the
 * Export EPUB menu item. Takes the same injected globals as the HTML/PDF export.
 * @returns {{bytes: Uint8Array, baseName: string, dir: 'ltr'|'rtl'}}
 */
export function buildEpubFromNote(file, options = {}) {
  return packageRenderedNote(file, options, renderNoteBody(file, options));
}

/**
 * Mermaid parity with the HTML export: the SAME async render stage (with the same SVG
 * sanitizer) runs BEFORE splitChapters, so a rendered diagram can never straddle a
 * chapter split. A missing/failing engine falls back to the sync result — the code
 * blocks stay as the visible source, exactly like the HTML export's fallback.
 */
export async function buildEpubFromNoteAsync(file, options = {}) {
  const rendered = renderNoteBody(file, options);
  if (typeof options.loadMermaid === 'function') {
    try {
      const mermaid = await options.loadMermaid();
      await renderMermaid(rendered.el, {
        mermaid,
        sanitize: (svg) => sanitizeSvg(svg, options.DOMPurify),
        idPrefix: 'epub-mermaid',
      });
    } catch (_) { /* engine unavailable → the code blocks remain as the fallback */ }
  }
  // UX-01: EPUB readers cannot load the app's KaTeX stylesheet, so the span copy of
  // every formula would render as stacked unstyled text next to the MathML copy —
  // keep only the native MathML (an EPUB 3 core capability).
  stripKatexHtml(rendered.el);
  return packageRenderedNote(file, options, rendered);
}
