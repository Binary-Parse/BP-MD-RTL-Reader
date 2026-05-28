/**
 * Unit tests for isArabicHeavy()
 * Mutation-testable: exercises every branch of the actual implementation.
 */

import { describe, test, expect } from 'vitest';
import { isArabicHeavy } from '../../src/renderer/i18n.js';

describe('isArabicHeavy()', () => {
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
    expect(isArabicHeavy('مرحبا hello')).toBe(true);
  });

  test('returns false for mixed text below threshold', () => {
    expect(isArabicHeavy('Hello world in مرحبا')).toBe(false);
  });

  test('respects custom threshold', () => {
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

  test('returns false when threshold is 0 and no letters exist', () => {
    expect(isArabicHeavy('12345', 0)).toBe(false);
  });

  test('respects 500-char sample limit', () => {
    const long = 'مرحبا '.repeat(200); // 1200+ chars
    expect(isArabicHeavy(long, 1.0)).toBe(true);
  });

  test('returns false for whitespace-only string', () => {
    expect(isArabicHeavy('   \n\t  ')).toBe(false);
  });
});
