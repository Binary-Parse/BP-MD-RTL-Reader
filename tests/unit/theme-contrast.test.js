/**
 * theme-contrast.test.js — audit UX-06: a per-theme WCAG contrast pin.
 *
 * The tokens live in CSS, so a regression is invisible to every other test (the axe scans
 * run per theme now, but they only see the surfaces a page happens to render). This file
 * parses the token VALUES out of the stylesheets and pins the ratios that matter for text
 * legibility, so darkening/lightening a token cannot silently drop below AA.
 *
 * Thresholds: body/UI text pairs need WCAG AA 4.5:1; the callout accent border/dot needs
 * the 3:1 non-text contrast floor.
 */
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const read = (file) => readFileSync(path.join(ROOT, file), 'utf8');

/** WCAG 2.x relative luminance of a #rrggbb colour. */
function luminance(hex) {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** WCAG contrast ratio between two hex colours (1..21). */
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Collect `--token: #rrggbb` declarations from a CSS block (comment-stripped). */
function tokensIn(css) {
  const out = {};
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [, name, value] of body.matchAll(/--([\w-]+):\s*(#[0-9A-Fa-f]{6})\s*;/g)) {
    out[name] = value.toUpperCase();
  }
  return out;
}

/** The block for one theme: `:root` for paper, `[data-theme="x"]` otherwise. */
function themeTokens(theme) {
  const base = tokensIn(read('src/renderer/styles/base.css'));
  const themes = read('src/renderer/styles/themes.css');
  const blocks = {};
  for (const [, name, body] of themes.matchAll(/\[data-theme="([\w-]+)"\]\s*\{([\s\S]*?)\n\}/g)) {
    blocks[name] = tokensIn(body);
  }
  if (theme === 'paper') return [...Object.entries(base)];
  return Object.entries({ ...base, ...blocks[theme] });
}

// [foreground, background, minimum ratio]
// `plum` and `teal` are TEXT tokens too — italic body copy / CM6 emphasis and hljs
// keyword+type+literal use --plum (components.css:1151,1349; codemirror-adapter.js:55),
// the callout-info accent uses --teal — so a dark theme must redeclare them like ink does.
// (--green is deliberately NOT pinned: paper's #4E8A3F and sepia's inherit 3.7/3.4 on
// --paper, a pre-existing light-theme weakness axe does not reach because its sample markup
// contains no hljs string token. Fixing those is a separate, owner-visible design change.)
const PAIRS = [
  ['ink', 'paper', 4.5],
  ['ink', 'paper-deep', 4.5],
  ['ink-soft', 'paper', 4.5],
  ['ink-mute', 'paper-deep', 4.5],
  ['accent', 'paper', 4.5],
  ['gold', 'paper-deep', 4.5],
  ['plum', 'paper', 4.5],
  ['plum', 'paper-deep', 4.5],
  ['teal', 'paper', 4.5],
  ['teal', 'paper-deep', 4.5],
  ['caution', 'paper-deep', 3.0], // non-text accent floor
];

describe('per-theme WCAG contrast (audit UX-06)', () => {
  for (const theme of ['paper', 'ink', 'sepia', 'oasis']) {
    describe(theme, () => {
      const tokens = Object.fromEntries(themeTokens(theme));

      test('declares every pinned token', () => {
        for (const [fg, bg] of PAIRS) {
          expect(tokens[fg], `${theme} is missing --${fg}`).toMatch(/^#[0-9A-F]{6}$/);
          expect(tokens[bg], `${theme} is missing --${bg}`).toMatch(/^#[0-9A-F]{6}$/);
        }
      });

      for (const [fg, bg, min] of PAIRS) {
        test(`${fg} on ${bg} ≥ ${min}:1`, () => {
          const ratio = contrast(tokens[fg], tokens[bg]);
          expect(ratio, `${theme}: ${fg} ${tokens[fg]} on ${bg} ${tokens[bg]} = ${ratio.toFixed(2)}:1`)
            .toBeGreaterThanOrEqual(min);
        });
      }

      // audit UX-06: the contrast math above is only meaningful if it can FAIL — pin one
      // deliberately impossible pair so a broken helper cannot pass everything silently.
      test('the ratio helper rejects an obviously failing pair', () => {
        expect(contrast('#FFFFFF', '#FFFFFE')).toBeLessThan(1.05);
      });
    });
  }

  // audit UX-06: sepia used to ride :root's --backdrop/--caution implicitly. Owning them
  // (even at the same value) means a future :root edit cannot silently restyle sepia.
  test('sepia declares its own --backdrop and --caution', () => {
    const sepia = Object.fromEntries(themeTokens('sepia'));
    expect(sepia['--backdrop'] ?? sepia.backdrop).toBeDefined();
    const sepiaBlock = /\[data-theme="sepia"\]\s*\{([\s\S]*?)\n\}/.exec(read('src/renderer/styles/themes.css'))[1];
    expect(sepiaBlock).toMatch(/--backdrop:\s*#[0-9A-Fa-f]{6}\s*;/);
    expect(sepiaBlock).toMatch(/--caution:\s*#[0-9A-Fa-f]{6}\s*;/);
  });
});
