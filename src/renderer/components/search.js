/**
 * search.js — Vault search logic
 * Pure function: no DOM, no side effects.
 *
 * Latin queries take the original fast path (lowercase substring). Arabic queries
 * (audit UX-03) additionally match a tashkeel-stripped, hamza-folded normalization of
 * each file; hits are mapped back to ORIGINAL indices so snippets show the text as
 * written. The per-file normalized copy is cached next to the lowercase copy.
 */
import { NEEDS_FOLD, normalizeArabic, normalizeArabicWithMap, mapEnd } from './text-normalize.js';

const normalizedFiles = new WeakMap();

// Large-file mode (a note of 20-100 MB): lower-casing it builds a second copy as big as the note,
// again after every edit, and the Arabic map is larger still. Such a note is searched for the
// query exactly as typed (case-sensitive, no Arabic folding) straight in its own text, and
// nothing is cached for it. Its name is matched as for any note.
function normalizeFile(file) {
  const content = file.content || '';
  const name = file.name || '';
  if (file.largeTier >= 2) return { content, name, nameLower: name.toLowerCase(), contentLower: null, arabic: null, large: true };
  const cached = normalizedFiles.get(file);
  if (cached && cached.content === content && cached.name === name) return cached;
  const normalized = { content, name, contentLower: content.toLowerCase(), nameLower: name.toLowerCase(), arabic: null };
  normalizedFiles.set(file, normalized);
  return normalized;
}

// Lazy (per-file, per-change) Arabic normalization: only paid when a query is Arabic.
// The map is built over the LOWERCASED text — the same string the query runs against.
// Building it over the original and lowercasing afterwards desyncs every index for a
// character whose toLowerCase changes UTF-16 length (e.g. İ U+0130 → i + U+0307).
function arabicOf(normalized) {
  if (!normalized.arabic) {
    const content = normalized.large ? { norm: '', map: [] } : normalizeArabicWithMap(normalized.contentLower);
    const name = normalizeArabicWithMap(normalized.nameLower);
    normalized.arabic = { normLower: content.norm, map: content.map, nameLower: name.norm };
  }
  return normalized.arabic;
}

export function vaultSearch(query, files, maxResults = 100) {
  if (!query || query.length < 2 || !files.length) return [];
  const arabicQuery = NEEDS_FOLD.test(query);
  const lower = query.toLowerCase();
  const normQuery = arabicQuery ? normalizeArabic(query).toLowerCase() : null;
  // RTL-M5: a query of pure tashkeel/tatweel normalizes to '' — and indexOf('') matches
  // every position, flooding the sidebar with every file. An emptied normalization is
  // a miss for everything, not a match for everything.
  if (arabicQuery && !normQuery) return [];
  const results = [];
  for (let fileIdx = 0; fileIdx < files.length && results.length < maxResults; fileIdx++) {
    const f = files[fileIdx];
    const n = normalizeFile(f);
    const c = n.content;
    const nameMatch = arabicQuery
      ? (n.nameLower.includes(lower) || arabicOf(n).nameLower.includes(normQuery))
      : n.nameLower.includes(lower);
    const hits = [];
    let searchFrom = 0; // cursor in the space the match was found in (norm space for Arabic)
    while (hits.length < 5) {
      let matchStart; let matchEnd; // match range in ORIGINAL coordinates
      let a; let b; // snippet window [a,b) in ORIGINAL coordinates
      if (n.large && arabicQuery) break; // no folded copy of a large note is built
      if (arabicQuery) {
        const ar = arabicOf(n);
        const idx = ar.normLower.indexOf(normQuery, searchFrom);
        if (idx < 0) break;
        matchStart = ar.map[idx];
        matchEnd = mapEnd(n.contentLower, ar, idx + normQuery.length);
        searchFrom = idx + normQuery.length;
        a = Math.max(0, matchStart - 40);
        b = Math.min(c.length, matchEnd + 40);
      } else {
        const idx = n.large ? c.indexOf(query, searchFrom) : n.contentLower.indexOf(lower, searchFrom);
        if (idx < 0) break;
        matchStart = idx;
        matchEnd = idx + query.length;
        searchFrom = idx + query.length;
        a = Math.max(0, idx - 40);
        b = Math.min(c.length, idx + query.length + 40);
      }
      const raw = c.slice(a, b).replace(/\n+/g, ' ');
      const relStart = matchStart - a;
      const relEnd = relStart + (matchEnd - matchStart);
      hits.push({
        before: raw.slice(0, relStart),
        match: raw.slice(relStart, relEnd),
        after: raw.slice(relEnd),
        ellipsisBefore: a > 0,
        ellipsisAfter: b < c.length,
      });
    }
    if (hits.length > 0 || nameMatch) {
      results.push({ name: n.name, fileIdx, hits: hits.length > 0 ? hits : [] });
    }
  }
  return results;
}

/**
 * Pre-warm the lowercase cache for a slice of files (audit PERF-06: the FIRST search's
 * cold toLowerCase pass over a large vault blocked the UI thread 100–320ms). Idempotent
 * per file/content (WeakMap-cached inside normalizeFile); returns how many files it saw.
 */
export function warmSearchIndexSlice(files, from, to) {
  let seen = 0;
  if (!Array.isArray(files)) return 0;
  for (let i = from; i < to && i < files.length; i++) {
    if (files[i]) { normalizeFile(files[i]); seen += 1; }
  }
  return seen;
}
