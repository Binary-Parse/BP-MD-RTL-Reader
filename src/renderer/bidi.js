/**
 * bidi.js — pure bidirectional-text service (T-R1/R2). No DOM.
 * The home of the RTL moat: per-block direction resolution and inline isolation
 * so mixed Arabic/English renders correctly in every block (beats whole-doc flip).
 */

// Strong RTL scripts represented in Unicode's Script property. Checking the
// Letter category separately excludes Arabic-family digits and combining marks.
const RTL_SCRIPT = /(?:\p{Script=Arabic}|\p{Script=Hebrew}|\p{Script=Syriac}|\p{Script=Thaana}|\p{Script=Nko}|\p{Script=Samaritan}|\p{Script=Mandaic}|\p{Script=Adlam}|\p{Script=Hanifi_Rohingya})/u;
const ANY_LETTER = /\p{L}/u;

function isRtlLetter(ch) {
  return ANY_LETTER.test(ch) && RTL_SCRIPT.test(ch);
}

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
    if (isRtlLetter(ch)) return 'rtl';
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
 * and renders left-aligned, English-first (W3C i18n, UAX #9 P2/P3 — first-strong's known
 * failure mode). A block flips away from its first-strong direction only when the OTHER
 * script is a STRICT MAJORITY of the strong letters, counted after URLs/URIs are stripped;
 * an exact tie and neutral-only text inherit the base direction. Inline isolation
 * (needsIsolation) still uses the pure first-strong resolveDirection — an inline run's own
 * direction IS its first strong char.
 *
 * @param {string} text
 * @param {'ltr'|'rtl'} inherited  base direction for neutral-only text / ties
 * @returns {'ltr'|'rtl'}
 */
// A block flips away from its first-strong direction only when the OTHER script is a
// STRICT majority of the strong letters (audit UX-01): the previous 0.6 threshold left
// a dead band (50–60%) where prepending one English word flipped an Arabic paragraph
// to LTR. URLs/URIs are stripped before counting — their path letters are identifiers,
// not English prose, and used to force genuinely Arabic sentences to LTR. RTL-M7: the
// strip covers SCHEME-LESS forms too — bare domains (docs.example.com/en-us/…) and
// email addresses — whose Latin path/local letters are just as much identifiers as a
// scheme'd URL's, and used to flip short Arabic sentences to LTR all the same.
const BLOCK_DOMINANCE = 0.5;
// RTL-M5/M7: URLs/emails/bare domains are identifiers, not prose — stripped before the
// script count. Matching is TOKEN-wise with anchored prefix tests: the previous single
// global alternation (`\S+@`, `[a-z…]*:\/\/\S+`, `[\w-]+\.`) backtracks quadratically on
// long whitespace-free runs — a ~10MB single-line note froze the renderer for minutes
// (the ADV-drag-size-exactly-10mb hang). Tokens longer than MAX_STRIP_TOKEN are kept
// as-is: a whitespace-free run that long is code/blob, whose letters legitimately count
// as prose for dominance.
const MAX_STRIP_TOKEN = 512;
const SCHEME_PREFIX = /^[a-z][a-z0-9+.-]*:\/\//i;
const EMAIL_PREFIX = /^[^\s@]{1,64}@[\w-]+(?:\.[\w-]+)+/;
const DOMAIN_PREFIX = /^(?:[\w-]+\.)+[\w-]{2,}(?:\/\S*)?/;

function isUrlToken(token) {
  return SCHEME_PREFIX.test(token) || EMAIL_PREFIX.test(token) || DOMAIN_PREFIX.test(token);
}

export function resolveBlockDirection(text, inherited = 'ltr') {
  if (typeof text !== 'string' || text === '') return inherited;
  const counting = text.replace(/\S+/g, (token) => (
    token.length <= MAX_STRIP_TOKEN && isUrlToken(token) ? ' ' : token
  ));
  let rtl = 0;
  let ltr = 0;
  for (const ch of counting) {
    // RTL scripts are also letters, so test RTL first and use else-if to avoid double count.
    if (isRtlLetter(ch)) rtl++;
    else if (ANY_LETTER.test(ch)) ltr++;
  }
  const total = rtl + ltr;
  if (total === 0) return inherited; // neutral-only → inherit (EC-C1)
  if (rtl === ltr) return inherited; // exact tie → inherit (was: dead-band first-strong)
  // Standards default: first strong character (HTML dir="auto" / UAX #9 P2/P3).
  const firstStrong = resolveDirection(text, inherited);
  // …overridden when the opposite script is a strict majority (the documented first-strong
  // failure: an RTL paragraph/heading that begins with a strong LTR character).
  if (firstStrong === 'ltr' && rtl / total > BLOCK_DOMINANCE) return 'rtl';
  if (firstStrong === 'rtl' && ltr / total > BLOCK_DOMINANCE) return 'ltr';
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
 *
 * An explicit `dir` is REQUIRED for neutral-only runs (digit groups): a bare <bdi>
 * is dir="auto", and content with no strong character inherits the PARENT direction —
 * inside an RTL block that reorders the very separators the isolate exists to protect
 * (2026-06-01 → 01-06-2026, 12:30 → 30:12).
 */
export function isolate(text, escape = (s) => s, dir = null) {
  const attr = dir === 'ltr' || dir === 'rtl' ? ` dir="${dir}"` : '';
  return `<bdi${attr}>${escape(text)}</bdi>`;
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

/** URL-safe slug for headings, Arabic-aware (EC-C5): keep letters/numbers, dash the rest. */
export function slugify(text) {
  return String(text)
    .trim()
    .toLowerCase()
    // audit UX-14c: peel tashkeel (Arabic diacritics) and tatweel FIRST. They are combining
    // marks, not letters, so the run-collapse below used to turn them into dashes —
    // 'كِتَاب' slugged to 'ك-ت-ا-ب' instead of matching the bare 'كتاب'.
    .replace(/[\u064B-\u065F\u0670\u0640]/gu, '')
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
