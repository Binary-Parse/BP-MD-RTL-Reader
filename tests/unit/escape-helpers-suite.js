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
  });
}
