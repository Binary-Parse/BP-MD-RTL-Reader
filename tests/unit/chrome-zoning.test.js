/**
 * chrome-zoning.test.js — the panel-width tokens (--sidebar-w, --inspector-w) and how the
 * Marginalia title bar uses the space between them.
 *
 * Runs in Node: static assertions on the stylesheets. The live-rendered proof is
 * tests/e2e/chrome-geometry.spec.js.
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

function ruleBody(css, selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`, 'm').exec(css);
  return m ? m[2] : null;
}

describe('panel width tokens (:root, base.css)', () => {
  test.each([
    ['--sidebar-w', '19.5rem'],
    ['--inspector-w', '20rem'],
  ])(':root declares %s: %s', (token, value) => {
    expect(tokenValue(rootBlock, token)).toBe(value);
  });

  test.each(['--tb-lead-w', '--win-controls-w', '--tb-icons-w'])(
    'the retired zoning token %s is gone',
    (token) => {
      expect(rootBlock).not.toContain(token);
      expect(components).not.toContain(token);
    },
  );
});

describe('the tokens are actually consumed, not just declared', () => {
  test('.app-body consumes --sidebar-w / --inspector-w, not literals', () => {
    const body = ruleBody(components, '.app-body') || '';
    expect(body).toMatch(/grid-template-columns:\s*var\(--sidebar-w\)\s+1fr\s+var\(--inspector-w\)/);
  });

  test('the command bar flexes between the menus and the action cluster', () => {
    const body = ruleBody(components, '.tb-search') || '';
    expect(body).toMatch(/flex:\s*1\s+1\s+0/);
    expect(body).toMatch(/max-width:\s*34rem/);
    expect(body).toMatch(/margin-inline:\s*auto/);
  });

  test('the <=1100px breakpoint overrides --sidebar-w rather than re-hard-coding the body grid', () => {
    const mediaBlock = (responsive.match(/@media \(max-width: 1100px\)\s*\{([\s\S]*?)\n\}/) || [, ''])[1];
    expect(mediaBlock).toMatch(/:root\s*\{\s*--sidebar-w:\s*16rem;?\s*\}/);
    expect(mediaBlock).toMatch(/\.app-body\s*\{\s*grid-template-columns:\s*var\(--sidebar-w\)/);
  });
});
