/**
 * text-normalize.test.js — audit UX-03 Arabic search normalization.
 *
 * Tashkeel/tatweel stripping, hamza/ta-marbuta/alif-maqsura folding, and the index map
 * that lets a match in normalized space map back to the ORIGINAL text (so snippets and
 * highlights show the note exactly as written).
 */
import { describe, test, expect } from 'vitest';
import {
  HAS_ARABIC, normalizeArabic, normalizeArabicWithMap, mapEnd, arabicFindMatches,
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
