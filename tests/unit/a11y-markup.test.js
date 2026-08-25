/**
 * a11y-markup.test.js — T-F2/F3 static accessibility assertions on index.html.
 * Runs in Node (no browser): parses the HTML and checks ARIA affordances.
 */
import { describe, test, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const html = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'renderer', 'index.html'),
  'utf8',
);

function openingTagById(id) {
  const m = new RegExp(`<[a-zA-Z]+[^>]*\\bid="${id}"[^>]*>`).exec(html);
  return m ? m[0] : null;
}

// Icon-only controls that must expose an accessible name (T-F2).
const ICON_BUTTONS = [
  'winMinBtn', 'winMaxBtn', 'winCloseBtn',
  'rtlBtn', 'themeBtn', 'tabAddBtn',
  'sidebarToggleBtn', 'inspectorToggleBtn',
  'readerControlsButton',
  'fullscreenBtn', // v10 redesign (2026-08-25)
  // (the modeLive/modeSplit/modeSource view-mode buttons were removed — CM6 is the sole editor)
  'tbBold', 'tbItalic', 'findCloseBtn', 'modalCloseBtn', 'searchBtn',
];

describe('icon buttons expose aria-label (T-F2)', () => {
  for (const id of ICON_BUTTONS) {
    test(`#${id} has aria-label`, () => {
      const tag = openingTagById(id);
      expect(tag, `#${id} should exist`).toBeTruthy();
      expect(tag).toMatch(/aria-label="[^"]+"/);
    });
  }
});

// T-F18: the two panel toggles moved into the titlebar. They show/hide a region, so
// they are DISCLOSURES (aria-expanded + aria-controls), not toggle buttons
// (aria-pressed) — see the WAI-ARIA APG disclosure pattern. The static value must be
// "false" because index.html ships #appBody with `no-sidebar no-inspector` for a clean
// first paint; applyPanelLayout() re-syncs it once State is restored.
describe('panel toggles are titlebar disclosures (T-F18)', () => {
  for (const [id, controls] of [
    ['sidebarToggleBtn', 'sidebarPanel'],
    ['inspectorToggleBtn', 'inspectorPanel'],
  ]) {
    test(`#${id} exposes aria-expanded and aria-controls="${controls}"`, () => {
      const tag = openingTagById(id);
      expect(tag, `#${id} should exist`).toBeTruthy();
      expect(tag).toMatch(/aria-expanded="false"/);
      expect(tag).toMatch(new RegExp(`aria-controls="${controls}"`));
      expect(tag).not.toMatch(/aria-pressed=/);
    });

    test(`#${controls} exists so aria-controls is not a dangling IDREF`, () => {
      expect(openingTagById(controls), `#${controls} should exist`).toBeTruthy();
    });
  }
});

describe('toast is a live region (T-F3)', () => {
  test('#toast has role=status and aria-live=polite', () => {
    const tag = openingTagById('toast');
    expect(tag).toBeTruthy();
    expect(tag).toMatch(/role="status"/);
    expect(tag).toMatch(/aria-live="polite"/);
  });
});

describe('overlays are labelled modal dialogs (T-F4)', () => {
  test('command palette inner is role=dialog aria-modal', () => {
    expect(html).toMatch(/<div class="palette" role="dialog" aria-modal="true"[^>]*>/);
  });
  test('modal inner is role=dialog aria-modal labelled by its title', () => {
    expect(html).toMatch(/<div class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle">/);
  });
});

describe('reader controls are an accessible non-modal popover', () => {
  test('Aa trigger and popover expose their relationship and accessible dialog semantics', () => {
    const trigger = openingTagById('readerControlsButton');
    const popover = openingTagById('readerControlsPopover');
    expect(trigger).toMatch(/aria-controls="readerControlsPopover"/);
    expect(trigger).toMatch(/aria-haspopup="dialog"/);
    expect(popover).toMatch(/role="dialog"/);
    expect(popover).toMatch(/aria-modal="false"/);
    expect(popover).toMatch(/aria-labelledby="readerControlsTitle"/);
  });
});

// v10 redesign (2026-08-25): the title bar no longer paints ANY brand mark — the
// former ◆ diamond (.tb-brand-name::before) is removed along with .tb-brand
// entirely (T-F19 previously kept the diamond; the v10 spec drops it too). The
// product name still lives in .visually-hidden inside .tb-lead rather than being
// deleted: removing pixels must not remove the app's name from the accessibility
// tree, and keeping it inside .tb-brand-name means textContent still reports it
// (which is what tests/e2e/help-about.spec.js asserts).
describe('title-bar brand keeps its name for assistive tech (T-F19, v10)', () => {
  const BRAND = /<span class="tb-brand-name">([\s\S]*?)<\/span>\s*<\/div>/;

  test('.tb-brand-name wraps the product name in .visually-hidden', () => {
    const m = BRAND.exec(html);
    expect(m, '.tb-brand-name should exist and close before </div>').toBeTruthy();
    expect(m[1]).toMatch(/<span class="visually-hidden">BP MD RTL Reader<\/span>/);
  });

  test('.tb-brand-name paints no bare text node', () => {
    const m = BRAND.exec(html);
    const bare = m[1].replace(/<span class="visually-hidden">[\s\S]*?<\/span>/, '').trim();
    expect(bare, `unexpected painted text in .tb-brand-name: ${JSON.stringify(bare)}`).toBe('');
  });

  test('.tb-brand no longer exists (v10: no painted brand mark at all)', () => {
    expect(html).not.toMatch(/class="tb-brand"/);
  });
});
