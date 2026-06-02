/**
 * typography-rem.test.js — T-T4/T5 static assertions on index.html chrome CSS.
 * Runs in Node: the app's first <style> block (the UI chrome) must size text in
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
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'index.html'),
  'utf8',
);

// The FIRST <style>…</style> is the app chrome. (The second is the export template.)
const chromeCss = html.slice(html.indexOf('<style>') + '<style>'.length, html.indexOf('</style>'));
const REM_PER_PX = 1 / 16;
const MIN_LABEL_REM = 11 * REM_PER_PX; // 0.6875rem

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
    const remFontSizes = [...chromeCss.matchAll(/font-size:\s*([\d.]+)rem/g)].map((m) => parseFloat(m[1]));
    expect(remFontSizes.length).toBeGreaterThan(0);
    const tooSmall = remFontSizes.filter((v) => v < MIN_LABEL_REM - 1e-9);
    expect(tooSmall, `below 11px: ${tooSmall.map((v) => `${v}rem`).join(', ')}`).toEqual([]);
  });

  test('the HTML-export template is left fully in px (a standalone doc — no rem leaked in)', () => {
    // The export template lives in buildExportDoc, extracted to src/renderer/export.js (T-F12).
    const exportJs = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'renderer', 'export.js'), 'utf8');
    const exportCss = exportJs.slice(exportJs.lastIndexOf('<style>') + '<style>'.length, exportJs.lastIndexOf('</style>'));
    expect(exportCss).toMatch(/font-size:\s*18px/);          // body of the exported doc stays px
    expect(exportCss).not.toMatch(/font-size:\s*[\d.]+rem/); // converter never reached the export template
  });
});

describe('rem-convert transform (T-T4)', () => {
  test('re-running the converter on the committed index.html is a no-op (fully converted + idempotent)', () => {
    // The strongest completeness check: the live file is already fully converted, so the
    // pure transform must reproduce it byte-for-byte (no missed px, no double-conversion
    // of the :root base — which a naive converter would turn into 1rem on a second pass).
    expect(convertChromeFontSizes(html)).toBe(html);
  });

  test('every emitted chrome rem maps back to a sane label px (floored ≥ 11, ≤ 64)', () => {
    const remFontSizes = [...chromeCss.matchAll(/font-size:\s*([\d.]+)rem/g)].map((m) => parseFloat(m[1]));
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
