/**
 * rtl-moats.test.js — T-R6 front-matter direction, T-R8 Hijri dates, T-R7 locale.
 */
import { describe, test, expect } from 'vitest';
import { parseFrontMatter, frontMatterDirection } from '../../src/renderer/markdown/frontmatter.js';
import { gregorianYMD, hijriParts, dailyNoteName } from '../../src/renderer/dates.js';
import { t, localeDirection, MESSAGES } from '../../src/renderer/locale.js';

describe('front matter (T-R6)', () => {
  test('parses keys + strips fences', () => {
    const { data, body } = parseFrontMatter('---\ndirection: rtl\ntitle: "Hi"\n---\n# Body\n');
    expect(data).toEqual({ direction: 'rtl', title: 'Hi' });
    expect(body).toBe('# Body\n');
  });
  test('no front matter → empty data, body unchanged', () => {
    expect(parseFrontMatter('# Just text').data).toEqual({});
  });
  test('frontMatterDirection validates', () => {
    expect(frontMatterDirection({ direction: 'RTL' })).toBe('rtl');
    expect(frontMatterDirection({ direction: 'ltr' })).toBe('ltr');
    expect(frontMatterDirection({ direction: 'sideways' })).toBeNull();
    expect(frontMatterDirection({})).toBeNull();
  });
  test('an indented nested direction key is never promoted to document direction', () => {
    const parsed = parseFrontMatter('---\nplugin:\n  direction: rtl\ntitle: Note\n---\nBody');
    expect(frontMatterDirection(parsed.data)).toBeNull();
    expect(parsed.data.title).toBe('Note');
    expect(parsed.data.direction).toBeUndefined();
  });
});

describe('dates (T-R8)', () => {
  const d = new Date(Date.UTC(2026, 5, 1, 12)); // 2026-06-01
  test('gregorian YMD + daily note name', () => {
    expect(gregorianYMD(d)).toBe('2026-06-01');
    expect(dailyNoteName(d, 'gregorian')).toBe('2026-06-01.md');
  });
  test('hijri parts are plausible Umm al-Qura values', () => {
    const h = hijriParts(d);
    expect(h.year).toBeGreaterThan(1440);
    expect(h.year).toBeLessThan(1460);
    expect(h.month).toBeGreaterThanOrEqual(1);
    expect(h.month).toBeLessThanOrEqual(12);
    expect(h.day).toBeGreaterThanOrEqual(1);
    expect(h.day).toBeLessThanOrEqual(30);
  });
  test('hijri daily-note name shape', () => {
    expect(dailyNoteName(d, 'hijri')).toMatch(/^\d{3,4}-\d{2}-\d{2}\.md$/);
  });
});

describe('locale (T-R7)', () => {
  test('translates + falls back', () => {
    expect(t('menu.file', 'ar')).toBe('ملف');
    expect(t('menu.file', 'en')).toBe('File');
    expect(t('unknown.key', 'ar')).toBe('unknown.key');
  });
  test('ar and en catalogs have the same keys', () => {
    expect(Object.keys(MESSAGES.ar).sort()).toEqual(Object.keys(MESSAGES.en).sort());
  });
  test('localeDirection', () => {
    expect(localeDirection('ar')).toBe('rtl');
    expect(localeDirection('en')).toBe('ltr');
  });
});
