/**
 * protocol.js — pure resolver for the bpmd:// asset scheme (T-AI2).
 * Maps `bpmd://vault/<relPath>` to an absolute path that MUST resolve inside an
 * allow-listed vault root. No Electron; the registration glue lives in main.js.
 */

/** Extract the vault-relative path from a bpmd:// URL, or null. */
function parseBpmdUrl(url) {
  if (typeof url !== 'string') return null;
  const m = /^bpmd:\/\/vault\/(.+)$/i.exec(url);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch (_) { return m[1]; }
}

/**
 * Resolve a bpmd://vault/* URL to an absolute path under `root`.
 * @returns {{path:string}|{error:'bad-url'|'unauthorized-path'}}
 */
function resolveAsset(url, root, pathmod) {
  const rel = parseBpmdUrl(url);
  if (rel == null) return { error: 'bad-url' };
  if (!root || typeof root !== 'string') return { error: 'unauthorized-path' };
  if (pathmod.isAbsolute(rel)) return { error: 'unauthorized-path' };
  const full = pathmod.resolve(root, rel);
  const back = pathmod.relative(root, full);
  if (back === '' || back.startsWith('..') || pathmod.isAbsolute(back)) {
    // '' means full === root (a directory, not a file); reject too.
    if (back === '') return { error: 'unauthorized-path' };
    return { error: 'unauthorized-path' };
  }
  return { path: full };
}

module.exports = { parseBpmdUrl, resolveAsset };
