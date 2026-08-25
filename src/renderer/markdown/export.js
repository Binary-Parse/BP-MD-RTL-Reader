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

function neutralizePassiveResources(root) {
  root.querySelectorAll('img[src]').forEach((img) => {
    if (/^data:/i.test(img.getAttribute('src') || '')) return;
    const replacement = root.ownerDocument.createElement('span');
    replacement.className = 'export-image-placeholder';
    replacement.textContent = `[Image: ${img.getAttribute('alt') || 'not embedded'}]`;
    img.replaceWith(replacement);
  });
  root.querySelectorAll('video, audio, source').forEach((media) => {
    media.removeAttribute('src');
    media.removeAttribute('srcset');
    media.removeAttribute('poster');
  });
  root.querySelectorAll('a.wikilink').forEach((link) => {
    const text = root.ownerDocument.createElement('span');
    text.className = 'wikilink';
    text.textContent = link.textContent || link.getAttribute('data-target') || '';
    link.replaceWith(text);
  });
}

export function buildExportDoc(file, {
  direction = 'auto', parseMarkdown, katex = null, DOMPurify = null,
  hljs = null, sanitizeHighlight = (value) => value,
} = {}) {
  const { data, body } = parseFrontMatter((file && file.content) || '');
  // Direction precedence: manual override > front-matter direction > content first-strong.
  const explicitDirection = direction === 'rtl' || direction === 'ltr' ? direction : null;
  const exportDir = resolveDocDirection({
    manual: explicitDirection,
    frontMatter: frontMatterDirection(data),
    content: resolveBlockDirection(body, 'ltr'), // dominant-script base (matches the live preview)
  });
  const exportEl = document.createElement('div');
  exportEl.innerHTML = parseMarkdown(body);
  transformCallouts(exportEl, { parseCalloutHeader, resolveDirection: resolveBlockDirection });
  if (hljs) highlightCode(exportEl, { hljs, sanitize: sanitizeHighlight });
  if (katex) restoreMath(exportEl, { katex, DOMPurify }); // T-F9: pre-render math so the doc needs no JS
  neutralizePassiveResources(exportEl);
  applyBidi(exportEl, { baseDir: exportDir, escape: escapeHtml, forceDir: explicitDirection });
  const html = exportEl.innerHTML;
  // Strip any accepted note extension (case-insensitive); fall back to a sane name.
  const baseName = ((file && file.name) || '').replace(/\.(md|markdown|txt)$/i, '') || 'document';
  const declaredLanguage = typeof data.lang === 'string' && LANGUAGE_TAG.test(data.lang) ? data.lang : null;
  const exportLang = declaredLanguage || (exportDir === 'rtl' ? 'ar' : 'en');
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
code { background: #F2EDE0; padding: 1px 5px; border-radius: 3px; font-size: 14px; }
pre { background: #F2EDE0; padding: 16px 20px; border-radius: 6px; overflow-x: auto; }
img { max-width: 100%; height: auto; }
blockquote { border-inline-start: 3px solid #C0492C; padding-block: 8px; padding-inline-start: 20px; margin: 24px 0; font-style: italic; }
.callout { margin: 20px 0; padding: 12px 16px; border-inline-start: 3px solid #C0492C; background: #F2EDE0; }
.callout-title { display: flex; gap: 8px; font-weight: 600; }
.export-image-placeholder { display: inline-block; padding: 4px 8px; border: 1px dashed #8A8175; color: #5E554C; }
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
  if (typeof options.loadMermaid !== 'function' || !built.fullHtml.includes('language-mermaid')) return built;
  let mermaid;
  try { mermaid = await options.loadMermaid(); }
  catch (_) { return built; }
  const parsed = new DOMParser().parseFromString(built.fullHtml, 'text/html');
  await renderMermaid(parsed.body, {
    mermaid,
    sanitize: (svg) => sanitizeSvg(svg, options.DOMPurify),
    idPrefix: 'export-mermaid',
  });
  return { ...built, fullHtml: '<!DOCTYPE html>\n' + parsed.documentElement.outerHTML };
}
