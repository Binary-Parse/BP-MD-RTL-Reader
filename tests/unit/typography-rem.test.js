/**
 * typography-rem.test.js — T-T4/T5 static assertions on the app chrome CSS.
 * Runs in Node: the external app stylesheets must size text in
 * rem (T-T4, so a single root-font / zoom change scales everything) and never use
 * a label smaller than 11px ≡ 0.6875rem (T-T5, legibility floor). The HTML-export
 * <style> template (a separate, standalone document) is intentionally left in px.
 */
import { describe, test, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { convertChromeFontSizes, toRem, FLOOR_PX } from '../../scripts/rem-convert.mjs';

const html = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'renderer', 'index.html'),
  'utf8',
);

const stylesRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'renderer', 'styles');
const chromeCss = ['base.css', 'themes.css', 'components.css', 'responsive.css']
  .map((file) => readFileSync(path.join(stylesRoot, file), 'utf8'))
  .join('\n');
const REM_PER_PX = 1 / 16;
const MIN_LABEL_REM = 11 * REM_PER_PX; // 0.6875rem

// v10 redesign (2026-08-25): two typographic ornaments sit intentionally below the
// label floor. Neither is informational text a screen-reader user needs at a legible
// size: .doc-meta's whole container is aria-hidden="true" (app.js's
// renderReadingContent), and .editor hr renders no text of its own at all -- its
// font-size exists only to size the ::before diamond separator, never a readable
// label. The T-T5 floor exists for chrome LABELS; excluded here, not weakened.
const DECORATIVE_FONT_SIZE_EXCEPTIONS = [
  /\.editor \.doc-meta::before\s*\{[^}]*\}/,
  /\.editor hr\s*\{[^}]*\}/,
];
const chromeCssForFloorCheck = DECORATIVE_FONT_SIZE_EXCEPTIONS.reduce(
  (css, re) => css.replace(re, ''),
  chromeCss,
);

describe('chrome typography sizing (T-T4 / T-T5)', () => {
  test('a stable rem base is declared on :root (so rem is deterministic)', () => {
    expect(chromeCss).toMatch(/:root\s*\{[^}]*font-size:\s*16px/s);
  });

  test('T-T4: chrome font-sizes are rem — only the :root rem base may be px (anchored to :root, not value)', () => {
    // Strip the :root block (where the 16px rem base legitimately lives), then require
    // EVERY remaining font-size to be rem. Anchoring to the :root selector — not the
    // literal "16px" — means a stray `font-size: 16px` on any other selector (which
    // should be 1rem so it scales with zoom) correctly fails this test.
    const chromeNoRoot = chromeCss.replace(/:root\s*\{[^}]*\}/, '');
    const pxFontSizes = chromeNoRoot.match(/font-size:\s*[\d.]+px/g) || [];
    expect(pxFontSizes, `still px outside :root: ${pxFontSizes.join(', ')}`).toEqual([]);
  });

  test('T-T5: no chrome label is smaller than 11px (0.6875rem)', () => {
    const remFontSizes = [...chromeCssForFloorCheck.matchAll(/font-size:\s*([\d.]+)rem/g)].map((m) => parseFloat(m[1]));
    expect(remFontSizes.length).toBeGreaterThan(0);
    const tooSmall = remFontSizes.filter((v) => v < MIN_LABEL_REM - 1e-9);
    expect(tooSmall, `below 11px: ${tooSmall.map((v) => `${v}rem`).join(', ')}`).toEqual([]);
  });

  test('the two decorative sub-floor sizes are exactly the known ones, not a growing exemption list', () => {
    // Guards DECORATIVE_FONT_SIZE_EXCEPTIONS itself: if a THIRD selector's font-size
    // drops below the floor, it must be looked at deliberately, not silently swept
    // into an ever-growing exclusion list.
    const removed = DECORATIVE_FONT_SIZE_EXCEPTIONS
      .map((re) => (chromeCss.match(re) || [''])[0])
      .join('\n');
    const removedSizes = [...removed.matchAll(/font-size:\s*([\d.]+)rem/g)].map((m) => parseFloat(m[1]));
    expect(removedSizes.sort()).toEqual([0.5, 0.625]);
  });

  test('the HTML-export template is left fully in px (a standalone doc — no rem leaked in)', () => {
    // The export template lives in buildExportDoc, extracted to src/renderer/markdown/export.js (T-F12).
    const exportJs = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'renderer', 'markdown', 'export.js'), 'utf8');
    const exportCss = exportJs.slice(exportJs.lastIndexOf('<style>') + '<style>'.length, exportJs.lastIndexOf('</style>'));
    expect(exportCss).toMatch(/font-size:\s*18px/);          // body of the exported doc stays px
    expect(exportCss).not.toMatch(/font-size:\s*[\d.]+rem/); // converter never reached the export template
  });
});

describe('rem-convert transform (T-T4)', () => {
  test('re-running the converter on the committed app CSS is a no-op (fully converted + idempotent)', () => {
    // The strongest completeness check: the live file is already fully converted, so the
    // pure transform must reproduce it byte-for-byte (no missed px, no double-conversion
    // of the :root base — which a naive converter would turn into 1rem on a second pass).
    expect(convertChromeFontSizes(chromeCss)).toBe(chromeCss);
  });

  test('every emitted chrome rem maps back to a sane label px (floored ≥ 11, ≤ 64)', () => {
    const remFontSizes = [...chromeCssForFloorCheck.matchAll(/font-size:\s*([\d.]+)rem/g)].map((m) => parseFloat(m[1]));
    for (const rem of remFontSizes) {
      const px = rem * 16;
      expect(px, `${rem}rem → ${px}px below the 11px floor`).toBeGreaterThanOrEqual(FLOOR_PX - 1e-6);
      expect(px, `${rem}rem → ${px}px implausibly large`).toBeLessThanOrEqual(64);
    }
  });

  test('toRem floors sub-11px and divides by 16 otherwise', () => {
    expect(toRem(8)).toBe('0.6875rem');   // 8 → 11px floor
    expect(toRem(10)).toBe('0.6875rem');  // 10 → 11px floor
    expect(toRem(11)).toBe('0.6875rem');  // 11 exactly
    expect(toRem(15)).toBe('0.9375rem');  // 15/16
    expect(toRem(16)).toBe('1rem');       // trailing zeros dropped
  });
});
