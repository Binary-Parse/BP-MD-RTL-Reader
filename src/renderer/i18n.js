/**
 * i18n.js — Internationalization & text utilities
 * Pure functions: no DOM, no side effects.
 */

export function isArabicHeavy(text, threshold = 0.5) {
  if (!text) return false;
  const sample = text.slice(0, 500);
  let letters = 0, arabic = 0;
  const ARABIC_RE = /\p{Script=Arabic}/u;
  for (const ch of sample) {
    if (/\p{L}/u.test(ch)) { letters++; if (ARABIC_RE.test(ch)) arabic++; }
  }
  return letters > 0 && arabic / letters >= threshold;
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escape regex metacharacters so a user-supplied string matches literally.
 *
 * String() first, matching escapeHtml above: the find box guards only `if (!query)`, so a
 * non-string, non-empty query reaches here and must coerce rather than throw.
 */
export function escapeReg(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
