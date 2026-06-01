/**
 * document-store.js — transactional repository over the filesystem (T-AI1).
 * The single authority for reading/writing notes: preserves encoding (BOM/EOL),
 * writes atomically, detects external-modification conflicts, and lists a vault
 * recursively with cycle/size guards. fs/path/crypto are injected for testing.
 */

const MAX_FILES = 5000;
const MAX_DEPTH = 12;

// ── Pure encoding helpers (EC-A1) ──────────────────────────────────────────
function hasBOM(content) {
  return typeof content === 'string' && content.charCodeAt(0) === 0xFEFF;
}
function stripBOM(content) {
  return hasBOM(content) ? content.slice(1) : content;
}
/** Detect dominant end-of-line style. */
function detectEol(content) {
  const crlf = (content.match(/\r\n/g) || []).length;
  const lf = (content.match(/(^|[^\r])\n/g) || []).length;
  return crlf > 0 && crlf >= lf ? '\r\n' : '\n';
}
/** Re-apply a target EOL to LF-normalized content. */
function applyEol(content, eol) {
  const lf = content.replace(/\r\n/g, '\n');
  return eol === '\r\n' ? lf.replace(/\n/g, '\r\n') : lf;
}
/** Normalize content for editing (strip BOM, LF). */
function normalize(raw) {
  return stripBOM(raw).replace(/\r\n/g, '\n');
}

function hashContent(content, crypto) {
  if (crypto && crypto.createHash) {
    return crypto.createHash('sha1').update(content).digest('hex');
  }
  // deterministic fallback hash
  let h = 0;
  for (let i = 0; i < content.length; i++) { h = (h * 31 + content.charCodeAt(i)) >>> 0; }
  return String(h);
}

// ── Path guard (EC-A4) ─────────────────────────────────────────────────────
function isInsideRoot(absPath, root, path) {
  const rel = path.relative(root, absPath);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function createDocumentStore({ fs, path, crypto } = {}) {
  /** Read a file; return normalized body + meta needed for a faithful write. */
  function read(absPath) {
    const raw = fs.readFileSync(absPath, 'utf8');
    const meta = {
      bom: hasBOM(raw),
      eol: detectEol(raw),
      finalNewline: /\n$/.test(raw),
      hash: hashContent(raw, crypto),
      mtimeMs: fs.statSync(absPath).mtimeMs,
    };
    return { content: normalize(raw), meta };
  }

  /**
   * Atomically write `content`, preserving the original encoding, with a
   * conflict check against the last-known hash.
   * @returns {{ok:true, meta}}|{error}
   */
  function write(absPath, content, opts = {}) {
    const { root, baseHash, bom = false, eol = '\n', finalNewline = true } = opts;
    if (root && !isInsideRoot(absPath, root, path)) return { error: 'unauthorized-path' };

    // Conflict detection (EC-A2): the file changed since we last read it.
    if (baseHash != null && fs.existsSync(absPath)) {
      const current = hashContent(fs.readFileSync(absPath, 'utf8'), crypto);
      if (current !== baseHash) return { error: 'conflict' };
    }

    // Re-apply original encoding (EC-A1).
    let out = applyEol(content, eol);
    if (finalNewline && !out.endsWith(eol)) out += eol;
    if (bom) out = '﻿' + out;

    // Atomic write (EC-A3): temp in same dir, fsync, rename.
    const tmp = absPath + '.tmp-' + Math.random().toString(36).slice(2);
    try {
      fs.writeFileSync(tmp, out, 'utf8');
      if (fs.fsyncSync) {
        try { const fd = fs.openSync(tmp, 'r+'); fs.fsyncSync(fd); fs.closeSync(fd); } catch (_) { /* best effort */ }
      }
      fs.renameSync(tmp, absPath);
    } catch (e) {
      try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
      if (e && e.code === 'ENOSPC') return { error: 'enospc' };
      if (e && e.code === 'ENOENT') return { error: 'gone' };
      return { error: 'write-failed' };
    }
    return { ok: true, meta: { hash: hashContent(out, crypto), bom, eol } };
  }

  /**
   * Recursively list markdown files under `root`, cycle-safe and bounded.
   * @returns {Array<{relPath:string}>}
   */
  function listMarkdown(root, { maxFiles = MAX_FILES, maxDepth = MAX_DEPTH } = {}) {
    const out = [];
    const visited = new Set();
    function walk(dir, depth) {
      if (depth > maxDepth || out.length >= maxFiles) return;
      let real;
      try { real = fs.realpathSync(dir); } catch (_) { return; }
      if (visited.has(real)) return;             // cycle guard (EC-A5)
      visited.add(real);
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
      for (const e of entries) {
        if (out.length >= maxFiles) return;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full, depth + 1);
        else if ((e.isFile() || e.isSymbolicLink()) && /\.(md|markdown)$/i.test(e.name)) {
          out.push({ relPath: path.relative(root, full) });
        }
      }
    }
    walk(root, 0);
    out.sort((a, b) => a.relPath.localeCompare(b.relPath));
    return out;
  }

  return { read, write, listMarkdown };
}

module.exports = {
  createDocumentStore,
  // pure helpers exported for unit/mutation testing
  hasBOM, stripBOM, detectEol, applyEol, normalize, hashContent, isInsideRoot,
  MAX_FILES, MAX_DEPTH,
};
