/**
 * code-track.test.js — the pure "which code block is current" picker behind the
 * floating copy button (reading view). Mirrors the outline.js activeHeading rule:
 * the last block whose top has reached the viewport midline; -1 above the first.
 */
import { describe, expect, test } from 'vitest';
import { activeCodeBlock } from '../../src/renderer/markdown/code-track.js';

// A tall-ish viewport so the midline math is easy to reason about: scrollTop 0 → mid 250.
const VH = 500;

describe('activeCodeBlock', () => {
  test('returns -1 for an empty or non-array list', () => {
    expect(activeCodeBlock([], 0, VH)).toBe(-1);
    expect(activeCodeBlock(undefined, 0, VH)).toBe(-1);
  });

  test('returns -1 for a non-finite or non-positive viewport', () => {
    expect(activeCodeBlock([{ top: 0 }], 0, 0)).toBe(-1);
    expect(activeCodeBlock([{ top: 0 }], 0, NaN)).toBe(-1);
  });

  test('scrolled above the first block → -1 (button hidden, nothing to copy)', () => {
    const blocks = [{ top: 400 }, { top: 1200 }];
    expect(activeCodeBlock(blocks, 0, VH)).toBe(-1);
  });

  test('the first block becomes current once its top passes the midline', () => {
    const blocks = [{ top: 400 }, { top: 1200 }];
    // scrollTop 150 → mid 650 ≥ 400 → block 0; block 1 not reached.
    expect(activeCodeBlock(blocks, 150, VH)).toBe(0);
  });

  test('between two blocks the UPPER one stays current (boundary is the midline)', () => {
    const blocks = [{ top: 0 }, { top: 1000 }];
    // mid 250 < 1000 → still block 0.
    expect(activeCodeBlock(blocks, 0, VH)).toBe(0);
    // mid 450 < 1000 → still block 0.
    expect(activeCodeBlock(blocks, 200, VH)).toBe(0);
    // mid 750 < 1000 → STILL block 0 (the next block owns the midline only past 750).
    expect(activeCodeBlock(blocks, 500, VH)).toBe(0);
    // mid 1000 ≥ 1000 → block 1.
    expect(activeCodeBlock(blocks, 750, VH)).toBe(1);
  });

  test('scrolled past the last block sticks to the last block', () => {
    const blocks = [{ top: 0 }, { top: 900 }, { top: 1800 }];
    expect(activeCodeBlock(blocks, 5000, VH)).toBe(2);
  });

  test('a single block resolves to 0 once reached, -1 before', () => {
    const blocks = [{ top: 300 }];
    expect(activeCodeBlock(blocks, 0, VH)).toBe(-1);
    expect(activeCodeBlock(blocks, 50, VH)).toBe(0);
  });

  test('direction-agnostic: the same scroll position yields the same block scrolling up or down', () => {
    const blocks = [{ top: 100 }, { top: 800 }, { top: 1500 }];
    for (const scrollTop of [0, 200, 600, 1000, 1400, 3000]) {
      const down = activeCodeBlock(blocks, scrollTop, VH);
      const up = activeCodeBlock(blocks, scrollTop, VH); // same input, same rule
      expect(up).toBe(down);
    }
  });

  test('skips malformed entries instead of derailing the scan', () => {
    const blocks = [{ top: 100 }, {}, { top: NaN }, { top: 1200 }];
    // mid 500: block 0 reached; 1200 not.
    expect(activeCodeBlock(blocks, 0, VH)).toBe(0);
    // mid 1450: 1200 reached → last valid index wins even after malformed entries.
    expect(activeCodeBlock(blocks, 1200, VH)).toBe(3);
  });
});
