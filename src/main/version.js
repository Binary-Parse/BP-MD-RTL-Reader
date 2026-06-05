/**
 * version.js — pure semver-ish comparison for the opt-in update check (T-Q6). Compares
 * dotted numeric versions (a leading 'v' and any pre-release suffix are ignored), so it
 * can decide whether a fetched release is newer than the running app.
 */

/** Parse "v1.2.3-beta" → [1,2,3]. Non-numeric/garbage segments become 0. */
function parse(v) {
  return String(v == null ? '' : v)
    .trim()
    .replace(/^v/i, '')
    .split('-')[0]            // drop pre-release suffix
    .split('.')
    .map((n) => {
      const x = parseInt(n, 10);
      return Number.isFinite(x) ? x : 0;
    });
}

/** -1 if a<b, 0 if equal, 1 if a>b (by dotted numeric precedence). */
function compareVersions(a, b) {
  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

module.exports = { compareVersions, parse };
