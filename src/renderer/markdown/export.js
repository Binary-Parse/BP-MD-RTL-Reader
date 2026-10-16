/**
 * export.js — build the standalone, bidi-aware export document for a note (T-F6/F12).
 * Pure/import-testable: the renderer (app.js) injects its configured `parseMarkdown` and the
 * katex/DOMPurify globals; everything else is the project's own pure modules. Shared by HTML
 * export and PDF export; both artifacts deny network access.
 */
import { parseFrontMatter, frontMatterDirection } from './frontmatter.js';
import { resolveBlockDirection, proseText, resolveDocDirection, headingSlugs } from '../bidi.js';
import { applyBidi } from '../bidi-dom.js';
import { escapeHtml } from '../i18n.js';
import { restoreMath } from './math.js';
import { transformCallouts } from './callouts.js';
import { parseCalloutHeader } from './markdown.js';
import { highlightCode } from './highlight.js';
import { renderMermaid } from './mermaid.js';
import { sanitizeSvg } from './trusted.js';
import { tableFrameLabel } from '../components/table-frame.js';

// No frame-ancestors, report-uri or sandbox here: W3C CSP3 3.3 excludes all three from
// <meta http-equiv> delivery, so they protect nothing and make every opened export log a
// console error. The app's own document serves frame-ancestors as a real response header
// instead; a standalone exported file has no response layer, so the directive is dropped
// rather than left in place to read as protection. Pinned by tests/unit/export.test.js.
const EXPORT_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; media-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const LANGUAGE_TAG = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

// The only hrefs that keep working inside a standalone exported artifact: web links,
// mail/tel, and same-document anchors. Everything else (relative files, app URLs)
// would survive as a dead link — neutralized the same way wikilinks are.
const EXPORTABLE_HREF = /^(?:https?:|mailto:|tel:|#)/i;

function neutralizePassiveResources(root) {
  root.querySelectorAll('img[src]').forEach((img) => {
    if (/^data:/i.test(img.getAttribute('src') || '')) return;
    const replacement = root.ownerDocument.createElement('span');
    replacement.className = 'export-image-placeholder';
    replacement.textContent = `[Image: ${img.getAttribute('alt') || 'not embedded'}]`;
    img.replaceWith(replacement);
  });
  root.querySelectorAll('img[srcset]').forEach((img) => img.removeAttribute('srcset'));
  root.querySelectorAll('video, audio, source').forEach((media) => {
    media.removeAttribute('src');
    media.removeAttribute('srcset');
    media.removeAttribute('poster');
  });
  root.querySelectorAll('a[href]').forEach((link) => {
    const href = (link.getAttribute('href') || '').trim();
    if (EXPORTABLE_HREF.test(href)) return;
    const text = root.ownerDocument.createElement('span');
    text.textContent = link.textContent || '';
    link.replaceWith(text);
  });
  root.querySelectorAll('a.wikilink').forEach((link) => {
    const text = root.ownerDocument.createElement('span');
    text.className = 'wikilink';
    text.textContent = link.textContent || link.getAttribute('data-target') || '';
    link.replaceWith(text);
  });
}

/**
 * T5.1c: the "Notes" appendix appended to an exported HTML/PDF document. Built through the DOM
 * API with textContent only (never innerHTML), so a note containing markup is exported as the
 * literal text the user typed. Returns null when there is nothing to append.
 */
function buildAnnotationsAppendix(doc, annotations, label) {
  if (!Array.isArray(annotations) || annotations.length === 0) return null;
  const section = doc.createElement('section');
  section.className = 'export-annotations';
  const heading = doc.createElement('h2');
  heading.textContent = label;
  section.appendChild(heading);
  const list = doc.createElement('ol');
  list.className = 'export-annotation-list';
  for (const entry of annotations) {
    if (!entry || typeof entry.text !== 'string' || entry.text === '') continue;
    const item = doc.createElement('li');
    const excerpt = doc.createElement('blockquote');
    excerpt.className = 'export-annotation-excerpt';
    excerpt.textContent = entry.text;
    item.appendChild(excerpt);
    if (typeof entry.note === 'string' && entry.note !== '') {
      const note = doc.createElement('p');
      note.className = 'export-annotation-note';
      note.textContent = entry.note;
      item.appendChild(note);
    }
    list.appendChild(item);
  }
  if (!list.childNodes.length) return null;
  section.appendChild(list);
  return section;
}

/** True for a well-formed BCP-47 language tag (shared by the HTML and EPUB exporters). */
export function isLanguageTag(value) {
  return typeof value === 'string' && LANGUAGE_TAG.test(value);
}

/** The front matter's `lang:` when it is a well-formed BCP-47 tag, else null. */
function declaredLanguage(data) {
  return (data && isLanguageTag(data.lang)) ? data.lang : null;
}

/**
 * QA-M22: the language of a right-to-left note without a `lang:`, guessed from its letters.
 * Every RTL note used to be exported as `ar`, so a screen reader read Persian, Urdu and
 * Hebrew with an Arabic voice. Hebrew has its own block; Persian and Urdu share the Arabic
 * block but use letters Arabic does not (پ چ ژ گ, and ٹ ڈ ڑ ں ے for Urdu). A note in plain
 * Arabic letters stays `ar`. Set `lang:` in the front matter when the guess is wrong.
 */
export function rtlLanguage(text) {
  const s = String(text || '');
  const hebrew = (s.match(/[\u0590-\u05FF]/g) || []).length;
  const arabic = (s.match(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g) || []).length;
  if (hebrew > arabic) return 'he';
  if (/[\u0679\u0688\u0691\u06BA\u06C1\u06D2]/.test(s)) return 'ur';
  if (/[\u067E\u0686\u0698\u06AF]/.test(s)) return 'fa';
  return 'ar';
}

/** The language of a note: its front matter's `lang:`, else a guess from its letters. */
function noteLanguage(data, dir, prose) {
  return declaredLanguage(data) || (dir === 'rtl' ? rtlLanguage(prose) : 'en');
}

// QA-L3: the reading view gives headings ids (buildTOC in app.js) but the exports did not, so
// a `[see](#section)` link was dead in HTML and PDF and was stripped from EPUB. Same rule.
function assignHeadingIds(el) {
  const headings = [...el.querySelectorAll('h1, h2, h3, h4, h5, h6')];
  const slugs = headingSlugs(headings.map((h) => (h.textContent || '').trim()));
  headings.forEach((h, i) => { if (slugs[i] && !h.id) h.id = slugs[i]; });
}

/**
 * The shared markdown → bidi-rendered-DOM pipeline behind every export artifact (HTML, PDF,
 * EPUB): front matter + direction precedence, callouts, code highlighting, math, the image
 * policy, then one per-block bidi pass. `decorate` runs after the image policy and BEFORE the
 * bidi pass, so an appended block gets the same direction treatment as the body.
 * @returns {{el: HTMLElement, dir: 'ltr'|'rtl', lang: string, explicitDirection: string|null,
 *            data: object, body: string}}
 */
export function renderExportBody(content, {
  direction = 'auto', parseMarkdown, katex = null, DOMPurify = null,
  hljs = null, sanitizeHighlight = (value) => value, decorate = null,
} = {}) {
  const { data, body } = parseFrontMatter(content || '');
  // Direction precedence: manual override > front-matter direction > content first-strong.
  const explicitDirection = direction === 'rtl' || direction === 'ltr' ? direction : null;
  const dir = resolveDocDirection({
    manual: explicitDirection,
    frontMatter: frontMatterDirection(data),
    content: resolveBlockDirection(proseText(body), 'ltr'), // dominant-script base on prose only (matches the live preview; audit H8)
  });
  const el = document.createElement('div');
  el.innerHTML = parseMarkdown(body);
  transformCallouts(el, { parseCalloutHeader, resolveDirection: resolveBlockDirection });
  if (hljs) highlightCode(el, { hljs, sanitize: sanitizeHighlight });
  if (katex) restoreMath(el, { katex, DOMPurify }); // T-F9: pre-render math so the doc needs no JS
  neutralizePassiveResources(el);
  assignHeadingIds(el);
  if (typeof decorate === 'function') decorate(el);
  applyBidi(el, { baseDir: dir, escape: escapeHtml, forceDir: explicitDirection });
  const lang = noteLanguage(data, dir, proseText(body));
  return { el, dir, lang, explicitDirection, data, body };
}

/**
 * W1: a table that cannot fit the page scrolls inside its own frame, never the page. The
 * exported file runs no script, so the frame is always keyboard-focusable. Runs after the
 * bidi pass so the table's own `dir` is already settled.
 */
function frameTables(root, lang) {
  for (const table of [...root.querySelectorAll('table')]) {
    const frame = root.ownerDocument.createElement('div');
    frame.className = 'table-frame';
    frame.setAttribute('role', 'region');
    frame.setAttribute('tabindex', '0');
    frame.setAttribute('aria-label', tableFrameLabel(lang.toLowerCase().startsWith('ar') ? 'ar' : 'en'));
    table.replaceWith(frame);
    frame.appendChild(table);
  }
}

/**
 * Render the note body for a standalone export: the bidi-rendered element plus the facts the
 * document shell needs. The element stays detached so the async transforms (Mermaid, math) can
 * run on it BEFORE serialization.
 */
function renderExportParts(file, {
  direction = 'auto', parseMarkdown, katex = null, DOMPurify = null,
  hljs = null, sanitizeHighlight = (value) => value,
  annotations = [], annotationsLabel = 'Notes',
} = {}) {
  const { el, dir, lang } = renderExportBody((file && file.content) || '', {
    direction,
    parseMarkdown,
    katex,
    DOMPurify,
    hljs,
    sanitizeHighlight,
    // T5.1c: the Notes appendix goes in BEFORE the bidi pass so its blocks get the same
    // per-block direction treatment as the body (and it IS part of the exported document).
    decorate: (root) => {
      const appendix = buildAnnotationsAppendix(document, annotations, annotationsLabel);
      if (appendix) root.appendChild(appendix);
    },
  });
  frameTables(el, lang);
  // Strip any accepted note extension (case-insensitive); fall back to a sane name.
  const baseName = ((file && file.name) || '').replace(/\.(md|markdown|txt)$/i, '') || 'document';
  return { el, dir, lang, baseName };
}

// Column alignment (`:--`, `:-:`, `--:`) that follows the direction of the table. Shared by
// the HTML export and the EPUB stylesheet.
export const TABLE_ALIGN_CSS = `th[align="left"], td[align="left"] { text-align: start; }
th[align="right"], td[align="right"] { text-align: end; }
th[align="center"], td[align="center"] { text-align: center; }
/* QA M14: a cell with its own direction (a Latin cell in an Arabic table) still aligns by the
   direction of the table, so a column lines up. Browsers without :dir() keep the rules above. */
table:dir(rtl) th[align="left"], table:dir(rtl) td[align="left"] { text-align: right; }
table:dir(rtl) th[align="right"], table:dir(rtl) td[align="right"] { text-align: left; }
table:dir(ltr) th[align="left"], table:dir(ltr) td[align="left"] { text-align: left; }
table:dir(ltr) th[align="right"], table:dir(ltr) td[align="right"] { text-align: right; }`;

/**
 * The one place the export document is serialized. Built as a string and never re-parsed:
 * under the app's Trusted Types policy a re-parse sanitizes the document as a fragment, which
 * drops <html lang/dir>, <meta charset>, the CSP meta and <title> (audit H1).
 */
function assembleExportDoc({ bodyHtml, dir, lang, baseName, extraCss = '' }) {
  const cspMeta = `\n<meta http-equiv="Content-Security-Policy" content="${EXPORT_CSP}">`;
  // A stylesheet is raw text inside <style>; it must not be able to end the element.
  const extraStyle = extraCss ? `\n<style>\n${extraCss.replace(/<\/style/gi, '')}\n</style>` : '';
  return `<!DOCTYPE html>
<html lang="${escapeHtml(lang)}" dir="${dir}">
<head>
<meta charset="UTF-8">${cspMeta}
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(baseName)}</title>
<style>
body { font-family: Georgia, 'Noto Naskh Arabic', 'Segoe UI', Tahoma, 'Geeza Pro', serif; font-size: 18px; line-height: 1.7; max-width: 720px; margin: 60px auto; padding: 0 24px; color: #1F1B16; overflow-wrap: anywhere; }
h1,h2,h3 { font-weight: 600; line-height: 1.2; }
a { color: #C0492C; }
code { background: #F2EDE0; padding: 1px 5px; border-radius: 3px; font-size: 14px; direction: ltr; unicode-bidi: isolate; }
pre { background: #F2EDE0; padding: 16px 20px; border-radius: 6px; white-space: pre-wrap; overflow-wrap: anywhere; overflow-x: auto; direction: ltr; text-align: start; }
pre code { padding: 0; background: none; }
.table-frame { max-width: 100%; margin: 16px 0; overflow-x: auto; }
table { border-collapse: collapse; width: 100%; }
th, td { min-width: 8ch; padding: 6px 10px; border-bottom: 1px solid #D9D2C4; text-align: start; vertical-align: top; }
${TABLE_ALIGN_CSS}
.math-block, .mermaid { display: block; max-width: 100%; overflow-x: auto; direction: ltr; text-align: center; }
.mermaid svg { max-width: 100%; height: auto; }
@media print {
  .table-frame, .mermaid { overflow: visible; }
  table { table-layout: fixed; }
  th, td { min-width: 0; }
}
img { max-width: 100%; height: auto; }
blockquote { border-inline-start: 3px solid #C0492C; padding-block: 8px; padding-inline-start: 20px; margin: 24px 0; font-style: italic; }
.callout { margin: 20px 0; padding: 12px 16px; border-inline-start: 3px solid #C0492C; background: #F2EDE0; }
.callout-title { display: flex; gap: 8px; font-weight: 600; }
.export-image-placeholder { display: inline-block; padding: 4px 8px; border: 1px dashed #8A8175; color: #5E554C; }
.export-annotations { margin-top: 48px; padding-top: 16px; border-top: 1px solid #D9D2C4; }
.export-annotations h2 { font-size: 20px; }
.export-annotation-list { padding-inline-start: 24px; }
.export-annotation-excerpt { margin: 0 0 4px; font-size: 15px; color: #5E554C; }
.export-annotation-note { margin: 0 0 12px; }
</style>${extraStyle}
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

export function buildExportDoc(file, options = {}) {
  const { el, dir, lang, baseName } = renderExportParts(file, options);
  return { fullHtml: assembleExportDoc({ bodyHtml: el.innerHTML, dir, lang, baseName }), baseName };
}

/** Add the asynchronous live-render transforms (Mermaid, the math stylesheet) before export. */
export async function buildExportDocAsync(file, options = {}) {
  const { el, dir, lang, baseName } = renderExportParts(file, options);
  if (typeof options.loadMermaid === 'function' && el.querySelector('code.language-mermaid')) {
    let mermaid;
    try { mermaid = await options.loadMermaid(); }
    catch (_) { mermaid = null; }
    if (mermaid) {
      await renderMermaid(el, {
        mermaid,
        sanitize: (svg) => sanitizeSvg(svg, options.DOMPurify),
        idPrefix: 'export-mermaid',
      });
    }
  }
  let extraCss = '';
  if (el.querySelector('.katex')) {
    extraCss = await loadKatexExportCss();
    if (!extraCss) stripKatexHtml(el);
  }
  return { fullHtml: assembleExportDoc({ bodyHtml: el.innerHTML, dir, lang, baseName, extraCss }), baseName };
}

// UX-01: KaTeX output carries TWO copies of every formula — the MathML copy is hidden
// only by katex.min.css (which the export never shipped) and the span copy's layout is
// entirely CSS-driven — so every exported document with math rendered each formula
// twice, one copy broken. Inline the vendored stylesheet (font-faces stripped: the font
// files cannot ride along and url() would only 404); when the stylesheet cannot be
// loaded (offline/test lanes), fall back to the native MathML copy alone (the caller
// strips the span copy when this resolves to '').
let cachedKatexCss = null;
async function loadKatexExportCss() {
  if (cachedKatexCss !== null) return cachedKatexCss;
  try {
    const res = await fetch('../../resources/vendor/katex/katex.min.css');
    if (!res.ok) throw new Error(String(res.status));
    cachedKatexCss = (await res.text()).replace(/@font-face\s*\{[^}]*\}/g, '');
  } catch (_) {
    cachedKatexCss = '';
  }
  return cachedKatexCss;
}

/** Keep only the native MathML copy of each formula (offline exports, EPUB chapters). */
export function stripKatexHtml(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return root;
  for (const span of [...root.querySelectorAll('.katex-html')]) span.remove();
  for (const wrapper of [...root.querySelectorAll('.katex-mathml')]) {
    const math = wrapper.querySelector('math');
    if (math) wrapper.replaceWith(math);
  }
  return root;
}
