/**
 * export.js — build the standalone, bidi-aware export document for a note (T-F6/F12).
 * Pure/import-testable: the renderer (app.js) injects its configured `parseMarkdown` and the
 * katex/DOMPurify globals; everything else is the project's own pure modules. Shared by HTML
 * export (no CSP) and PDF export (CSP meta for the offscreen 0-network render).
 */
import { parseFrontMatter, frontMatterDirection } from './frontmatter.js';
import { resolveBlockDirection, resolveDocDirection } from './bidi.js';
import { applyBidi } from './bidi-dom.js';
import { escapeHtml } from './i18n.js';
import { restoreMath } from './math.js';

export function buildExportDoc(file, { manualRtl = false, parseMarkdown, csp = false, katex = null, DOMPurify = null } = {}) {
  const { data, body } = parseFrontMatter((file && file.content) || '');
  // Direction precedence: manual override > front-matter direction > content first-strong.
  const exportDir = resolveDocDirection({
    manual: manualRtl ? 'rtl' : null,
    frontMatter: frontMatterDirection(data),
    content: resolveBlockDirection(body, 'ltr'), // dominant-script base (matches the live preview)
  });
  const exportEl = document.createElement('div');
  exportEl.innerHTML = parseMarkdown(body);
  if (katex) restoreMath(exportEl, { katex, DOMPurify }); // T-F9: pre-render math so the doc needs no JS
  applyBidi(exportEl, { baseDir: exportDir, escape: escapeHtml });
  const html = exportEl.innerHTML;
  // Strip any accepted note extension (case-insensitive); fall back to a sane name.
  const baseName = ((file && file.name) || '').replace(/\.(md|markdown|txt)$/i, '') || 'document';
  // PDF export embeds a strict CSP so the offscreen render can't fetch remote resources
  // (SC2). HTML export keeps no CSP so a user-opened doc behaves like a normal page.
  const cspMeta = csp ? `\n<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:">` : '';
  const fullHtml = `<!DOCTYPE html>
<html lang="${exportDir === 'rtl' ? 'ar' : 'en'}" dir="${exportDir}">
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
</style>
</head>
<body>
${html}
</body>
</html>`;
  return { fullHtml, baseName };
}
