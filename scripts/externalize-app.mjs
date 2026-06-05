// One-shot, idempotent: move the inline <script type="module"> and the inline theme-boot
// <script> out of index.html into external files under src/renderer/, so a strict CSP
// (script-src 'self', no inline script) can be applied (T-B4). ES import specifiers are
// rebased ('./src/renderer/x' → './x') because app.js now lives inside src/renderer/.
// Runtime URLs (script.src='assets/...', etc.) resolve against the document, so untouched.
import { readFileSync, writeFileSync } from 'node:fs';

const idxUrl = new URL('../index.html', import.meta.url);
let html = readFileSync(idxUrl, 'utf8');

// 1. Theme-boot inline <script>…</script> (the FOUC-avoiding localStorage theme read).
const bootRe = /<script>\(function\(\)\{const t=localStorage[\s\S]*?<\/script>/;
const bootMatch = html.match(bootRe);
if (bootMatch) {
  const inner = bootMatch[0].replace(/^<script>/, '').replace(/<\/script>$/, '');
  writeFileSync(new URL('../src/renderer/theme-boot.js', import.meta.url),
    '// Set the saved theme before first paint (avoids a flash). Externalized for CSP (T-B4).\n' + inner + '\n', 'utf8');
  html = html.replace(bootRe, '<script src="src/renderer/theme-boot.js"></script>');
}

// 2. The big inline ES module → src/renderer/app.js (rebased imports).
const open = '<script type="module">';
const start = html.indexOf(open);
if (start !== -1) {
  const bodyStart = start + open.length;
  const end = html.indexOf('</script>', bodyStart);
  let mod = html.slice(bodyStart, end);
  mod = mod.replace(/(['"])\.\/src\/renderer\//g, '$1./'); // rebase imports to this file's dir
  writeFileSync(new URL('../src/renderer/app.js', import.meta.url), mod.replace(/^\s*\n/, '') + '\n', 'utf8');
  html = html.slice(0, start) + '<script type="module" src="src/renderer/app.js"></script>' + html.slice(end + '</script>'.length);
}

writeFileSync(idxUrl, html, 'utf8');
console.log('externalized theme-boot + app module');
