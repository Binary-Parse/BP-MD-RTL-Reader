/**
 * search.js — Vault search logic
 * Pure function: no DOM, no side effects.
 */

const normalizedFiles = new WeakMap();

function normalizeFile(file) {
  const content = file.content || '';
  const name = file.name || '';
  const cached = normalizedFiles.get(file);
  if (cached && cached.content === content && cached.name === name) return cached;
  const normalized = { content, name, contentLower: content.toLowerCase(), nameLower: name.toLowerCase() };
  normalizedFiles.set(file, normalized);
  return normalized;
}

export function vaultSearch(query, files, maxResults = 100) {
  if (!query || query.length < 2 || !files.length) return [];
  const lower = query.toLowerCase();
  const results = [];
  for (let fileIdx = 0; fileIdx < files.length && results.length < maxResults; fileIdx++) {
    const f = files[fileIdx];
    const { content: c, contentLower: cl, name, nameLower } = normalizeFile(f);
    const nameMatch = nameLower.includes(lower);
    const hits = [];
    let searchFrom = 0;
    while (hits.length < 5) {
      const idx = cl.indexOf(lower, searchFrom);
      if (idx < 0) break;
      const a = Math.max(0, idx - 40);
      const b = Math.min(c.length, idx + query.length + 40);
      const raw = c.slice(a, b).replace(/\n+/g, ' ');
      const relIdx = idx - a;
      hits.push({
        before: raw.slice(0, relIdx),
        match: raw.slice(relIdx, relIdx + query.length),
        after: raw.slice(relIdx + query.length),
        ellipsisBefore: a > 0,
        ellipsisAfter: b < c.length,
      });
      searchFrom = idx + query.length;
    }
    if (hits.length > 0 || nameMatch) {
      results.push({ name, fileIdx, hits: hits.length > 0 ? hits : [] });
    }
  }
  return results;
}
