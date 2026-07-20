/**
 * bidi.test.js — T-R1/R2 + slug. Pure direction + isolation logic.
 */
import { describe, test, expect } from 'vitest';
import { resolveDirection, resolveBlockDirection, needsIsolation, isolate, directionAttrs, slugify, resolveDocDirection, nextCellIndex } from '../../src/renderer/bidi.js';

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
  test('Arabic-script digits and combining marks are neutral, not strong RTL', () => {
    expect(resolveDirection('١٢٣', 'ltr')).toBe('ltr');
    expect(resolveDirection('َُِ', 'ltr')).toBe('ltr');
    expect(resolveDirection('١٢٣ فارسی', 'ltr')).toBe('rtl');
  });
  test('additional Unicode RTL scripts are recognized', () => {
    expect(resolveDirection('𞤀𞤣𞤤𞤢𞤥')).toBe('rtl'); // Adlam
  });
  test('empty/non-string → inherited', () => {
    expect(resolveDirection('', 'rtl')).toBe('rtl');
    expect(resolveDirection(null, 'ltr')).toBe('ltr');
  });
});

describe('resolveBlockDirection (T-R1 dominant-script — fixes mixed Arabic/English headers)', () => {
  test('Arabic-majority block that OPENS with English → rtl (first-strong got this wrong)', () => {
    expect(resolveBlockDirection('API دليل المستخدم')).toBe('rtl');
    expect(resolveBlockDirection('Hello مرحبا مرحبا مرحبا')).toBe('rtl');
    expect(resolveBlockDirection('2024 إصدار جديد من البرنامج')).toBe('rtl');
  });
  test('English-majority block that opens with Arabic → ltr', () => {
    expect(resolveBlockDirection('مرحبا this is mostly an english sentence')).toBe('ltr');
  });
  test('pure Arabic → rtl; pure English → ltr', () => {
    expect(resolveBlockDirection('مرحبا بالعالم')).toBe('rtl');
    expect(resolveBlockDirection('hello world')).toBe('ltr');
  });
  test('Hebrew counts as RTL script (majority Hebrew → rtl)', () => {
    expect(resolveBlockDirection('שלום עולם יקר world')).toBe('rtl'); // 11 Hebrew letters > 5 Latin
  });
  test('neutral-only text inherits base (EC-C1) and falls back to ltr by default', () => {
    expect(resolveBlockDirection('123 — !! :)', 'rtl')).toBe('rtl');
    expect(resolveBlockDirection('123 — !! :)', 'ltr')).toBe('ltr');
    expect(resolveBlockDirection('123 — !! :)')).toBe('ltr');
  });
  test('near-balanced block keeps first-strong (no flip below the clear-majority threshold)', () => {
    expect(resolveBlockDirection('مرab')).toBe('rtl'); // 50/50, starts Arabic → first-strong rtl
    expect(resolveBlockDirection('abمر')).toBe('ltr'); // 50/50, starts Latin → first-strong ltr
    // English-first table content (7 Latin vs 8 Arabic = 53% RTL, below 60%) keeps ltr.
    expect(resolveBlockDirection('Name قيمة one واحد')).toBe('ltr');
  });
  test('empty / non-string → inherited', () => {
    expect(resolveBlockDirection('', 'rtl')).toBe('rtl');
    expect(resolveBlockDirection(null, 'ltr')).toBe('ltr');
    expect(resolveBlockDirection(undefined, 'rtl')).toBe('rtl');
  });
  test('the 0.6 clear-majority boundary is inclusive (pins >= vs >)', () => {
    // English-first, RTL share EXACTLY 0.6 (3 Arabic / 5 strong) → flips to rtl.
    expect(resolveBlockDirection('abمرح')).toBe('rtl');
    // English-first, RTL share 0.5 (< 0.6) → keeps first-strong ltr.
    expect(resolveBlockDirection('abcمرح')).toBe('ltr');
    // Symmetric: Arabic-first, LTR share exactly 0.6 → flips to ltr; 0.5 stays rtl.
    expect(resolveBlockDirection('مرabc')).toBe('ltr');
    expect(resolveBlockDirection('مرحabc')).toBe('rtl');
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
