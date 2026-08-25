/**
 * v10-chrome-voice.test.js — the v10 redesign's "one chrome voice" rule: Inter for
 * chrome labels, mono reserved for keys and code. The first pass applied it to 2 of
 * the 14 selectors it covers; this pins the rest.
 *
 * Runs in Node: reads components.css as text and checks the consolidated rule exists
 * with its full selector list and declarations, and that the four individually-tuned
 * selectors (.pi-meta, .prop-key, .read-time, .tag) match too.
 */
import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const components = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'renderer', 'styles', 'components.css'),
  'utf8',
);

/** Body of the first rule whose selector list is exactly `selector` (after trimming). */
function ruleBody(css, selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/,\s*/g, '\\s*,\\s*');
  const m = new RegExp(`(^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`, 'm').exec(css);
  return m ? m[2] : null;
}

describe('the shared "one chrome voice" rule (design §12)', () => {
  const SHARED_SELECTOR = '.insp-title, .insp-section h4, .recent-label, .pal-section-label,\n.dd-section-label, .set-group-label, .table-controls .tc-label, .about-version';

  test('exists with the design\'s exact selector list', () => {
    const body = ruleBody(components, SHARED_SELECTOR);
    expect(body, 'the consolidated rule (or its selector list) is missing').not.toBeNull();
  });

  test('declares Inter, weight 600, letter-spacing 0.09em', () => {
    const body = ruleBody(components, SHARED_SELECTOR) || '';
    expect(body).toMatch(/font-family:\s*var\(--sans\)/);
    expect(body).toMatch(/font-weight:\s*600/);
    expect(body).toMatch(/letter-spacing:\s*0\.09em/);
  });

  // Each of the 8 no longer declares its own font-family/letter-spacing/font-weight —
  // those come from the shared rule now. A leftover mono declaration on any of them
  // would win by source order (same specificity) and silently defeat the shared rule.
  for (const selector of ['.insp-title', '.insp-section h4', '.recent-label', '.set-group-label', '.about-version']) {
    test(`${selector} no longer declares its own font-family/letter-spacing`, () => {
      const body = ruleBody(components, selector) || '';
      expect(body, `${selector} still sets its own font-family`).not.toMatch(/font-family:/);
      expect(body, `${selector} still sets its own letter-spacing`).not.toMatch(/letter-spacing:/);
    });
  }

  // These three already used --sans (a prior, partial pass) but at the wrong
  // letter-spacing (0.12em / 0.08em vs the design's shared 0.09em) — own declarations
  // must go so the shared rule's 0.09em actually wins.
  test('.pal-section-label / .dd-section-label no longer set their own letter-spacing', () => {
    for (const selector of ['.pal-section-label', '.dd-section-label']) {
      const body = ruleBody(components, selector) || '';
      expect(body, `${selector} still sets its own letter-spacing`).not.toMatch(/letter-spacing:/);
    }
  });

  test('.table-controls .tc-label no longer sets its own letter-spacing', () => {
    const body = ruleBody(components, '.table-controls .tc-label') || '';
    expect(body, '.tc-label still sets its own letter-spacing').not.toMatch(/letter-spacing:/);
  });
});

describe('the four individually-tuned chrome-voice selectors (design §12)', () => {
  test('.pi-meta: Inter 500, letter-spacing 0.06em (was 0.08em)', () => {
    const body = ruleBody(components, '.pi-meta') || '';
    expect(body).toMatch(/font-family:\s*var\(--sans\)/);
    expect(body).toMatch(/font-weight:\s*500/);
    expect(body).toMatch(/letter-spacing:\s*0\.06em/);
  });

  test('.prop-key: Inter 500, letter-spacing 0.08em (was mono, 0.1em)', () => {
    const body = ruleBody(components, '.prop-key') || '';
    expect(body).toMatch(/font-family:\s*var\(--sans\)/);
    expect(body).toMatch(/font-weight:\s*500/);
    expect(body).toMatch(/letter-spacing:\s*0\.08em/);
  });

  test('.read-time: Inter 600, letter-spacing 0.08em (was mono, 0.1em)', () => {
    const body = ruleBody(components, '.read-time') || '';
    expect(body).toMatch(/font-family:\s*var\(--sans\)/);
    expect(body).toMatch(/font-weight:\s*600/);
    expect(body).toMatch(/letter-spacing:\s*0\.08em/);
  });

  // Font-size is deliberately NOT changed to the design's 0.75rem: adversarial-9bugs.spec.js's
  // AC4 acceptance criterion (Issues #4/#9) requires every side-panel label to stay >= 13px
  // for readability, and that pre-existing app requirement overrides the design's literal
  // value. Only the family (mono -> Inter) is the v10 change here.
  test('.tag: Inter, still 0.8125rem (13px) — the AC4 readability floor wins over the design\'s 0.75rem', () => {
    const body = ruleBody(components, '.tag') || '';
    expect(body).toMatch(/font-family:\s*var\(--sans\)/);
    expect(body).toMatch(/font-size:\s*0\.8125rem/);
  });
});

describe('the three v10 radii the first pass missed (design §12 area)', () => {
  test('.modal-close: border-radius 8px (was 4px)', () => {
    const body = ruleBody(components, '.modal-close') || '';
    expect(body).toMatch(/border-radius:\s*8px/);
  });

  test('.shortcut-keys .kbd: border-radius 6px (was 3px)', () => {
    const body = ruleBody(components, '.shortcut-keys .kbd') || '';
    expect(body).toMatch(/border-radius:\s*6px/);
  });

  test('.set-desc .kbd: border-radius 6px (was 3px)', () => {
    const body = ruleBody(components, '.set-desc .kbd') || '';
    expect(body).toMatch(/border-radius:\s*6px/);
  });
});

describe('unchanged reference points (already matched the design before this fix)', () => {
  test('.sb-tab keeps its own Inter 600 / 0.07em (not part of the shared rule)', () => {
    const body = ruleBody(components, '.sb-tab') || '';
    expect(body).toMatch(/font-family:\s*var\(--sans\)/);
    expect(body).toMatch(/letter-spacing:\s*0\.07em/);
  });

  test('.editor .doc-meta keeps its own Inter 600 / 0.12em (not part of the shared rule)', () => {
    const body = ruleBody(components, '.editor .doc-meta') || '';
    expect(body).toMatch(/font-family:\s*var\(--sans\)/);
    expect(body).toMatch(/letter-spacing:\s*0\.12em/);
  });
});
