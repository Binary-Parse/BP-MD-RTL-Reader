/**
 * tooltip-contract.test.js - v10 redesign (2026-08-25): native title= tooltips are
 * replaced by a designed CSS tooltip. Static assertions on index.html: no chrome
 * element ships a native title, and data-tip/data-i18n-tip take over their role.
 */
import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { MESSAGES } from '../../src/renderer/locale.js';

const html = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'renderer', 'index.html'),
  'utf8',
);

describe('designed tooltips replace native title (v10)', () => {
  test('no static title= attribute remains in the chrome markup', () => {
    const titleAttrs = html.match(/\btitle="[^"]*"/g) || [];
    expect(titleAttrs, `still has title=: ${titleAttrs.join(', ')}`).toEqual([]);
  });

  test('no data-i18n-title remains (renamed to data-i18n-tip)', () => {
    const old = html.match(/data-i18n-title/g) || [];
    expect(old).toEqual([]);
  });

  test('every localized tooltip has its fallback text and a string in both languages', () => {
    const tags = html.match(/<[^>]*\bdata-i18n-tip="[^"]*"[^>]*>/g) || [];
    // at least as many localized tooltips as the old data-i18n-title had
    expect(tags.length).toBeGreaterThanOrEqual(9);
    for (const tag of tags) {
      const key = /data-i18n-tip="([^"]*)"/.exec(tag)[1];
      expect(tag, key).toMatch(/\bdata-tip="[^"]+"/);
      expect(MESSAGES.en[key], `en ${key}`).toBeTruthy();
      expect(MESSAGES.ar[key], `ar ${key}`).toBeTruthy();
    }
  });
});
