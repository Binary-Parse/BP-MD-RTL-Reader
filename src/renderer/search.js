/**
 * search.js — Vault search logic
 * Pure function: no DOM, no side effects.
 */

export function vaultSearch(query, files) {
  if (!query || query.length < 2 || !files.length) return [];
  const lower = query.toLowerCase();
  const results = [];
  files.forEach((f, fileIdx) => {
    const c = f.content || '';
    const cl = c.toLowerCase();
    const nameMatch = f.name.toLowerCase().includes(lower);
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
      results.push({ name: f.name, fileIdx, hits: hits.length > 0 ? hits : [] });
    }
  });
  return results;
}
