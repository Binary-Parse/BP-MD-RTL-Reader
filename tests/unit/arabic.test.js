/**
 * Unit tests for isArabicHeavy() + escapeHtml() + escapeReg()
 * Mutation-testable: exercises every branch of the actual implementation.
 */

import { describe, test, expect } from 'vitest';
import { isArabicHeavy, escapeHtml, escapeReg } from '../../src/renderer/i18n.js';

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

  // ─ Mutation-killer for L8: .slice(0, 500) (audit #13) ────────────────
  // Original: scans first 500 chars only → 500 Arabic / 500 = 100% Arabic → true
  // Mutant `.slice` removed: scans all 1500 chars → 500/1500 = 33% < 0.5 → false
  test('mutation killer: only first 500 chars are sampled (slice(0,500) intact)', () => {
    const arabicHead = 'م'.repeat(500);
    const latinTail = 'a'.repeat(1000);
    expect(isArabicHeavy(arabicHead + latinTail)).toBe(true);
  });
});

describe('escapeHtml() — mutation killers (audit #13)', () => {
  // Mutant L19: '&amp;' → "" — & chars would be deleted instead of escaped
  test('preserves & as &amp;', () => {
    expect(escapeHtml('&')).toBe('&amp;');
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  // Mutant L20: '&lt;' → "" — < chars would be deleted
  test('preserves < as &lt;', () => {
    expect(escapeHtml('<')).toBe('&lt;');
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
  });

  // Mutant L21: '&gt;' → "" — > chars would be deleted
  test('preserves > as &gt;', () => {
    expect(escapeHtml('>')).toBe('&gt;');
  });

  // Mutant L22: '&quot;' → "" — " chars would be deleted
  test('preserves " as &quot;', () => {
    expect(escapeHtml('"')).toBe('&quot;');
    expect(escapeHtml('say "hi"')).toBe('say &quot;hi&quot;');
  });

  test('all four entities in one pass, escape order matters', () => {
    // & must be escaped FIRST so its &amp; doesn't get re-escaped
    expect(escapeHtml('<a href="x">&y</a>'))
      .toBe('&lt;a href=&quot;x&quot;&gt;&amp;y&lt;/a&gt;');
  });

  test('coerces non-string input via String()', () => {
    expect(escapeHtml(123)).toBe('123');
    expect(escapeHtml(null)).toBe('null');
    expect(escapeHtml(undefined)).toBe('undefined');
  });
});

describe('escapeReg() — regex metachar escaping (kills NoCoverage on L26)', () => {
  test('escapes all 14 regex metacharacters', () => {
    expect(escapeReg('.')).toBe('\\.');
    expect(escapeReg('*')).toBe('\\*');
    expect(escapeReg('+')).toBe('\\+');
    expect(escapeReg('?')).toBe('\\?');
    expect(escapeReg('^')).toBe('\\^');
    expect(escapeReg('$')).toBe('\\$');
    expect(escapeReg('{')).toBe('\\{');
    expect(escapeReg('}')).toBe('\\}');
    expect(escapeReg('(')).toBe('\\(');
    expect(escapeReg(')')).toBe('\\)');
    expect(escapeReg('|')).toBe('\\|');
    expect(escapeReg('[')).toBe('\\[');
    expect(escapeReg(']')).toBe('\\]');
    expect(escapeReg('\\')).toBe('\\\\');
  });

  test('leaves non-metacharacters alone', () => {
    expect(escapeReg('hello world')).toBe('hello world');
    expect(escapeReg('مرحبا')).toBe('مرحبا');
  });

  test('produces a string usable in new RegExp()', () => {
    const dangerous = 'a.b+c*d';
    const re = new RegExp(escapeReg(dangerous));
    expect(re.test('a.b+c*d')).toBe(true);   // literal match
    expect(re.test('aXbYcZd')).toBe(false);  // not treated as metas
  });
});
