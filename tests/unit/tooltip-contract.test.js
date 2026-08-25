/**
 * tooltip-contract.test.js - v10 redesign (2026-08-25): native title= tooltips are
 * replaced by a designed CSS tooltip. Static assertions on index.html: no chrome
 * element ships a native title, and data-tip/data-i18n-tip take over their role.
 */
import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

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

  test('every element that previously had a tooltip now carries data-tip', () => {
    const dataTips = html.match(/\bdata-tip="[^"]*"/g) || [];
    expect(dataTips.length).toBeGreaterThan(0);
  });

  test('data-i18n-tip carries at least as many localized tooltips as the old data-i18n-title did', () => {
    const dataI18nTip = html.match(/data-i18n-tip="[^"]*"/g) || [];
    expect(dataI18nTip.length).toBeGreaterThanOrEqual(9);
  });
});
