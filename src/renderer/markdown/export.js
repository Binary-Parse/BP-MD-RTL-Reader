/**
 * export.js — build the standalone, bidi-aware export document for a note (T-F6/F12).
 * Pure/import-testable: the renderer (app.js) injects its configured `parseMarkdown` and the
 * katex/DOMPurify globals; everything else is the project's own pure modules. Shared by HTML
 * export and PDF export; both artifacts deny network access.
 */
import { parseFrontMatter, frontMatterDirection } from './frontmatter.js';
import { resolveBlockDirection, resolveDocDirection } from '../bidi.js';
import { applyBidi } from '../bidi-dom.js';
import { escapeHtml } from '../i18n.js';
import { restoreMath } from './math.js';
import { transformCallouts } from './callouts.js';
import { parseCalloutHeader } from './markdown.js';
import { highlightCode } from './highlight.js';
import { renderMermaid } from './mermaid.js';
import { sanitizeSvg } from './trusted.js';

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
    content: resolveBlockDirection(body, 'ltr'), // dominant-script base (matches the live preview)
  });
  const el = document.createElement('div');
  el.innerHTML = parseMarkdown(body);
  transformCallouts(el, { parseCalloutHeader, resolveDirection: resolveBlockDirection });
  if (hljs) highlightCode(el, { hljs, sanitize: sanitizeHighlight });
  if (katex) restoreMath(el, { katex, DOMPurify }); // T-F9: pre-render math so the doc needs no JS
  neutralizePassiveResources(el);
  if (typeof decorate === 'function') decorate(el);
  applyBidi(el, { baseDir: dir, escape: escapeHtml, forceDir: explicitDirection });
  const lang = declaredLanguage(data) || (dir === 'rtl' ? 'ar' : 'en');
  return { el, dir, lang, explicitDirection, data, body };
}

export function buildExportDoc(file, {
  direction = 'auto', parseMarkdown, katex = null, DOMPurify = null,
  hljs = null, sanitizeHighlight = (value) => value,
  annotations = [], annotationsLabel = 'Notes',
} = {}) {
  const { el: exportEl, dir: exportDir, lang: exportLang } = renderExportBody((file && file.content) || '', {
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
  const html = exportEl.innerHTML;
  // Strip any accepted note extension (case-insensitive); fall back to a sane name.
  const baseName = ((file && file.name) || '').replace(/\.(md|markdown|txt)$/i, '') || 'document';
  const cspMeta = `\n<meta http-equiv="Content-Security-Policy" content="${EXPORT_CSP}">`;
  const fullHtml = `<!DOCTYPE html>
<html lang="${escapeHtml(exportLang)}" dir="${exportDir}">
<head>
<meta charset="UTF-8">${cspMeta}
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(baseName)}</title>
<style>
body { font-family: Georgia, serif; font-size: 18px; line-height: 1.7; max-width: 720px; margin: 60px auto; padding: 0 24px; color: #1F1B16; }
h1,h2,h3 { font-weight: 600; line-height: 1.2; }
a { color: #C0492C; }
code { background: #F2EDE0; padding: 1px 5px; border-radius: 3px; font-size: 14px; direction: ltr; unicode-bidi: isolate; }
pre { background: #F2EDE0; padding: 16px 20px; border-radius: 6px; overflow-x: auto; direction: ltr; text-align: start; }
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
</style>
</head>
<body>
${html}
</body>
</html>`;
  return { fullHtml, baseName };
}

/** Add the one asynchronous live-render transform (Mermaid) before export. */
export async function buildExportDocAsync(file, options = {}) {
  const built = buildExportDoc(file, options);
  const wantsMermaid = typeof options.loadMermaid === 'function'
    && built.fullHtml.includes('language-mermaid');
  const wantsMath = built.fullHtml.includes('katex');
  if (!wantsMermaid && !wantsMath) return built;

  const parsed = new DOMParser().parseFromString(built.fullHtml, 'text/html');
  if (wantsMermaid) {
    let mermaid;
    try { mermaid = await options.loadMermaid(); }
    catch (_) { mermaid = null; }
    if (mermaid) {
      await renderMermaid(parsed.body, {
        mermaid,
        sanitize: (svg) => sanitizeSvg(svg, options.DOMPurify),
        idPrefix: 'export-mermaid',
      });
    }
  }
  if (wantsMath) await applyExportMath(parsed);
  return { ...built, fullHtml: '<!DOCTYPE html>\n' + parsed.documentElement.outerHTML };
}

// UX-01: KaTeX output carries TWO copies of every formula — the MathML copy is hidden
// only by katex.min.css (which the export never shipped) and the span copy's layout is
// entirely CSS-driven — so every exported document with math rendered each formula
// twice, one copy broken. Inline the vendored stylesheet (font-faces stripped: the font
// files cannot ride along and url() would only 404); when the stylesheet cannot be
// loaded (offline/test lanes), fall back to the native MathML copy alone.
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

async function applyExportMath(parsed) {
  if (!parsed.body || !parsed.body.querySelector('.katex')) return;
  const css = await loadKatexExportCss();
  if (css) {
    const styleEl = parsed.createElement('style');
    styleEl.textContent = css;
    parsed.head.appendChild(styleEl);
    return;
  }
  stripKatexHtml(parsed.body);
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
