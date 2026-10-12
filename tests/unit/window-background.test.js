import { describe, test, expect } from 'vitest';
import { windowBackground, BACKGROUNDS } from '../../src/main/window-background.js';

describe('windowBackground', () => {
  test.each([
    ['paper', '#E4E6E9'],
    ['ink', '#08090B'],
    ['sepia', '#D8CBB5'],
    ['oasis', '#031211'],
  ])('%s theme paints %s before first paint', (theme, expected) => {
    expect(windowBackground(theme, false, false)).toBe(expected);
    expect(windowBackground(theme, false, true)).toBe(expected);
  });

  test('following the system picks ink in a dark OS and paper in a light OS', () => {
    expect(windowBackground('paper', true, true)).toBe('#08090B');
    expect(windowBackground('paper', true, false)).toBe('#E4E6E9');
  });

  test('following the system ignores a stored theme', () => {
    expect(windowBackground('sepia', true, false)).toBe('#E4E6E9');
    expect(windowBackground('oasis', true, true)).toBe('#08090B');
  });

  test('an unknown or missing theme falls back to paper', () => {
    expect(windowBackground('neon', false, false)).toBe('#E4E6E9');
    expect(windowBackground(undefined, false, true)).toBe('#E4E6E9');
    expect(windowBackground(null, false, false)).toBe('#E4E6E9');
  });

  test('the table is frozen and lists exactly the four themes', () => {
    expect(Object.keys(BACKGROUNDS)).toEqual(['paper', 'ink', 'sepia', 'oasis']);
    expect(Object.isFrozen(BACKGROUNDS)).toBe(true);
  });
});
