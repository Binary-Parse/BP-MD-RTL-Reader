/**
 * a11y-markup.test.js — T-F2/F3 static accessibility assertions on index.html.
 * Runs in Node (no browser): parses the HTML and checks ARIA affordances.
 */
import { describe, test, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const html = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'index.html'),
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
  'modeLive', 'modeSplit', 'modeSource',
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
