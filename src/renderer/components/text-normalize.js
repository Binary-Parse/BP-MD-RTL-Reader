/**
 * text-normalize.js — Arabic-aware search normalization (audit UX-03).
 *
 * Arabic notes are written with inconsistent vocalization: searching `محمد` must find
 * `مُحَمَّد`, `كتاب` must find `كِتَاب`, `اسلام` must find `إسلام`. normalizeArabicWithMap
 * strips tashkeel/tatweel and folds hamza/ta-marbuta/alif-maqsura while keeping an
 * index map so a match found in the normalized string can be mapped back to the
 * ORIGINAL text (for snippets, highlights, and selections). Pure — no DOM.
 */

const DIACRITIC = /[\u064B-\u065F\u0670\u0640]/; // tashkeel, superscript-alef, tatweel
// أ إ آ ٱ → ا ; ة → ه ; ى → ي
const FOLD = { '\u0623': '\u0627', '\u0625': '\u0627', '\u0622': '\u0627', '\u0671': '\u0627', '\u0629': '\u0647', '\u0649': '\u064A' };
// audit M26: the same word typed on a Persian or Urdu keyboard, and the same number in any
// of the three digit sets, must match. One character folds to one character, so the index
// map below is unchanged.
//   ک (U+06A9) → ك ; ی (U+06CC), ے (U+06D2) → ي ; ە (U+06D5), ۀ (U+06C0) → ه
Object.assign(FOLD, { '\u06A9': '\u0643', '\u06CC': '\u064A', '\u06D2': '\u064A', '\u06D5': '\u0647', '\u06C0': '\u0647' });
//   ٠–٩ (Arabic-Indic) and ۰–۹ (Persian) → 0–9
for (let d = 0; d < 10; d += 1) {
  FOLD[String.fromCharCode(0x0660 + d)] = String(d);
  FOLD[String.fromCharCode(0x06F0 + d)] = String(d);
}

/** True when a query/haystack contains Arabic-block characters (gates the slow path). */
export const HAS_ARABIC = /[\u0600-\u06FF]/;

/**
 * True when a query must be searched in the folded text: it holds Arabic-block characters,
 * or ASCII digits, which also have to find `٢٠٢٤` and `۲۰۲۴` (audit M26).
 */
export const NEEDS_FOLD = /[\u0600-\u06FF0-9]/;

/** Plain normalized string (no map) — for queries and name matching. */
export function normalizeArabic(s) {
  if (typeof s !== 'string' || !s) return s || '';
  let out = '';
  for (const ch of s) {
    if (DIACRITIC.test(ch)) continue;
    out += FOLD[ch] || ch;
  }
  return out;
}

/**
 * Normalized string + map back to original indices.
 * map[i] = index in `s` of the i-th kept character. An exclusive end in norm-space j
 * maps to (j < map.length ? map[j] : s.length); extend it over trailing diacritics
 * with mapEnd so highlights cover the full vocalized form of the last letter.
 */
export function normalizeArabicWithMap(s) {
  if (typeof s !== 'string' || !s) return { norm: '', map: [] };
  let norm = '';
  const map = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (DIACRITIC.test(ch)) continue;
    const folded = FOLD[ch] || ch;
    for (const c of folded) { norm += c; map.push(i); }
  }
  return { norm, map };
}

/** Exclusive original-index end for norm index j, extended over trailing diacritics. */
export function mapEnd(s, m, j) {
  let end = j < m.map.length ? m.map[j] : s.length;
  while (end < s.length && DIACRITIC.test(s[end])) end++;
  return end;
}

/**
 * All normalized matches of an Arabic `query` in `text`, as original-space ranges
 * (RTL-M3): Edit-mode search and any raw-source find surface share the Reading pane's
 * fold — `محمد` finds `مُحَمَّد` — with offsets mapped back so selections land on the
 * vocalized source. Returns null when the query needs no folding (no Arabic, no digit);
 * a query that normalizes to '' matches nothing (an emptied normalization is a miss for
 * everything, not a match for everything).
 */
export function arabicFindMatches(text, query) {
  if (typeof text !== 'string' || !query || !NEEDS_FOLD.test(query)) return null;
  const normQuery = normalizeArabic(query).toLowerCase();
  if (!normQuery) return [];
  const ar = normalizeArabicWithMap(text);
  const normLower = ar.norm.toLowerCase();
  const matches = [];
  let from = 0;
  for (;;) {
    const idx = normLower.indexOf(normQuery, from);
    if (idx < 0) break;
    const start = ar.map[idx];
    const end = mapEnd(text, ar, idx + normQuery.length);
    matches.push({ start, end: end > start ? end : start + 1 });
    from = idx + normQuery.length;
  }
  return matches;
}
