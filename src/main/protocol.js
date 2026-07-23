/**
 * protocol.js — pure resolver for the bpmd:// asset scheme (T-AI2).
 * Maps `bpmd://vault/<relPath>` to an absolute path that MUST resolve inside an
 * allow-listed vault root. No Electron; the registration glue lives in src/main/index.js.
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
  // Reject anything not strictly INSIDE root: '' = root itself (a directory, not a file);
  // a leading '..' = escapes the vault; an absolute back-path = a different drive/root.
  if (back === '' || back.startsWith('..') || pathmod.isAbsolute(back)) {
    return { error: 'unauthorized-path' };
  }
  return { path: full };
}

const ASSET_MAX_BYTES = 5 * 1024 * 1024;
const ASSET_MIME = Object.freeze({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
});

async function validateAsset(candidate, root, fs, pathmod, maxBytes = ASSET_MAX_BYTES) {
  const type = ASSET_MIME[pathmod.extname(candidate).toLowerCase()];
  if (!type) return { error: 'unsupported-type' };
  try {
    const [canonicalRoot, canonicalFile] = await Promise.all([
      fs.promises.realpath(root),
      fs.promises.realpath(candidate),
    ]);
    const rel = pathmod.relative(canonicalRoot, canonicalFile);
    if (rel === '' || rel.startsWith('..') || pathmod.isAbsolute(rel)) return { error: 'unauthorized-path' };
    const stat = await fs.promises.stat(canonicalFile);
    if (!stat.isFile()) return { error: 'not-regular-file' };
    if (stat.size > maxBytes) return { error: 'file-too-large' };
    return { path: canonicalFile, type, size: stat.size };
  } catch (_) {
    return { error: 'not-found' };
  }
}

module.exports = { parseBpmdUrl, resolveAsset, validateAsset, ASSET_MAX_BYTES, ASSET_MIME };
