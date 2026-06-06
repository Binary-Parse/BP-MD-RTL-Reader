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

/**
 * Resolve a BLOCK's direction by DOMINANT strong-script, not strict first-strong.
 *
 * First-strong (resolveDirection / HTML dir="auto") is documented to mis-detect a block
 * whose first strong character runs opposite to its dominant script — e.g. an Arabic
 * heading that opens with an English word or number ("API دليل المستخدم") resolves to LTR
 * and renders left-aligned, English-first. Headings/titles hit this constantly (W3C i18n,
 * UAX #9 P2/P3 — first-strong's known failure mode). For a block, whose direction we want
 * to MATCH its visible majority, we count strong characters per direction and pick the
 * majority instead: neutral-only text inherits the base dir (EC-C1), and an exact tie
 * breaks toward the inherited base. Inline isolation (needsIsolation) still uses the pure
 * first-strong resolveDirection — an inline run's own direction IS its first strong char.
 *
 * @param {string} text
 * @param {'ltr'|'rtl'} inherited  base direction for neutral-only text / ties
 * @returns {'ltr'|'rtl'}
 */
// A block flips away from its first-strong direction only when the OTHER script is at
// least this share of the strong letters — a CLEAR majority. Tuned so an Arabic-dominant
// heading that merely opens with an English word/number flips to RTL, while a near-balanced
// block (e.g. an English-first table with a couple of Arabic words) keeps first-strong.
const BLOCK_DOMINANCE = 0.6;

export function resolveBlockDirection(text, inherited = 'ltr') {
  if (typeof text !== 'string' || text === '') return inherited;
  let rtl = 0;
  let ltr = 0;
  for (const ch of text) {
    // RTL scripts are also letters, so test RTL first and use else-if to avoid double count.
    if (RTL_SCRIPT.test(ch)) rtl++;
    else if (ANY_LETTER.test(ch)) ltr++;
  }
  const total = rtl + ltr;
  if (total === 0) return inherited; // neutral-only → inherit (EC-C1)
  // Standards default: first strong character (HTML dir="auto" / UAX #9 P2/P3).
  const firstStrong = resolveDirection(text, inherited);
  // …overridden only when the opposite script clearly dominates (the documented first-strong
  // failure: an RTL paragraph/heading that begins with a strong LTR character).
  if (firstStrong === 'ltr' && rtl / total >= BLOCK_DOMINANCE) return 'rtl';
  if (firstStrong === 'rtl' && ltr / total >= BLOCK_DOMINANCE) return 'ltr';
  return firstStrong;
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
