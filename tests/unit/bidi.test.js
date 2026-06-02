/**
 * bidi.test.js — T-R1/R2 + slug. Pure direction + isolation logic.
 */
import { describe, test, expect } from 'vitest';
import { resolveDirection, needsIsolation, isolate, directionAttrs, slugify, resolveDocDirection, nextCellIndex } from '../../src/renderer/bidi.js';

describe('nextCellIndex (T-R9 / EC-C2 logical horizontal cell traversal)', () => {
  test('LTR: ArrowRight advances, ArrowLeft retreats', () => {
    expect(nextCellIndex(0, 3, 'ArrowRight', 'ltr')).toBe(1);
    expect(nextCellIndex(1, 3, 'ArrowLeft', 'ltr')).toBe(0);
  });
  test('RTL: arrows swap so reading-order advance is ArrowLeft', () => {
    expect(nextCellIndex(0, 3, 'ArrowLeft', 'rtl')).toBe(1);
    expect(nextCellIndex(1, 3, 'ArrowRight', 'rtl')).toBe(0);
  });
  test('clamps at both ends, never wraps', () => {
    expect(nextCellIndex(2, 3, 'ArrowRight', 'ltr')).toBe(2);
    expect(nextCellIndex(0, 3, 'ArrowLeft', 'ltr')).toBe(0);
    expect(nextCellIndex(2, 3, 'ArrowLeft', 'rtl')).toBe(2);
    expect(nextCellIndex(0, 3, 'ArrowRight', 'rtl')).toBe(0);
  });
  test('non-arrow keys leave the index unchanged; dir defaults to ltr', () => {
    expect(nextCellIndex(1, 3, 'Enter', 'ltr')).toBe(1);
    expect(nextCellIndex(1, 3, 'Enter', 'rtl')).toBe(1);
    expect(nextCellIndex(0, 3, 'ArrowRight')).toBe(1); // omitted dir → ltr
  });
});

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
