/**
 * arabic-typography.test.js — T-R3 Arabic typography helpers.
 * (The T-R5 numerals helpers were deleted with the dormant `numerals` setting — UX-08.)
 */
import { describe, test, expect } from 'vitest';
import { hasTashkeel, arabicLineHeight } from '../../src/renderer/i18n.js';

describe('tashkeel (T-R3)', () => {
  test('detects diacritics', () => {
    expect(hasTashkeel('مَرْحَبًا')).toBe(true); // with harakat
    expect(hasTashkeel('مرحبا')).toBe(false);    // plain
  });
  test('line-height bumps to 2.0 with tashkeel, 1.8 without', () => {
    expect(arabicLineHeight('مَرْحَبًا')).toBe(2.0);
    expect(arabicLineHeight('مرحبا')).toBe(1.8);
  });
});
