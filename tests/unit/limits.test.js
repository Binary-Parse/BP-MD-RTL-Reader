import { describe, expect, test } from 'vitest';
import { MAX_PREVIEW_CHARS, isEscaped, previewChunks, utf8ByteLength } from '../../src/renderer/limits.js';
import { findMath } from '../../src/renderer/editor/math-preview.js';

describe('renderer transform limits', () => {
  test('counts one-, two-, three-, and four-byte UTF-8 code points', () => {
    expect(utf8ByteLength('A¢€😀')).toBe(10);
    expect(utf8ByteLength(123)).toBe(3);
  });

  test('recognizes odd slash runs and rejects even or absent slash runs', () => {
    expect(isEscaped('\\*', 1)).toBe(true);
    expect(isEscaped('\\\\*', 2)).toBe(false);
    expect(isEscaped('*', 0)).toBe(false);
  });

  // QA H5: the editor's regex previews scan bounded pieces; a hostile long line is left raw.
  test('previewChunks keeps whole short lines, drops a too-long line, and caps a run', () => {
    const map = (t) => previewChunks(t).map((c) => [c.offset, c.text]);
    expect(map('a\nb')).toEqual([[0, 'a\nb']]);
    const long = 'x'.repeat(MAX_PREVIEW_CHARS + 1);
    expect(map('ab\n' + long + '\ncd')).toEqual([[0, 'ab'], [long.length + 4, 'cd']]);
    const third = 'y'.repeat(Math.floor(MAX_PREVIEW_CHARS * 0.6));
    const text = [third, third, third].join('\n');
    const chunks = previewChunks(text);
    expect(chunks.length).toBe(3);
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(MAX_PREVIEW_CHARS);
      expect(text.slice(c.offset, c.offset + c.text.length)).toBe(c.text);
    }
    expect(previewChunks('')).toEqual([]);
  });

  test('a hostile 80 KB line costs the math preview nothing', () => {
    const t0 = Date.now();
    expect(findMath('$$x '.repeat(20000))).toEqual([]);
    expect(Date.now() - t0).toBeLessThan(50);
    expect(findMath('a $x$ b')).toHaveLength(1);
  });
});
