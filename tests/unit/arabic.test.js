// @ts-check
/**
 * Unit tests for isArabicHeavy()
 * Uses the Unicode Script property approach: /\p{Script=Arabic}/u
 * No legacy block-range escapes allowed.
 */

// Inline implementation matching marqam.html exactly
const ARABIC_RE = /\p{Script=Arabic}/u;
function isArabicHeavy(text, threshold = 0.5) {
  if (!text) return false;
  const sample = text.slice(0, 500);
  let letters = 0, arabic = 0;
  for (const ch of sample) {
    if (/\p{L}/u.test(ch)) { letters++; if (ARABIC_RE.test(ch)) arabic++; }
  }
  return letters > 0 && arabic / letters >= threshold;
}

const { test, expect } = require('@playwright/test');

test.describe('isArabicHeavy()', () => {
  test('returns true for Arabic-heavy text', () => {
    expect(isArabicHeavy('مرحبا بالعالم')).toBe(true);
  });

  test('returns false for English text', () => {
    expect(isArabicHeavy('Hello world')).toBe(false);
  });

  test('returns false for empty string', () => {
    expect(isArabicHeavy('')).toBe(false);
  });

  test('returns false for null/undefined', () => {
    expect(isArabicHeavy(null)).toBe(false);
    expect(isArabicHeavy(undefined)).toBe(false);
  });

  test('returns true for mostly Arabic with some Latin', () => {
    // 6 Arabic letters, 2 Latin: 75% Arabic >= 50% threshold
    expect(isArabicHeavy('مرحبا hello')).toBe(true);
  });

  test('returns false for mixed text below threshold', () => {
    // Mostly English with a few Arabic chars
    expect(isArabicHeavy('Hello world in مرحبا')).toBe(false);
  });

  test('respects custom threshold', () => {
    // 'مرحبا hello' — 6 Arabic / 11 total = 0.545
    expect(isArabicHeavy('مرحبا hello', 0.9)).toBe(false);
    expect(isArabicHeavy('مرحبا hello', 0.4)).toBe(true);
  });

  test('handles text with only numbers and punctuation', () => {
    expect(isArabicHeavy('12345 !@#')).toBe(false);
  });

  test('handles pure Arabic prose', () => {
    const prose = 'الصفحةُ ليست شاشةً، والقارئُ لا يُمرِّر النصَّ بل يقلِبُه.';
    expect(isArabicHeavy(prose)).toBe(true);
  });
});
