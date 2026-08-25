/**
 * arabic-typography.test.js — T-R3/R5 Arabic typography & numerals helpers.
 */
import { describe, test, expect } from 'vitest';
import { hasTashkeel, arabicLineHeight, toArabicIndic, toWesternDigits, applyNumerals } from '../../src/renderer/i18n.js';

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

describe('numerals (T-R5)', () => {
  test('western → arabic-indic and back', () => {
    expect(toArabicIndic('2026')).toBe('٢٠٢٦');
    expect(toWesternDigits('٢٠٢٦')).toBe('2026');
  });
  test('applyNumerals dispatch', () => {
    expect(applyNumerals('12', 'arabic-indic')).toBe('١٢');
    expect(applyNumerals('١٢', 'western')).toBe('12');
    expect(applyNumerals('12', 'unknown')).toBe('12');
  });
  test('mixed text only converts digits', () => {
    expect(toArabicIndic('page 3 of 10')).toBe('page ٣ of ١٠');
  });
});
