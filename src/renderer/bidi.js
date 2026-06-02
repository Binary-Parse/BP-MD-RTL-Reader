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

/**
 * Resolve a document's base direction by precedence (T-R6): a manual ⇄ override
 * wins, then a front-matter `direction:` declaration, then the content's auto
 * (first-strong) direction. Invalid override/front-matter values are ignored.
 * @param {{manual?:string|null, frontMatter?:string|null, content?:'ltr'|'rtl'}} opts
 * @returns {'ltr'|'rtl'}
 */
export function resolveDocDirection({ manual = null, frontMatter = null, content = 'ltr' } = {}) {
  if (manual === 'rtl' || manual === 'ltr') return manual;
  if (frontMatter === 'rtl' || frontMatter === 'ltr') return frontMatter;
  return content === 'rtl' ? 'rtl' : 'ltr';
}

/** Produce the attributes a block should carry for correct direction. */
export function directionAttrs(text, inherited = 'ltr') {
  const dir = resolveDirection(text, inherited);
  return { dir, 'data-dir': dir };
}

// Combining marks (Latin + Arabic tashkeel) — caret must not split a base+mark.
const COMBINING = /[̀-ًͯ-ٰٟۖ-ۭ]/;

/**
 * Logical caret step (EC-C2/C3): move one grapheme in `delta` direction, skipping
 * combining marks so the caret lands on cluster boundaries (e.g. base+harakat).
 * @param {string} text
 * @param {number} pos
 * @param {number} delta  -1 or +1
 * @returns {number} clamped new position
 */
export function stepCaret(text, pos, delta) {
  const dir = delta >= 0 ? 1 : -1;
  let p = pos + dir;
  while (p > 0 && p < text.length && COMBINING.test(text[p])) p += dir;
  return Math.max(0, Math.min(text.length, p));
}

/** URL-safe slug for headings, Arabic-aware (EC-C5): keep letters/numbers, dash the rest. */
export function slugify(text) {
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Logical horizontal cell index for arrow-key table traversal (T-R9 / EC-C2).
 * In an RTL table the physical arrows are swapped so ArrowLeft advances in reading
 * order. Clamped to [0, len-1]; never wraps. Non-arrow keys return the index as-is.
 */
export function nextCellIndex(i, len, key, dir = 'ltr') {
  const fwd = dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
  const back = dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
  if (key === fwd) return Math.min(len - 1, i + 1);
  if (key === back) return Math.max(0, i - 1);
  return i;
}
