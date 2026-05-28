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
    .replace(/"/g, '&quot;');
}

export function escapeReg(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
