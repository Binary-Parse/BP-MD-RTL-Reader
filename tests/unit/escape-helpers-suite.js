/**
 * Shared describe blocks for escapeHtml() + escapeReg() from i18n.js.
 *
 * arabic.test.js and i18n.test.js both exercised these two pure helpers with
 * byte-identical suites; the assertions are factored out here so the two
 * callers register the exact same coverage / mutation-killers without copying.
 * Every expect() below is preserved verbatim — no assertion is weakened.
 */

import { describe, test, expect } from 'vitest';
import { escapeHtml, escapeReg } from '../../src/renderer/i18n.js';

/** Registers the escapeHtml() mutation-killer describe block. */
export function describeEscapeHtml() {
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
}

/** Registers the escapeReg() regex-metachar-escaping describe block. */
export function describeEscapeReg() {
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

    // The find box feeds its query straight into new RegExp() at
    // app.js:911,930 and codemirror-adapter.js:176. Static analysis flags those
    // as possible ReDoS because the pattern is not a literal. It cannot be:
    // escapeReg strips every construct backtracking needs — quantifiers,
    // alternation, and grouping — so the result is always a literal matcher.
    // These assertions are what makes that safe rather than merely likely.
    test('classic ReDoS payloads survive only as literal text', () => {
      const payloads = ['(a+)+$', '(a|a)*$', '(a*)*b', '(x+x+)+y', '((ab)*)*c'];
      for (const payload of payloads) {
        const re = new RegExp(escapeReg(payload));
        // The payload matches itself and nothing it would have matched as a pattern.
        expect(re.test(payload), payload).toBe(true);
        expect(re.test('aaaaaaaaaaaaaaaaaaaaaaaa'), payload).toBe(false);
      }
    });

    test('an escaped pattern cannot backtrack on a long adversarial input', () => {
      // Unescaped, /(a+)+$/ against this input is exponential. Escaped, it is
      // a literal scan, so it must return promptly.
      const re = new RegExp(escapeReg('(a+)+$'));
      const input = `${'a'.repeat(40)}!`;
      const started = performance.now();
      expect(re.test(input)).toBe(false);
      expect(performance.now() - started).toBeLessThan(1000);
    });

    // codemirror-adapter.js kept a private copy of escapeReg that differed from this one by
    // a String() coercion. Its find() guards only `if (!query)`, so a non-string, non-empty
    // query -- find(5) -- reached escapeReg and returned [] there while throwing TypeError
    // here. This assertion is what lets the duplicate be deleted without changing behaviour
    // at that call site, so it must keep holding for the shared copy.
    test('coerces non-string input via String() instead of throwing', () => {
      expect(escapeReg(5)).toBe('5');
      expect(escapeReg(1.5)).toBe(escapeReg('1.5')); // the dot is escaped, not literal
      expect(escapeReg(null)).toBe('null');
      expect(escapeReg(undefined)).toBe('undefined');
      expect(new RegExp(escapeReg(1.5)).test('1.5')).toBe(true);
      expect(new RegExp(escapeReg(1.5)).test('1X5')).toBe(false);
    });

    test('escaping is idempotent-safe: no metacharacter survives unescaped', () => {
      const metas = '.*+?^${}()|[]\\';
      const escaped = escapeReg(metas);
      // Every metacharacter is preceded by a backslash, so none can act.
      for (const char of metas) {
        expect(escaped.includes(`\\${char}`), char).toBe(true);
      }
      expect(new RegExp(escaped).test(metas)).toBe(true);
    });
  });
}
