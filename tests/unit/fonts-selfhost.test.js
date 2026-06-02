/**
 * fonts-selfhost.test.js — T-B3/T1/T3 self-hosted fonts. Static assertions on index.html:
 * no Google Fonts CDN, every @font-face resolves from assets/vendor/fonts/*.woff2 (which
 * must exist on disk), the weights T1 needs are declared, and font-synthesis:none (T2) is
 * set so the browser ships real weights rather than faking bold/italic.
 */
import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(path.join(root, 'index.html'), 'utf8');

describe('self-hosted fonts (T-B3 / T1 / T3)', () => {
  test('no Google Fonts (or any CDN) font reference remains', () => {
    expect(html).not.toMatch(/fonts\.googleapis\.com/);
    expect(html).not.toMatch(/fonts\.gstatic\.com/);
    expect(html).not.toMatch(/<link[^>]+rel="preconnect"/);
  });

  test('declares @font-face for all four families', () => {
    for (const fam of ['Fraunces', 'Inter', 'JetBrains Mono', 'IBM Plex Sans Arabic']) {
      const re = new RegExp(`@font-face\\s*\\{[^}]*font-family:\\s*'${fam}'`, 's');
      expect(html, `missing @font-face for ${fam}`).toMatch(re);
    }
  });

  test('every @font-face src is a local assets/vendor/fonts/*.woff2 that exists on disk', () => {
    const srcs = [...html.matchAll(/@font-face\s*\{[^}]*\}/gs)]
      .flatMap((b) => [...b[0].matchAll(/url\(['"]?([^'")]+)['"]?\)/g)].map((m) => m[1]));
    expect(srcs.length).toBeGreaterThanOrEqual(8);
    for (const src of srcs) {
      expect(src, `non-local font src: ${src}`).toMatch(/^assets\/vendor\/fonts\/[^/]+\.woff2$/);
      expect(existsSync(path.join(root, src)), `missing file: ${src}`).toBe(true);
    }
  });

  test('T1: variable families declare a weight RANGE and Arabic declares 400/500/600/700', () => {
    // Fraunces variable must span at least 300→700 (300/500/600/700 used in the UI).
    expect(html).toMatch(/font-family:\s*'Fraunces'[^}]*font-weight:\s*300\s+700/s);
    // IBM Plex Sans Arabic ships 4 static weights.
    for (const w of [400, 500, 600, 700]) {
      const re = new RegExp(`font-family:\\s*'IBM Plex Sans Arabic'[^}]*font-weight:\\s*${w}\\b`, 's');
      expect(html, `missing IBM Plex Arabic weight ${w}`).toMatch(re);
    }
  });

  test('T2: font-synthesis:none is set (no faked bold/italic)', () => {
    expect(html).toMatch(/font-synthesis:\s*none/);
  });

  test('families used with font-style:italic ship a REAL italic face (font-synthesis:none → no faux-oblique)', () => {
    // Body <em> is --sans (Inter); code comments are --mono (JetBrains); headings/UI accents
    // are --serif (Fraunces). All three are used italic somewhere, so each needs an italic face.
    for (const fam of ['Fraunces', 'Inter', 'JetBrains Mono']) {
      const re = new RegExp(`@font-face\\s*\\{[^}]*font-family:\\s*'${fam}'[^}]*font-style:\\s*italic`, 's');
      expect(html, `${fam} is used italic but ships no italic @font-face`).toMatch(re);
    }
  });
});
