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

// ── Arabic typography helpers (T-R3/R5) ─────────────────────────────────────

/** True if the text contains Arabic diacritics (tashkeel) — needs taller leading. */
export function hasTashkeel(text) {
  return typeof text === 'string' && /[\u064B-\u065F\u0670\u0640]/.test(text);
}

/** Recommended line-height for an Arabic block (T-R3): looser when tashkeel present. */
export function arabicLineHeight(text) {
  return hasTashkeel(text) ? 2.0 : 1.8;
}
