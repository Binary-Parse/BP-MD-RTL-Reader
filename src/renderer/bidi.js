/**
 * bidi.js — pure bidirectional-text service (T-R1/R2). No DOM.
 * The home of the RTL moat: per-block direction resolution and inline isolation
 * so mixed Arabic/English renders correctly in every block (beats whole-doc flip).
 */

// Strong RTL scripts (Arabic family + Hebrew + others).
const RTL_SCRIPT = /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}]/u;
const ANY_LETTER = /\p{L}/u;

/**
 * Resolve a block's direction from its first strong character (Unicode UBA P2/P3).
 * Neutral-only text (digits/punctuation/image) inherits the surrounding direction
 * instead of defaulting to LTR (EC-C1).
 * @param {string} text
 * @param {'ltr'|'rtl'} inherited  direction for neutral-only text
 * @returns {'ltr'|'rtl'}
 */
export function resolveDirection(text, inherited = 'ltr') {
  if (typeof text !== 'string' || text === '') return inherited;
  for (const ch of text) {
    if (RTL_SCRIPT.test(ch)) return 'rtl';
    if (ANY_LETTER.test(ch)) return 'ltr';
  }
  return inherited;
}

/** True when a run's direction differs from its context (needs isolation). */
export function needsIsolation(run, contextDir) {
  return resolveDirection(run, contextDir) !== contextDir;
}

/**
 * Wrap an inline run in a bidi isolate so neutral/opposite-direction content
 * (inline code, links, numbers, tags) cannot reorder surrounding text (EC-B/Obsidian bug set).
 * `escape` is injected to keep this module DOM/encoding agnostic.
 */
export function isolate(text, escape = (s) => s) {
  return `<bdi>${escape(text)}</bdi>`;
}

/** Produce the attributes a block should carry for correct direction. */
export function directionAttrs(text, inherited = 'ltr') {
  const dir = resolveDirection(text, inherited);
  return { dir, 'data-dir': dir };
}

/** URL-safe slug for headings, Arabic-aware (EC-C5): keep letters/numbers, dash the rest. */
export function slugify(text) {
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}
