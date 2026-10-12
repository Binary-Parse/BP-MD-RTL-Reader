import { describe, test, expect } from 'vitest';
import {
  wordCount, readMinutes, fileDirKind, outlineNumbers, crumbSegments, fileMeta, shelfRatio,
} from '../../src/renderer/components/doc-meta.js';

describe('fileMeta', () => {
  test('reports words, minutes and direction for a loaded file', () => {
    const file = { content: `${'word '.repeat(440)}`, forcedDir: null };
    const meta = fileMeta(file);
    expect(meta.words).toBe(440);
    expect(meta.minutes).toBe(2);
    expect(meta.dir).toBe('ltr');
  });

  test('an Arabic file is rtl and a forced direction wins', () => {
    expect(fileMeta({ content: 'مرحبا بالعالم' }).dir).toBe('rtl');
    expect(fileMeta({ content: 'مرحبا بالعالم', forcedDir: 'ltr' }).dir).toBe('ltr');
  });

  test('is cached while the content and the forced direction are unchanged', () => {
    const file = { content: 'alpha beta', forcedDir: null };
    const first = fileMeta(file);
    expect(fileMeta(file)).toBe(first);
    expect(file._meta).toBe(first);
  });

  test('recomputes when the content changes', () => {
    const file = { content: 'alpha beta', forcedDir: null };
    const first = fileMeta(file);
    file.content = 'alpha beta gamma';
    const second = fileMeta(file);
    expect(second).not.toBe(first);
    expect(second.words).toBe(3);
  });

  test('recomputes when the forced direction changes', () => {
    const file = { content: 'Hello world', forcedDir: null };
    expect(fileMeta(file).dir).toBe('ltr');
    file.forcedDir = 'rtl';
    expect(fileMeta(file).dir).toBe('rtl');
  });

  test('treats a file whose content is not loaded yet as empty', () => {
    expect(fileMeta({ content: undefined }).words).toBe(0);
    expect(fileMeta({}).minutes).toBe(1);
  });
});

describe('shelfRatio', () => {
  const entries = [{ key: 'a', ratio: 0.42 }, { key: 'b', ratio: 1 }];

  test('finds the stored ratio by file key', () => {
    expect(shelfRatio(entries, 'a')).toBe(0.42);
    expect(shelfRatio(entries, 'b')).toBe(1);
  });

  test('is zero for an unknown key, a missing shelf or a bad ratio', () => {
    expect(shelfRatio(entries, 'zzz')).toBe(0);
    expect(shelfRatio(undefined, 'a')).toBe(0);
    expect(shelfRatio([{ key: 'a', ratio: 'x' }], 'a')).toBe(0);
    expect(shelfRatio([{ key: 'a', ratio: -1 }], 'a')).toBe(0);
    expect(shelfRatio([{ key: 'a', ratio: 7 }], 'a')).toBe(1);
  });
});

describe('wordCount', () => {
  test('counts whitespace separated tokens', () => {
    expect(wordCount('one two  three\nfour')).toBe(4);
  });

  test('is zero for empty, blank and missing input', () => {
    expect(wordCount('')).toBe(0);
    expect(wordCount('   \n\t ')).toBe(0);
    expect(wordCount(null)).toBe(0);
    expect(wordCount(undefined)).toBe(0);
  });

  test('ignores front matter', () => {
    expect(wordCount('---\ntitle: Hello there\n---\nalpha beta')).toBe(2);
  });

  test('ignores front matter behind a BOM', () => {
    expect(wordCount('﻿---\ntitle: x\n---\nalpha beta gamma')).toBe(3);
  });

  test('counts Arabic words', () => {
    expect(wordCount('مرحبا بالعالم الجميل')).toBe(3);
  });
});

describe('readMinutes', () => {
  test.each([
    [0, 1],
    [1, 1],
    [110, 1],
    [219, 1],
    [330, 2],
    [440, 2],
    [660, 3],
    [1100, 5],
  ])('%i words read in %i min', (words, minutes) => {
    expect(readMinutes(words)).toBe(minutes);
  });
});

describe('fileDirKind', () => {
  test('a forced direction wins over everything', () => {
    expect(fileDirKind('Hello', 'rtl')).toBe('rtl');
    expect(fileDirKind('مرحبا', 'ltr')).toBe('ltr');
    expect(fileDirKind('---\ndirection: rtl\n---\nHello', 'ltr')).toBe('ltr');
  });

  test('front matter beats the natural direction', () => {
    expect(fileDirKind('---\ndirection: rtl\n---\nHello world')).toBe('rtl');
    expect(fileDirKind('---\ndirection: ltr\n---\nمرحبا بالعالم')).toBe('ltr');
  });

  test('plain English is ltr and plain Arabic is rtl', () => {
    expect(fileDirKind('Hello world\n\nSecond paragraph')).toBe('ltr');
    expect(fileDirKind('مرحبا بالعالم\n\nفقرة ثانية')).toBe('rtl');
  });

  test('two blocks of each direction make the file mixed', () => {
    expect(fileDirKind('Hello\n\nWorld\n\nمرحبا\n\nعالم')).toBe('mixed');
  });

  test('a single stray block of the other direction does not make it mixed', () => {
    expect(fileDirKind('Hello\n\nWorld\n\nمرحبا')).toBe('ltr');
    expect(fileDirKind('مرحبا\n\nعالم\n\nHello')).toBe('rtl');
  });

  test('fenced code and neutral blocks do not vote', () => {
    expect(fileDirKind('```\nمرحبا\nعالم\n```\n\nHello\n\n12345')).toBe('ltr');
  });

  test('empty input is ltr', () => {
    expect(fileDirKind('')).toBe('ltr');
    expect(fileDirKind(null)).toBe('ltr');
  });
});

describe('outlineNumbers', () => {
  test('numbers nested levels', () => {
    expect(outlineNumbers([1, 2, 2, 3, 1])).toEqual(['1', '1.1', '1.2', '1.2.1', '2']);
  });

  test('numbers from the shallowest level present', () => {
    expect(outlineNumbers([2, 3, 3, 2])).toEqual(['1', '1.1', '1.2', '2']);
  });

  test('a skipped level does not print a zero', () => {
    expect(outlineNumbers([1, 3])).toEqual(['1', '1.1']);
  });

  test('a single deep heading is 1 and no headings is empty', () => {
    expect(outlineNumbers([3])).toEqual(['1']);
    expect(outlineNumbers([])).toEqual([]);
  });
});

describe('crumbSegments', () => {
  test('joins root, folders and file name', () => {
    expect(crumbSegments('Notes', 'essays/reading.md')).toEqual(['Notes', 'essays', 'reading.md']);
    expect(crumbSegments('Notes', 'a.md')).toEqual(['Notes', 'a.md']);
  });

  test('normalises Windows separators', () => {
    expect(crumbSegments('Research', 'dir\\sub\\x.md')).toEqual(['Research', 'dir', 'sub', 'x.md']);
  });

  test('omits a missing root and tolerates empty input', () => {
    expect(crumbSegments(null, 'b.md')).toEqual(['b.md']);
    expect(crumbSegments('', 'b.md')).toEqual(['b.md']);
    expect(crumbSegments('Notes', '')).toEqual(['Notes']);
    expect(crumbSegments('', '')).toEqual([]);
  });
});

describe('fileDirKind block voting', () => {
  test('separate fenced blocks stay out of the vote and unfenced text after them still votes', () => {
    expect(fileDirKind('```\nمرحبا\n```\n\n```\nعالم\n```\n\nHello')).toBe('ltr');
  });

  test('a whitespace-only line separates blocks', () => {
    expect(fileDirKind('مرحبا\n \nعالم\n \nHello\n \nWorld')).toBe('mixed');
  });

  test('blocks with no letters never vote', () => {
    expect(fileDirKind('مرحبا\n\n123\n\n456\n\n789')).toBe('rtl');
  });
});
