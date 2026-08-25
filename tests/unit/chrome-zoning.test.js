/**
 * chrome-zoning.test.js — the v10 redesign's title-bar zoning tokens (--sidebar-w,
 * --inspector-w, --tb-lead-w, --win-controls-w, --tb-icons-w).
 *
 * Runs in Node: static assertions that each token's declared VALUE actually equals the
 * geometry it claims to describe, so a future edit to (say) .tb-btn's width can't leave
 * --tb-icons-w quietly wrong. The live-rendered proof that these values align the title
 * bar with the panel columns is tests/e2e/chrome-geometry.spec.js's [v10] tests.
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
const responsive = read('responsive.css');

const rootBlock = (base.match(/:root\s*\{([^}]*)\}/) || [, ''])[1];

function tokenValue(css, token) {
  const m = new RegExp(`${token}\\s*:\\s*([^;]+);`).exec(css);
  return m ? m[1].trim() : null;
}

/** Body of the first rule whose selector list is exactly `selector`. */
function ruleBody(css, selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`, 'm').exec(css);
  return m ? m[2] : null;
}

describe('title-bar zoning tokens (:root, base.css)', () => {
  const EXPECTED = {
    '--sidebar-w': '240px',
    '--inspector-w': '300px',
    '--tb-lead-w': '35px',
    '--win-controls-w': '138px',
    '--tb-icons-w': '147px',
  };
  for (const [token, value] of Object.entries(EXPECTED)) {
    test(`:root declares ${token}: ${value}`, () => {
      expect(tokenValue(rootBlock, token)).toBe(value);
    });
  }

  test('--win-controls-w equals 3 x .win-btn\'s own pinned width', () => {
    const winBtnWidth = parseFloat((ruleBody(components, '.win-btn') || '').match(/width:\s*(\d+)px/)[1]);
    expect(parseFloat(tokenValue(rootBlock, '--win-controls-w'))).toBe(3 * winBtnWidth);
  });

  test('--tb-icons-w equals 5 x .tb-btn width + 4 x .tb-actions gap', () => {
    const tbBtnWidth = parseFloat((ruleBody(components, '.tb-btn') || '').match(/width:\s*(\d+)px/)[1]);
    const gap = parseFloat((ruleBody(components, '.tb-actions') || '').match(/gap:\s*(\d+)px/)[1]);
    expect(parseFloat(tokenValue(rootBlock, '--tb-icons-w'))).toBe(5 * tbBtnWidth + 4 * gap);
  });

  test('--tb-lead-w equals .tb-lead\'s padding-inline-start + one .tb-btn width', () => {
    const leadPad = parseFloat((ruleBody(components, '.tb-lead') || '').match(/padding-inline:\s*(\d+)px/)[1]);
    const tbBtnWidth = parseFloat((ruleBody(components, '.tb-btn') || '').match(/width:\s*(\d+)px/)[1]);
    expect(parseFloat(tokenValue(rootBlock, '--tb-lead-w'))).toBe(leadPad + tbBtnWidth);
  });

  test('--inspector-w leaves a non-negative trailing pad after --win-controls-w + --tb-icons-w', () => {
    const inspectorW = parseFloat(tokenValue(rootBlock, '--inspector-w'));
    const winControlsW = parseFloat(tokenValue(rootBlock, '--win-controls-w'));
    const tbIconsW = parseFloat(tokenValue(rootBlock, '--tb-icons-w'));
    expect(inspectorW - winControlsW - tbIconsW).toBeGreaterThan(0);
  });
});

describe('the tokens are actually consumed, not just declared', () => {
  test('.app-body consumes --sidebar-w / --inspector-w, not literals', () => {
    const body = ruleBody(components, '.app-body') || '';
    expect(body).toMatch(/grid-template-columns:\s*var\(--sidebar-w\)\s+1fr\s+var\(--inspector-w\)/);
  });

  test('.tb-menubar\'s floor derives from --sidebar-w and --tb-lead-w', () => {
    const body = ruleBody(components, '.tb-menubar') || '';
    expect(body).toMatch(/min-inline-size:\s*calc\(var\(--sidebar-w\)\s*-\s*var\(--tb-lead-w\)\s*-\s*4px\)/);
  });

  test('.tb-actions\' trailing padding derives from --inspector-w, --win-controls-w and --tb-icons-w', () => {
    const body = ruleBody(components, '.tb-actions') || '';
    expect(body).toMatch(/padding-inline:\s*12px\s+calc\(var\(--inspector-w\)\s*-\s*var\(--win-controls-w\)\s*-\s*var\(--tb-icons-w\)\)/);
  });

  test('the <=1100px breakpoint overrides --sidebar-w rather than re-hard-coding the body grid', () => {
    const mediaBlock = (responsive.match(/@media \(max-width: 1100px\)\s*\{([\s\S]*?)\n\}/) || [, ''])[1];
    expect(mediaBlock).toMatch(/:root\s*\{\s*--sidebar-w:\s*220px;?\s*\}/);
    expect(mediaBlock).toMatch(/\.app-body\s*\{\s*grid-template-columns:\s*var\(--sidebar-w\)/);
  });
});
