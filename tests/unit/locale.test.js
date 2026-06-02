/**
 * locale.test.js — T-R7 pure UI string catalog (locale.js): translate with fallback,
 * and the direction implied by a locale.
 */
import { describe, test, expect } from 'vitest';
import { t, localeDirection, MESSAGES } from '../../src/renderer/locale.js';

describe('t (translate) — T-R7', () => {
  test('returns the locale string when present', () => {
    expect(t('menu.file', 'ar')).toBe('ملف');
    expect(t('menu.file', 'en')).toBe('File');
    expect(t('panel.files', 'ar')).toBe('الملفات');
  });
  test('falls back to English, then to the key itself', () => {
    expect(t('menu.view', 'fr')).toBe('View');   // unknown locale → en
    expect(t('does.not.exist', 'ar')).toBe('does.not.exist'); // unknown key → key
    expect(t('does.not.exist')).toBe('does.not.exist');
  });
  test('defaults to English when no locale is given', () => {
    expect(t('menu.edit')).toBe('Edit');
  });
  test('en and ar catalogs cover the same keys (no missing translations)', () => {
    expect(Object.keys(MESSAGES.ar).sort()).toEqual(Object.keys(MESSAGES.en).sort());
  });
});

describe('localeDirection — T-R7', () => {
  test('ar → rtl, everything else → ltr', () => {
    expect(localeDirection('ar')).toBe('rtl');
    expect(localeDirection('en')).toBe('ltr');
    expect(localeDirection('fr')).toBe('ltr');
  });
});
