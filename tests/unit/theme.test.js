/**
 * Unit tests for the theme list, theme cycling and zoom clamping (theme.js)
 */

import { describe, test, expect } from 'vitest';
import { THEMES, getNextTheme, clampZoom } from '../../src/renderer/theme.js';

describe('getNextTheme pure logic', () => {
  test('cycles through all 4 themes', () => {
    expect(getNextTheme('paper')).toBe('ink');
    expect(getNextTheme('ink')).toBe('sepia');
    expect(getNextTheme('sepia')).toBe('oasis');
    expect(getNextTheme('oasis')).toBe('paper');
  });

  test('handles unknown theme by falling back via indexOf', () => {
    expect(getNextTheme('unknown')).toBe('paper');
  });
});

describe('theme constants', () => {
  test('exact 4 themes in correct order', () => {
    expect(THEMES).toEqual(['paper', 'ink', 'sepia', 'oasis']);
  });
});

describe('clampZoom', () => {
  test('clamps to bounds', () => {
    expect(clampZoom(0.1)).toBe(0.6);
    expect(clampZoom(5.0)).toBe(2.0);
    expect(clampZoom(1.0)).toBe(1.0);
    expect(clampZoom(1.5)).toBe(1.5);
  });

  test('boundary values', () => {
    expect(clampZoom(0.6)).toBe(0.6);
    expect(clampZoom(2.0)).toBe(2.0);
  });
});
