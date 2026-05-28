/**
 * Unit tests for theme cycling and persistence logic
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { THEMES, getNextTheme, clampZoom } from '../../src/renderer/theme.js';

let mockStorage = {};
const localStorage = {
  getItem: (k) => mockStorage[k] || null,
  setItem: (k, v) => { mockStorage[k] = v; }
};

let currentTheme = 'paper';
const documentElement = {
  getAttribute: (attr) => attr === 'data-theme' ? currentTheme : null,
  setAttribute: (attr, val) => { if (attr === 'data-theme') currentTheme = val; }
};

function cycleTheme() {
  const current = documentElement.getAttribute('data-theme') || 'paper';
  const next = getNextTheme(current);
  documentElement.setAttribute('data-theme', next);
  localStorage.setItem('marqam-theme', next);
  return next;
}

function foucPreventionLogic(storedTheme) {
  const VALID_THEMES = ['paper', 'ink', 'sepia'];
  if (storedTheme && VALID_THEMES.includes(storedTheme)) {
    return storedTheme;
  }
  return 'paper';
}

describe('cycleTheme', () => {
  beforeEach(() => {
    mockStorage = {};
    currentTheme = 'paper';
  });

  test('paper -> ink', () => {
    const next = cycleTheme();
    expect(next).toBe('ink');
    expect(documentElement.getAttribute('data-theme')).toBe('ink');
    expect(localStorage.getItem('marqam-theme')).toBe('ink');
  });

  test('ink -> sepia', () => {
    currentTheme = 'ink';
    const next = cycleTheme();
    expect(next).toBe('sepia');
    expect(localStorage.getItem('marqam-theme')).toBe('sepia');
  });

  test('sepia -> paper (wraps)', () => {
    currentTheme = 'sepia';
    const next = cycleTheme();
    expect(next).toBe('paper');
  });
});

describe('getNextTheme pure logic', () => {
  test('cycles through all 3 themes', () => {
    expect(getNextTheme('paper')).toBe('ink');
    expect(getNextTheme('ink')).toBe('sepia');
    expect(getNextTheme('sepia')).toBe('paper');
  });

  test('handles unknown theme by falling back via indexOf', () => {
    expect(getNextTheme('unknown')).toBe('paper');
  });
});

describe('FOUC prevention', () => {
  test('valid stored theme applied', () => {
    expect(foucPreventionLogic('ink')).toBe('ink');
    expect(foucPreventionLogic('sepia')).toBe('sepia');
  });

  test('null falls back to paper', () => {
    expect(foucPreventionLogic(null)).toBe('paper');
  });

  test('invalid theme falls back to paper', () => {
    expect(foucPreventionLogic('invalid')).toBe('paper');
    expect(foucPreventionLogic('')).toBe('paper');
  });
});

describe('theme constants', () => {
  test('exact 3 themes in correct order', () => {
    expect(THEMES).toEqual(['paper', 'ink', 'sepia']);
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
