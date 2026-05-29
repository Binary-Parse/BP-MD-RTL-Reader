/**
 * Unit tests for i18n.js — isArabicHeavy() + escapeHtml() + escapeReg().
 *
 * Focus (audit #10): the two surviving mutants on i18n.js:14
 *   return letters > 0 && arabic / letters >= threshold;
 *
 *   M1) "letters > 0"  ->  "true"   (drop the guard)
 *   M2) ">="           ->  ">"      (strict comparison at the boundary)
 *
 * See the dedicated describe block below for the kill / equivalence proof.
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

  test('handles pure Arabic prose', () => {
    const prose = 'الصفحةُ ليست شاشةً، والقارئُ لا يُمرِّر النصَّ بل يقلِبُه.';
    expect(isArabicHeavy(prose)).toBe(true);
  });

  test('respects 500-char sample limit', () => {
    const long = 'مرحبا '.repeat(200); // 1200+ chars
    expect(isArabicHeavy(long, 1.0)).toBe(true);
  });

  // ─ Mutation killer for L8: .slice(0, 500) ───────────────────────────
  // Original: scans first 500 chars only → 500 Arabic / 500 = 100% → true
  // Mutant (slice removed): scans all 1500 chars → 500/1500 = 33% → false
  test('mutation killer: only first 500 chars are sampled (slice(0,500) intact)', () => {
    const arabicHead = 'م'.repeat(500);
    const latinTail = 'a'.repeat(1000);
    expect(isArabicHeavy(arabicHead + latinTail)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Audit #10 — survivors on i18n.js:14
//   return letters > 0 && arabic / letters >= threshold;
// ─────────────────────────────────────────────────────────────────────
describe('isArabicHeavy() L14 — audit #10 mutants (zero-letters + boundary)', () => {
  // ── ZERO-LETTERS inputs (required by the task) ──────────────────────
  // No Unicode letters → `letters` stays 0 → must return false, no throw.
  // These cover the early-`!text` guard AND the letters===0 path on L14.
  test.each([
    ['empty string', ''],
    ['null', null],
    ['undefined', undefined],
    ['digits only', '1234567890'],
    ['punctuation only', '!@#$%^&*()_+-=[]{};:,.<>/?'],
    ['whitespace only', '   \n\t\r  '],
    ['digits + punctuation + whitespace', '12 + 34 = 46 !!! ?? ...'],
    ['emoji only (no letters)', '😀🎉👍🌍'],
    ['arabic-indic digits + punctuation (no letters)', '١٢٣٤٥ ،؛؟'],
  ])('returns false (no throw) for %s', (_label, input) => {
    let result;
    expect(() => { result = isArabicHeavy(input); }).not.toThrow();
    expect(result).toBe(false);
  });

  // A zero-letters string must stay false even with a threshold of 0,
  // which is the harshest setting for the `>= threshold` comparison.
  test('zero-letters input stays false even at threshold 0', () => {
    expect(isArabicHeavy('12345', 0)).toBe(false);
    expect(isArabicHeavy('   ', 0)).toBe(false);
  });

  // ── M1: "letters > 0" -> "true"  — PROVABLY EQUIVALENT ──────────────
  // PROOF (audit rule R9, equivalence): `arabic` is only ever incremented
  // inside the same `if (/\p{L}/u.test(ch))` block that increments
  // `letters`, so the invariant 0 <= arabic <= letters always holds.
  // When the guard `letters > 0` is false we necessarily have letters===0,
  // and therefore arabic===0 too. The mutant replaces the guard with the
  // literal `true`, so it evaluates the RHS instead of short-circuiting:
  //     true && (0 / 0 >= threshold)
  //   = true && (NaN >= threshold)
  //   = true && false                      // NaN >= x is false ∀ x ∈ ℝ
  //   = false
  // Both original (false && …) and mutant (true && false) yield `false`
  // for EVERY zero-letters input and EVERY threshold. No distinguishing
  // witness can exist, so M1 is a genuine equivalent mutant — the
  // zero-letters cases above pin the only observable behaviour (false).
  test('M1 equivalence witness: letters===0 yields false for any threshold', () => {
    for (const t of [-1, 0, 0.5, 1, 2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(isArabicHeavy('123 !!!', t)).toBe(false);
    }
  });

  // ── M2: ">=" -> ">"  — KILLED at the exact boundary ─────────────────
  // One Arabic letter + one Latin letter → ratio = 1/2 = 0.5, exactly the
  // default threshold. Original `0.5 >= 0.5` → true; mutant `0.5 > 0.5`
  // → false. This assertion fails under the mutant, killing it.
  test('M2 killer: ratio exactly equal to default threshold returns true', () => {
    expect(isArabicHeavy('مa')).toBe(true);
  });

  // Same kill at a custom threshold to lock the boundary independently of
  // the default value: 2 Arabic of 4 letters = 0.5 === threshold.
  test('M2 killer: ratio exactly equal to a custom threshold returns true', () => {
    expect(isArabicHeavy('ممab', 0.5)).toBe(true);
    // And strictly below the threshold must still be false (guards the
    // direction of the comparison rather than just the boundary).
    expect(isArabicHeavy('مabc', 0.5)).toBe(false); // 1/4 = 0.25 < 0.5
  });
});

describe('escapeHtml() — mutation killers', () => {
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

describe('escapeReg() — regex metachar escaping', () => {
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
