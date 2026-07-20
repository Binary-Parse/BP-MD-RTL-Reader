import { describe, expect, test } from 'vitest';
import { isEscaped, utf8ByteLength } from '../../src/renderer/limits.js';

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
});
