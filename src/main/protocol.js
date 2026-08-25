/**
 * protocol.js — pure resolvers for bpmd:// vault assets (T-AI2) and the
 * app:// renderer bundle. No Electron; registration glue lives in src/main/index.js.
 */

/**
 * Extract the {vaultId, rel} pair from a bpmd://vault/<vaultId>/<rel> URL, or null.
 * The id is split off the raw URL BEFORE any decoding, so a %2F inside rel can never
 * shift the segment boundary and forge a different vaultId.
 */
function parseBpmdUrl(url) {
  if (typeof url !== 'string') return null;
  const m = /^bpmd:\/\/vault\/([^/]+)\/(.+)$/i.exec(url);
  if (!m) return null;
  const vaultId = m[1];
  let rel;
  try { rel = decodeURIComponent(m[2]); } catch (_) { rel = m[2]; }
  return { vaultId, rel };
}

/**
 * Resolve a bpmd://vault/<vaultId>/* URL to an absolute path under `root`. The caller
 * has already used the URL's vaultId to pick `root` from the set of currently-open
 * vaults; this function only re-derives `rel` from the same URL and applies the
 * containment check, unchanged from the single-vault version.
 * @returns {{path:string}|{error:'bad-url'|'unauthorized-path'}}
 */
function resolveAsset(url, root, pathmod) {
  const parsed = parseBpmdUrl(url);
  if (parsed == null) return { error: 'bad-url' };
  const rel = parsed.rel;
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

const APP_HOST = 'ui';
const APP_RENDERER_URL = 'app://ui/src/renderer/index.html';
const APP_MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
});

function parseAppUrl(url) {
  if (typeof url !== 'string') return null;
  let parsed;
  try { parsed = new URL(url); } catch (_) { return null; }
  if (parsed.protocol !== 'app:') return null;
  if (parsed.hostname !== APP_HOST) return null;
  let rel;
  try { rel = decodeURIComponent(parsed.pathname || ''); } catch (_) { rel = parsed.pathname || ''; }
  rel = rel.replace(/^\/+/, '');
  return rel || null;
}

function resolveAppAsset(url, root, pathmod) {
  const rel = parseAppUrl(url);
  if (rel == null) return { error: 'bad-url' };
  if (!root || typeof root !== 'string') return { error: 'unauthorized-path' };
  if (pathmod.isAbsolute(rel)) return { error: 'unauthorized-path' };
  const full = pathmod.resolve(root, rel);
  const back = pathmod.relative(root, full);
  if (back === '' || back.startsWith('..') || pathmod.isAbsolute(back)) {
    return { error: 'unauthorized-path' };
  }
  const posixRel = back.replace(/\\/g, '/');
  if (!posixRel.startsWith('src/renderer/') && !posixRel.startsWith('resources/vendor/')) {
    return { error: 'unauthorized-path' };
  }
  const type = APP_MIME[pathmod.extname(full).toLowerCase()];
  if (!type) return { error: 'unsupported-type' };
  return { path: full, type };
}

const APP_HTML_TYPE = 'text/html; charset=utf-8';

/**
 * Response headers for an app:// asset.
 *
 * W3C CSP3 §3.3 excludes frame-ancestors (with report-uri and sandbox) from
 * `<meta http-equiv>` delivery, so index.html cannot declare it — the renderer's framing
 * policy has to arrive as a real header on the document response.
 *
 * The gate is exact equality with the HTML MIME, never a substring test: `.js`, `.css`
 * and `.txt` are all inside the app:// allow-list and all contain "text/", and none of
 * them may carry a document policy.
 *
 * @param {string} type resolveAppAsset()'s MIME string
 * @returns {Record<string,string>}
 */
function appResponseHeaders(type) {
  return type === APP_HTML_TYPE
    ? { 'content-type': type, 'content-security-policy': "frame-ancestors 'none'" }
    : { 'content-type': type };
}

module.exports = {
  parseBpmdUrl,
  resolveAsset,
  validateAsset,
  ASSET_MAX_BYTES,
  ASSET_MIME,
  APP_HOST,
  APP_RENDERER_URL,
  APP_MIME,
  parseAppUrl,
  resolveAppAsset,
  appResponseHeaders,
};
