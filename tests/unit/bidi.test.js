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
  // audit H4 (owner decision 2026-10-10): an RTL first strong character makes the block RTL,
  // whatever share of Latin terms follows. Was: 'ltr' once the Latin letters were the majority.
  test('English-majority block that opens with Arabic → rtl (first strong wins, H4)', () => {
    expect(resolveBlockDirection('مرحبا this is mostly an english sentence')).toBe('rtl');
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
  test('near-balanced block inherits on an exact tie; a strict majority still flips', () => {
    // audit UX-01: an exact tie now inherits the base direction (default ltr here), instead
    // of first-strong picking whichever script happened to open the block.
    expect(resolveBlockDirection('مرab')).toBe('rtl'); // 50/50, Arabic first → rtl (H4; was inherited ltr)
    expect(resolveBlockDirection('abمر')).toBe('ltr'); // 50/50, Latin first → inherited ltr
    expect(resolveBlockDirection('abمر', 'rtl')).toBe('rtl'); // …and inherits rtl when rtl is the base
    expect(resolveBlockDirection('مرab', 'ltr')).toBe('rtl'); // Arabic first wins even over an ltr base (H4)
    // English-first table content (7 Latin vs 8 Arabic = 53% RTL) is a STRICT RTL majority → rtl.
    expect(resolveBlockDirection('Name قيمة one واحد')).toBe('rtl');
  });
  test('empty / non-string → inherited', () => {
    expect(resolveBlockDirection('', 'rtl')).toBe('rtl');
    expect(resolveBlockDirection(null, 'ltr')).toBe('ltr');
    expect(resolveBlockDirection(undefined, 'rtl')).toBe('rtl');
  });
  test('the strict-majority boundary is exclusive (pins > vs >=)', () => {
    // English-first, RTL share 0.6 (3 Arabic / 5 strong) → strict majority → flips to rtl.
    expect(resolveBlockDirection('abمرح')).toBe('rtl');
    // English-first, RTL share 0.5 → exactly a tie → inherits ltr.
    expect(resolveBlockDirection('abcمرح')).toBe('ltr');
    // Arabic-first blocks are rtl whatever the Latin share (H4: first strong wins; the strict
    // majority override applies only to Latin-first blocks). Was: 0.6 Latin share → ltr, tie → ltr.
    expect(resolveBlockDirection('مرabc')).toBe('rtl');
    expect(resolveBlockDirection('مرحabc')).toBe('rtl');
  });
});

// audit UX-01: the regression table for the strict-majority rule — URL stripping, the
// 50–60% dead band the old 0.6 threshold left behind, and ties inheriting the base.
describe('resolveBlockDirection — audit UX-01 regression table', () => {
  test('a ~53%-Arabic paragraph that opens in Arabic stays rtl', () => {
    // 46 Arabic vs 41 Latin letters — a strict Arabic majority, but only just.
    const text = 'المستخدمون البرمجة التطبيقات مكتبة الوثائق جديد نظام documentation framework testing quality notes';
    expect(resolveBlockDirection(text, 'rtl')).toBe('rtl');
  });

  test('the same paragraph with one English word prepended (exact 50/50 tie) stays rtl when rtl is the base', () => {
    // The old 0.6 threshold left a 50–60% dead band: one prepended English word flipped a
    // genuinely Arabic paragraph to LTR. An exact tie now inherits the base direction.
    const text = 'Notes المستخدمون البرمجة التطبيقات مكتبة الوثائق جديد نظام documentation framework testing quality notes';
    expect(resolveBlockDirection(text, 'rtl')).toBe('rtl');
    expect(resolveBlockDirection(text, 'ltr')).toBe('ltr'); // tie still follows the base
  });

  test('a URL is stripped before counting, so an Arabic sentence containing one stays rtl', () => {
    const text = 'راجع https://docs.example.com/en-us/azure/devops/pipelines/processes للمزيد من التفاصيل';
    expect(resolveBlockDirection(text, 'rtl')).toBe('rtl');
  });

  test('an LTR-first heading that is ~80% Arabic flips to rtl', () => {
    expect(resolveBlockDirection('API دليل المستخدم')).toBe('rtl');
  });

  test('an English paragraph with one Arabic word stays ltr', () => {
    expect(resolveBlockDirection('hello world peace سلام again')).toBe('ltr');
  });

  test('neutral-only text inherits the base direction', () => {
    expect(resolveBlockDirection('1234 !!!', 'rtl')).toBe('rtl');
    expect(resolveBlockDirection('1234 !!!', 'ltr')).toBe('ltr');
  });

  test('an exact tie with inherited ltr → ltr', () => {
    expect(resolveBlockDirection('abمر', 'ltr')).toBe('ltr');
  });
});

// audit H4 (owner decision 2026-10-10): the first strong character decides. An Arabic heading that
// carries Latin product names used to resolve LTR because the Latin letters outnumbered the Arabic.
describe('resolveBlockDirection — first strong RTL character wins (audit H4)', () => {
  test.each([
    ['تثبيت Docker على Windows', 'rtl'],
    ['كيف تستخدم TypeScript مع React', 'rtl'],
    ['استخدام Git و GitHub', 'rtl'],
    ['API دليل المستخدم', 'rtl'],
    ['Install Docker on Windows', 'ltr'],
    ['Docker is كبير', 'ltr'],
    ['שלום Docker Compose Kubernetes', 'rtl'],
    ['مرحبا Hello world this is long English text', 'rtl'],
    ['  	«مرحبا» English English English', 'rtl'],
  ])('%s → %s', (text, expected) => {
    expect(resolveBlockDirection(text)).toBe(expected);
    expect(resolveBlockDirection(text, 'ltr')).toBe(expected);
    expect(resolveBlockDirection(text, 'rtl')).toBe(expected);
  });

  test('digits and punctuation before the first Arabic letter do not count as strong', () => {
    expect(resolveBlockDirection('2024: تثبيت Docker و Kubernetes على Windows', 'ltr')).toBe('rtl');
  });

  test('a Latin-first block stays ltr when its Arabic share is a minority or a tie', () => {
    expect(resolveBlockDirection('Docker is كبير', 'rtl')).toBe('ltr'); // 4 Arabic vs 8 Latin: not a majority, base is irrelevant
    expect(resolveBlockDirection('abcمرح', 'ltr')).toBe('ltr'); // 3 vs 3 tie → base
    expect(resolveBlockDirection('abcمرح', 'rtl')).toBe('rtl'); // tie → base rtl
  });

  test('a Latin-first block that is mostly Arabic is still rtl (the remaining majority override)', () => {
    expect(resolveBlockDirection('Docker دليل المستخدم الكامل', 'ltr')).toBe('rtl');
  });

  test('a block that is only a URL/email (no counted letters) is neutral and inherits the base', () => {
    // the Arabic local part is stripped with the rest of the address, so nothing is left to vote
    expect(resolveBlockDirection('مرحبا@example.com', 'ltr')).toBe('ltr');
    expect(resolveBlockDirection('مرحبا@example.com', 'rtl')).toBe('rtl');
    expect(resolveBlockDirection('https://example.com/a', 'rtl')).toBe('rtl');
  });

  test('a URL is not the first strong character of an otherwise Arabic block', () => {
    expect(resolveBlockDirection('https://example.com/docs راجع الوثائق الكاملة', 'ltr')).toBe('rtl');
  });
});

describe('needsIsolation / isolate (T-R2)', () => {
  test('LTR run inside RTL context needs isolation', () => {
    expect(needsIsolation('src/main/index.js', 'rtl')).toBe(true);
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
  // audit UX-14c: tashkeel/tatweel fold away BEFORE the run-collapse, so a vocalized
  // heading slugs identically to its bare form.
  test('folds tashkeel and tatweel', () => {
    expect(slugify('كِتَاب')).toBe(slugify('كتاب'));
    expect(slugify('كِتَاب')).toBe('كتاب');
    expect(slugify('مُحَمَّد بن عبد الله')).toBe('محمد-بن-عبد-الله');
    expect(slugify('كــتاب')).toBe('كتاب'); // U+0640 tatweel
  });
});

// RTL-M7 (2026-09-26): the URL strip covers scheme-less forms — a bare domain or an
// email address in a short Arabic sentence used to flip the whole paragraph LTR.
describe('resolveBlockDirection scheme-less URL stripping (RTL-M7)', () => {
  test('a bare domain mention does not flip an Arabic sentence to LTR', () => {
    const text = 'راجع docs.example.com/en-us/azure/devops/pipelines/processes/page للمزيد';
    expect(resolveBlockDirection(text, 'ltr')).toBe('rtl');
  });
  test('an email address does not flip a short Arabic sentence to LTR', () => {
    const text = 'راسلنا support@example-company.com الآن';
    expect(resolveBlockDirection(text, 'ltr')).toBe('rtl');
  });
  test('a scheme’d URL still strips (regression)', () => {
    const text = 'راجع https://docs.example.com/en-us/azure للمزيد من التفاصيل';
    expect(resolveBlockDirection(text, 'ltr')).toBe('rtl');
  });
});
