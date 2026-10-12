/**
 * text-normalize.test.js — audit UX-03 Arabic search normalization.
 *
 * Tashkeel/tatweel stripping, hamza/ta-marbuta/alif-maqsura folding, and the index map
 * that lets a match in normalized space map back to the ORIGINAL text (so snippets and
 * highlights show the note exactly as written).
 */
import { describe, test, expect } from 'vitest';
import {
  HAS_ARABIC, NEEDS_FOLD, normalizeArabic, normalizeArabicWithMap, mapEnd, arabicFindMatches,
} from '../../src/renderer/components/text-normalize.js';

describe('HAS_ARABIC', () => {
  test('detects Arabic-block characters and ignores everything else', () => {
    expect(HAS_ARABIC.test('محمد')).toBe(true);
    expect(HAS_ARABIC.test('hello world')).toBe(false);
    expect(HAS_ARABIC.test('1234 !!!')).toBe(false);
  });
});

describe('normalizeArabic', () => {
  test('strips tashkeel (مُحَمَّد → محمد)', () => {
    expect(normalizeArabic('مُحَمَّد')).toBe('محمد');
  });

  test('folds hamza forms so إسلام matches اسلام, and أمل matches امل', () => {
    expect(normalizeArabic('إسلام')).toBe(normalizeArabic('اسلام'));
    expect(normalizeArabic('أمل')).toBe(normalizeArabic('امل'));
    expect(normalizeArabic('آثار')).toBe(normalizeArabic('اثار'));
    expect(normalizeArabic('ٱ')).toBe(normalizeArabic('ا'));
  });

  test('folds ta-marbuta to ha (كلمة → كلمه)', () => {
    expect(normalizeArabic('كلمة')).toBe('كلمه');
  });

  test('folds alif-maqsura to ya (مصطفى → مصطفي)', () => {
    expect(normalizeArabic('مصطفى')).toBe(normalizeArabic('مصطفي'));
  });

  test('strips tatweel (kashida) as well as tashkeel', () => {
    expect(normalizeArabic('كــتاب')).toBe('كتاب');
  });

  test('non-string / empty input returns the falsy value rather than throwing', () => {
    expect(normalizeArabic('')).toBe('');
    expect(normalizeArabic(null)).toBe('');
    expect(normalizeArabic(undefined)).toBe('');
  });
});

describe('normalizeArabicWithMap', () => {
  test('maps each kept character back to its index in the original string', () => {
    const s = 'كِتَاب';
    const m = normalizeArabicWithMap(s);
    expect(m.norm).toBe('كتاب');
    expect(m.map).toHaveLength(4);
    // The second kept character is 'ت'; its original index must be computed, not guessed.
    expect(m.map[1]).toBe(s.indexOf('ت'));
    expect(s[m.map[2]]).toBe('ا');
    expect(s[m.map[3]]).toBe('ب');
  });

  test('a folded character that expands keeps an entry per output char', () => {
    // Every FOLD target here is a single char, so map.length always equals norm.length.
    const m = normalizeArabicWithMap('إسلامٌ');
    expect(m.map).toHaveLength(m.norm.length);
    expect(m.norm).toBe('اسلام');
  });

  test('empty / non-string input yields an empty norm + map', () => {
    expect(normalizeArabicWithMap('')).toEqual({ norm: '', map: [] });
    expect(normalizeArabicWithMap(null)).toEqual({ norm: '', map: [] });
  });
});

describe('mapEnd', () => {
  test('a range ending at the last kept letter includes a trailing diacritic', () => {
    const s = 'محمدٌ';
    const m = normalizeArabicWithMap(s);
    expect(m.norm).toBe('محمد');
    const end = mapEnd(s, m, 4); // exclusive end in norm space, just past 'د'
    expect(end).toBe(s.length);
    expect(s.slice(0, end)).toBe('محمدٌ');
  });

  test('the trailing diacritic is included even when more text follows', () => {
    const s = 'محمدٌ كتاب';
    const m = normalizeArabicWithMap(s);
    const end = mapEnd(s, m, 4);
    expect(s.slice(0, end)).toBe('محمدٌ');
    expect(end).toBeLessThan(s.length);
  });

  test('an end index past the last kept char clamps to the string length', () => {
    const s = 'كتاب';
    const m = normalizeArabicWithMap(s);
    expect(mapEnd(s, m, m.map.length + 3)).toBe(s.length);
  });
});

// RTL-M3 (2026-09-26): Edit-mode Arabic find shares the Reading pane's fold, with
// match offsets mapped back to the vocalized source.
describe('arabicFindMatches (RTL-M3)', () => {
  test('an unvocalized query matches vocalized text at source offsets', () => {
    const text = 'بداية مُحَمَّد النهاية';
    const m = arabicFindMatches(text, 'محمد');
    expect(m).toHaveLength(1);
    expect(text.slice(m[0].start, m[0].end)).toBe('مُحَمَّد');
  });
  test('hamza folding matches and multiple hits map back correctly', () => {
    const text = 'إسلام كتاب إسلام';
    const m = arabicFindMatches(text, 'اسلام');
    expect(m).toHaveLength(2);
    expect(text.slice(m[0].start, m[0].end)).toBe('إسلام');
    expect(text.slice(m[1].start, m[1].end)).toBe('إسلام');
  });
  test('a non-Arabic query or pure-diacritics query is not this path', () => {
    expect(arabicFindMatches('abc', 'abc')).toBeNull();
    expect(arabicFindMatches('نص', 'ًّ')).toEqual([]);
  });
});

describe('Persian and Urdu letters, and the three digit sets (audit M26)', () => {
  test('kaf, ya and ha typed on a Persian or Urdu keyboard fold to the Arabic letters', () => {
    expect(normalizeArabic('\u06A9\u062A\u0627\u0628')).toBe('\u0643\u062A\u0627\u0628'); // کتاب → كتاب
    expect(normalizeArabic('\u0639\u0644\u06CC')).toBe('\u0639\u0644\u064A');               // علی → علي
    expect(normalizeArabic('\u06D2')).toBe('\u064A');                                           // ے → ي
    expect(normalizeArabic('\u06D5\u06C0')).toBe('\u0647\u0647');                             // ە ۀ → ه ه
  });

  test('a query in either spelling finds the other, at the positions of the source', () => {
    const persian = 'x \u06A9\u062A\u0627\u0628 \u0639\u0644\u06CC'; // "x کتاب علی"
    expect(arabicFindMatches(persian, '\u0643\u062A\u0627\u0628')).toEqual([{ start: 2, end: 6 }]);
    expect(arabicFindMatches(persian, '\u0639\u0644\u064A')).toEqual([{ start: 7, end: 10 }]);
    const arabic = '\u0643\u062A\u0627\u0628'; // "كتاب"
    expect(arabicFindMatches(arabic, '\u06A9\u062A\u0627\u0628')).toEqual([{ start: 0, end: 4 }]);
  });

  test('Arabic-Indic and Persian digits fold to 0-9', () => {
    expect(normalizeArabic('\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669')).toBe('0123456789');
    expect(normalizeArabic('\u06F0\u06F1\u06F2\u06F3\u06F4\u06F5\u06F6\u06F7\u06F8\u06F9')).toBe('0123456789');
  });

  test('a number is found whichever digit set the query and the text use', () => {
    const text = 'year \u0662\u0660\u0662\u0664, \u06F2\u06F0\u06F2\u06F4 and 2024'; // ٢٠٢٤, ۲۰۲۴, 2024
    const hits = [{ start: 5, end: 9 }, { start: 11, end: 15 }, { start: 20, end: 24 }];
    expect(arabicFindMatches(text, '2024')).toEqual(hits);
    expect(arabicFindMatches(text, '\u0662\u0660\u0662\u0664')).toEqual(hits);
    expect(arabicFindMatches(text, '\u06F2\u06F0\u06F2\u06F4')).toEqual(hits);
  });

  test('the fold is one character to one character, so the index map keeps its length', () => {
    const s = '\u06A9\u06CC\u0662\u06F4';
    const m = normalizeArabicWithMap(s);
    expect(m.norm).toBe('\u0643\u064A24');
    expect(m.map).toEqual([0, 1, 2, 3]);
  });

  test('NEEDS_FOLD is true for Arabic and for digits, false for plain Latin text', () => {
    expect(NEEDS_FOLD.test('2024')).toBe(true);
    expect(NEEDS_FOLD.test('\u0645\u062D\u0645\u062F')).toBe(true);
    expect(NEEDS_FOLD.test('hello world')).toBe(false);
    expect(arabicFindMatches('hello world', 'world')).toBeNull();
  });

  test('a digit query in Latin text finds what the plain search found, case folded as before', () => {
    expect(arabicFindMatches('Version V2 and v2', 'v2')).toEqual([{ start: 8, end: 10 }, { start: 15, end: 17 }]);
  });
});
