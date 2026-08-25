// T-T4/T5 transform: in the app chrome CSS rewrite every
// `font-size: Npx` as rem against a 16px root, with an 11px (0.6875rem) legibility floor,
// and declare the rem base on :root. Leaves the export-template CSS and all other px
// (borders, spacing, shadows) untouched — those scale via root-font-size zoom (T-T4).
//
// `convertChromeFontSizes` is pure and IDEMPOTENT (the :root base is split out so it is
// never itself converted on a re-run) — unit-tested in tests/unit/typography-rem.test.js.
import { readFileSync, writeFileSync } from 'node:fs';

export const BASE_PX = 16;
export const FLOOR_PX = 11;
export const toRem = (px) => `${Number((Math.max(px, FLOOR_PX) / BASE_PX).toFixed(5))}rem`;

export function convertChromeFontSizes(css) {
  let chrome = css;
  // 1. Ensure the :root rem base exists (idempotent — only inject once).
  if (!/:root\s*\{[^}]*font-size:\s*16px/s.test(chrome)) {
    chrome = chrome.replace(/:root\s*\{/, ':root {\n  font-size: 16px; /* rem base for app-wide zoom (T-T4) */');
  }

  // 2. Convert px font-sizes to rem everywhere EXCEPT the :root base, which must stay px.
  //    Splitting it out keeps the transform idempotent (re-running never touches the base).
  const root = (chrome.match(/:root\s*\{[^}]*\}/) || [''])[0];
  const PH = '\u0000ROOT\u0000';
  const rest = root ? chrome.replace(root, PH) : chrome;
  const converted = rest.replace(/font-size:\s*([\d.]+)px/g, (_m, n) => `font-size: ${toRem(parseFloat(n))}`);
  chrome = root ? converted.replace(PH, () => root) : converted;

  return chrome;
}

// CLI: rewrite the external app stylesheets in place.
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('rem-convert.mjs')) {
  const files = ['base.css', 'themes.css', 'components.css', 'responsive.css']
    .map((file) => new URL(`../src/renderer/styles/${file}`, import.meta.url));
  let changed = false;
  for (const file of files) {
    const before = readFileSync(file, 'utf8');
    const after = convertChromeFontSizes(before);
    writeFileSync(file, after, 'utf8');
    changed ||= after !== before;
  }
  console.log(changed ? 'converted app chrome font-sizes to rem' : 'no change (already converted)');
}
