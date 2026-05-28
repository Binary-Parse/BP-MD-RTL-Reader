/**
 * theme.js — Theme & zoom logic
 * Pure functions: no DOM, no side effects.
 */

export const THEMES = ['paper', 'ink', 'sepia'];

export function getNextTheme(currentTheme) {
  const i = THEMES.indexOf(currentTheme);
  return THEMES[(i + 1) % THEMES.length];
}

export function clampZoom(factor) {
  return Math.min(2.0, Math.max(0.6, factor));
}
