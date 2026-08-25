/**
 * chrome-tokens.test.js — T-F19 static assertions on the compact-chrome tokens.
 *
 * Runs in Node: the title-bar and status-bar scale must live in :root custom
 * properties, not in literals scattered across five rules, and the two bars must
 * consume those tokens rather than hard-coded px.
 *
 * It also RESTORES a guard the tokens would otherwise silently disable.
 * typography-rem.test.js enforces the 11px legibility floor (T-T5) by regexing
 * `font-size: <n>rem` out of the chrome CSS — a `font-size: var(--titlebar-font)`
 * matches neither that pattern nor its px counterpart, so every selector converted
 * to a token drops out of both T-T4 and T-T5 coverage. The token-value assertions
 * below re-apply the same floor one level up, at the declaration site.
 *
 * v10 redesign (2026-08-25): titlebar-h 35->38px, statusbar-h 22->24px,
 * statusbar-font 0.75->0.71875rem. --titlebar-mark is dropped from EXPECTED here in
 * the same commit that removes its sole consumer (.tb-brand-name::before, the
 * painted diamond mark) -- so the token is never pinned (or left declared) with no
 * call site, which is the inert-control shape this project bans.
 */
import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const stylesRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'renderer', 'styles',
);
const read = (file) => readFileSync(path.join(stylesRoot, file), 'utf8');
const base = read('base.css');
const components = read('components.css');

// The :root block in base.css — the only place chrome scale may be declared.
const rootBlock = (base.match(/:root\s*\{([^}]*)\}/) || [, ''])[1];

/** Body of the first rule whose selector list is exactly `selector`. */
function ruleBody(css, selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`, 'm').exec(css);
  return m ? m[2] : null;
}

const REM_PER_PX = 1 / 16;
const FLOOR_REM = 11 * REM_PER_PX; // 0.6875rem — same floor as typography-rem.test.js

describe('compact chrome tokens (T-F19)', () => {
  const EXPECTED = {
    '--titlebar-h': '38px',
    '--titlebar-font': '0.8125rem',
    '--titlebar-icon': '16px',
    '--statusbar-h': '24px',
    '--statusbar-font': '0.71875rem',
  };

  for (const [token, value] of Object.entries(EXPECTED)) {
    test(`:root declares ${token}: ${value}`, () => {
      expect(rootBlock, ':root block should be found in base.css').toBeTruthy();
      expect(rootBlock).toMatch(new RegExp(`${token}\\s*:\\s*${value.replace('.', '\\.')}\\s*;`));
    });
  }

  test('every chrome text token is declared in rem, never px', () => {
    const textTokens = [...rootBlock.matchAll(/(--[a-z-]*(?:font|mark))\s*:\s*([^;]+);/g)];
    expect(textTokens.length, 'expected at least one --*-font/--*-mark token').toBeGreaterThan(0);
    const px = textTokens.filter(([, , v]) => /\d\s*px/.test(v));
    expect(px.map(([, k, v]) => `${k}:${v.trim()}`), 'text tokens must be rem so zoom scales them (T-T4)').toEqual([]);
  });

  test('no chrome text token falls below the 11px legibility floor (T-T5)', () => {
    const rems = [...rootBlock.matchAll(/--[a-z-]*(?:font|mark)\s*:\s*([\d.]+)rem\s*;/g)]
      .map((m) => parseFloat(m[1]));
    expect(rems.length).toBeGreaterThan(0);
    const tooSmall = rems.filter((v) => v < FLOOR_REM - 1e-9);
    expect(tooSmall, `below 11px: ${tooSmall.map((v) => `${v}rem`).join(', ')}`).toEqual([]);
  });
});

describe('chrome rules consume the tokens, not literals (T-F19)', () => {
  // These five rules are where the 36px title bar / 26px status bar were hard-coded.
  const TOKENISED = ['.app', '.titlebar', '.win-controls', '.win-btn', '.dropdown'];

  for (const selector of TOKENISED) {
    test(`${selector} carries no literal 36px or 26px`, () => {
      const body = ruleBody(components, selector);
      expect(body, `rule ${selector} should exist in components.css`).toBeTruthy();
      expect(body).not.toMatch(/\b36px\b/);
      expect(body).not.toMatch(/\b26px\b/);
    });
  }

  test('.app row track is fully tokenised', () => {
    expect(ruleBody(components, '.app'))
      .toMatch(/grid-template-rows:\s*var\(--titlebar-h\)\s+1fr\s+var\(--statusbar-h\)/);
  });

  test('.win-btn keeps its explicit 46px width alongside the token height', () => {
    const body = ruleBody(components, '.win-btn');
    expect(body).toMatch(/width:\s*46px/);
    expect(body).toMatch(/height:\s*var\(--titlebar-h\)/);
  });

  test('the title-bar icon size and both bar fonts come from tokens', () => {
    expect(ruleBody(components, '.tb-btn .ic')).toMatch(/width:\s*var\(--titlebar-icon\)/);
    expect(ruleBody(components, '.tb-menu-item')).toMatch(/font-size:\s*var\(--titlebar-font\)/);
    expect(ruleBody(components, '.statusbar')).toMatch(/font-size:\s*var\(--statusbar-font\)/);
  });

  test('the interactive title-bar controls stay at least 24x24 (WCAG 2.2 SC 2.5.8)', () => {
    for (const selector of ['.tb-btn', '.tab-add']) {
      const body = ruleBody(components, selector);
      expect(body, `${selector} should exist`).toBeTruthy();
      const w = parseFloat((body.match(/width:\s*([\d.]+)px/) || [, '0'])[1]);
      const h = parseFloat((body.match(/height:\s*([\d.]+)px/) || [, '0'])[1]);
      expect(w, `${selector} width`).toBeGreaterThanOrEqual(24);
      expect(h, `${selector} height`).toBeGreaterThanOrEqual(24);
    }
  });
});
