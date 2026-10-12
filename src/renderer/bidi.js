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
 * Resolve a BLOCK's direction: first strong character first, dominant script second.
 *
 * A block whose first strong character is RTL is RTL (UAX #9 P2/P3, HTML dir="auto"),
 * whatever share of Latin terms follows: an Arabic heading such as "تثبيت Docker على Windows"
 * is Arabic text with Latin product names, not an English line (audit H4, owner decision
 * 2026-10-10). First-strong's one documented failure is the OPPOSITE case, a block that
 * opens with a Latin word or number but is mostly Arabic ("API دليل المستخدم", W3C i18n).
 * So a Latin-first block flips to RTL only when RTL is a STRICT MAJORITY of the strong
 * letters, counted after URLs/URIs are stripped; an exact tie and neutral-only text inherit
 * the base direction. Inline isolation (needsIsolation) uses the pure first-strong
 * resolveDirection — an inline run's own direction IS its first strong char.
 *
 * @param {string} text
 * @param {'ltr'|'rtl'} inherited  base direction for neutral-only text / ties
 * @returns {'ltr'|'rtl'}
 */
// A Latin-first block flips to RTL only when RTL is a STRICT majority of the strong
// letters (audit UX-01): the previous 0.6 threshold left a dead band (50–60%) where
// prepending one English word flipped an Arabic paragraph to LTR. URLs/URIs are
// stripped before counting — their path letters are identifiers,
// not English prose, and used to force genuinely Arabic sentences to LTR. RTL-M7: the
// strip covers SCHEME-LESS forms too — bare domains (docs.example.com/en-us/…) and
// email addresses — whose Latin path/local letters are just as much identifiers as a
// scheme'd URL's, and used to flip short Arabic sentences to LTR all the same.
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
  if (rtl + ltr === 0) return inherited; // neutral-only → inherit (EC-C1)
  // Standards default: first strong character (HTML dir="auto" / UAX #9 P2/P3). RTL wins
  // outright (audit H4); there is deliberately no "mostly Latin" override for it.
  if (resolveDirection(text, inherited) === 'rtl') return 'rtl';
  // Latin-first: overridden only when RTL is a strict majority (the documented first-strong
  // failure: an RTL paragraph/heading that begins with a strong LTR character).
  if (rtl > ltr) return 'rtl';
  if (rtl < ltr) return 'ltr';
  return inherited; // exact tie → inherit (was: dead-band first-strong)
}

// ── proseText: the text a reader reads (audit H8) ────────────────────────────────────────
// The document direction (and an export's <html lang dir>) used to be measured on the raw
// Markdown, so an Arabic article with a long code listing resolved from the code. proseText()
// drops what is not prose: fenced code, inline code spans and $…$ / $$…$$ math. Everything here
// is a single left-to-right scan with no nested quantifiers, so a 1 MB note stays linear.
const FENCE_OPEN = /^[ \t]{0,3}(`{3,}|~{3,})([^\n]*)$/;
const FENCE_CLOSE = /^[ \t]{0,3}(`{3,}|~{3,})\s*$/;
// Same rule as the renderer's inline-math tokenizer (markdown/math.js): the opening $ is
// followed by a non-space, the closing $ follows a non-space — so "$5 and $10" is currency.
const INLINE_MATH = /(?<!\\)\$(?!\$)(?=\S)[^$\n]*?(?<=\S)\$/g;
const BACKTICK_RUN = /`+/g;

function stripCodeSpans(line) {
  const runs = [];
  BACKTICK_RUN.lastIndex = 0;
  for (let m = BACKTICK_RUN.exec(line); m; m = BACKTICK_RUN.exec(line)) {
    const escaped = line.charAt(m.index - 1) === '\\'; // \` is a literal backtick
    const len = m[0].length - (escaped ? 1 : 0);
    if (len > 0) runs.push({ start: m.index + (escaped ? 1 : 0), len, closer: null });
  }
  // A span opens at a run and closes at the NEXT run of exactly the same length (CommonMark).
  // Linking each run to that "next equal run" from the right keeps the whole line linear.
  const lastSeen = new Map();
  for (const run of runs.toReversed()) {
    run.closer = lastSeen.get(run.len) || null;
    lastSeen.set(run.len, run);
  }
  let out = '';
  let pos = 0;
  for (const run of runs) {
    if (run.start < pos || !run.closer) continue; // inside a span already cut, or never closed
    out += line.slice(pos, run.start);
    pos = run.closer.start + run.closer.len;
  }
  return out + line.slice(pos);
}

function stripInline(line) {
  return stripCodeSpans(line).replace(INLINE_MATH, '');
}

/**
 * The prose of a Markdown source: `markdown` without fenced code blocks, inline code spans and
 * math. Lines that are kept stay in place (joined with '\n'), so it can feed the same direction
 * resolvers as the raw text.
 * @param {string} markdown
 * @returns {string}
 */
export function proseText(markdown) {
  const lines = (markdown == null ? '' : String(markdown)).split('\n');
  const out = [];
  let fence = null; // { ch, len } while inside a fenced code block
  let inDisplayMath = false;
  // A "$$" opener is a block only when a LATER line holds a "$$" to close it (else plain text).
  const lastMathLine = lines.findLastIndex((l) => l.includes('$$'));
  for (const [i, line] of lines.entries()) {
    if (fence) {
      const close = FENCE_CLOSE.exec(line);
      if (close && close[1][0] === fence.ch && close[1].length >= fence.len) fence = null;
      continue;
    }
    if (inDisplayMath) {
      if (line.includes('$$')) inDisplayMath = false;
      continue;
    }
    const open = FENCE_OPEN.exec(line);
    // A backtick fence's info string may not contain a backtick (that line is an inline span).
    if (open && !(open[1][0] === '`' && open[2].includes('`'))) {
      fence = { ch: open[1][0], len: open[1].length };
      continue;
    }
    if (line.trimStart().startsWith('$$')) {
      if (line.trim().indexOf('$$', 2) !== -1) continue; // $$ … $$ on one line
      if (lastMathLine > i) { inDisplayMath = true; continue; }
    }
    out.push(stripInline(line));
  }
  return out.join('\n');
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
