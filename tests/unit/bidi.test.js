/**
 * bidi.test.js — T-R1/R2 + slug. Pure direction + isolation logic.
 */
import { describe, test, expect } from 'vitest';
import { resolveDirection, needsIsolation, isolate, directionAttrs, slugify, resolveDocDirection } from '../../src/renderer/bidi.js';

describe('resolveDirection (T-R1)', () => {
  test('Arabic first-strong → rtl', () => {
    expect(resolveDirection('مرحبا world')).toBe('rtl');
  });
  test('Latin first-strong → ltr', () => {
    expect(resolveDirection('hello مرحبا')).toBe('ltr');
  });
  test('Hebrew → rtl', () => {
    expect(resolveDirection('שלום')).toBe('rtl');
  });
  test('neutral-only line inherits context (EC-C1)', () => {
    expect(resolveDirection('123 — !!', 'rtl')).toBe('rtl');
    expect(resolveDirection('123 — !!', 'ltr')).toBe('ltr');
  });
  test('leading numbers then Arabic → rtl (first strong is Arabic)', () => {
    expect(resolveDirection('42 درجة')).toBe('rtl');
  });
  test('empty/non-string → inherited', () => {
    expect(resolveDirection('', 'rtl')).toBe('rtl');
    expect(resolveDirection(null, 'ltr')).toBe('ltr');
  });
});

describe('needsIsolation / isolate (T-R2)', () => {
  test('LTR run inside RTL context needs isolation', () => {
    expect(needsIsolation('main.js', 'rtl')).toBe(true);
    expect(needsIsolation('مرحبا', 'rtl')).toBe(false);
  });
  test('isolate wraps in <bdi> and escapes via injected fn', () => {
    expect(isolate('a<b', (s) => s.replace('<', '&lt;'))).toBe('<bdi>a&lt;b</bdi>');
  });
});

describe('directionAttrs', () => {
  test('returns dir + data-dir', () => {
    expect(directionAttrs('مرحبا')).toEqual({ dir: 'rtl', 'data-dir': 'rtl' });
  });
});

describe('resolveDocDirection (T-R6 precedence: manual > front-matter > auto)', () => {
  test('manual override wins over everything', () => {
    expect(resolveDocDirection({ manual: 'rtl', frontMatter: 'ltr', content: 'ltr' })).toBe('rtl');
    expect(resolveDocDirection({ manual: 'ltr', frontMatter: 'rtl', content: 'rtl' })).toBe('ltr');
  });
  test('front-matter direction wins over content auto', () => {
    expect(resolveDocDirection({ manual: null, frontMatter: 'rtl', content: 'ltr' })).toBe('rtl');
    expect(resolveDocDirection({ manual: null, frontMatter: 'ltr', content: 'rtl' })).toBe('ltr');
  });
  test('falls back to content auto-direction when no overrides', () => {
    expect(resolveDocDirection({ content: 'rtl' })).toBe('rtl');
    expect(resolveDocDirection({ content: 'ltr' })).toBe('ltr');
  });
  test('defaults to ltr; ignores invalid override/front-matter values', () => {
    expect(resolveDocDirection({})).toBe('ltr');
    expect(resolveDocDirection()).toBe('ltr');
    expect(resolveDocDirection({ manual: 'sideways', frontMatter: 'nope', content: 'rtl' })).toBe('rtl');
  });
});

describe('slugify (EC-C5)', () => {
  test('Latin', () => expect(slugify('Hello World!')).toBe('hello-world'));
  test('Arabic preserved', () => expect(slugify('في فعل القراءة')).toBe('في-فعل-القراءة'));
  test('trims dashes', () => expect(slugify('  — a — b — ')).toBe('a-b'));
});
