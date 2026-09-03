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

// ── v1.2: multi-encoding read/write (UTF-8 / UTF-16 / Windows-1256) ────────
// Previously every file was hard-read as UTF-8: an Arabic Windows-1256 or UTF-16
// file rendered as mojibake AND a subsequent save wrote that mojibake back to disk,
// destroying the file. Reads now detect the encoding; writes re-encode faithfully.
//
// `utf8Key` is the string the conflict hash is computed over. For UTF-8 files it is
// byte-identical to what older versions hashed (readFileSync(path,'utf8')), so
// settings/meta saved by previous releases still conflict-check correctly.

function isValidUtf8(buf) {
  const text = buf.toString('utf8');
  return Buffer.from(text, 'utf8').equals(buf);
}

// char -> byte, built once from the decoder so encode and decode can never drift.
let _cp1256Map = null;
function cp1256Map() {
  if (_cp1256Map) return _cp1256Map;
  const map = new Map();
  if (typeof TextDecoder === 'function') {
    try {
      const dec = new TextDecoder('windows-1256');
      for (let b = 0x80; b <= 0xFF; b++) {
        const ch = dec.decode(Uint8Array.of(b));
        if (ch.length === 1 && !map.has(ch)) map.set(ch, b);
      }
    } catch (_) { /* decoder unavailable → fallback encoder below */ }
  }
  _cp1256Map = map;
  return map;
}

function encodeWindows1256(text) {
  const map = cp1256Map();
  const out = Buffer.alloc(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code <= 0x7F) out[i] = code;
    else {
      const mapped = map.get(text[i]);
      out[i] = mapped != null ? mapped : 0x3F; // unmappable → '?'
    }
  }
  return out;
}

/** Decode raw file bytes (or a legacy string from a mocked fs) into clean text. */
function decodeBuffer(input) {
  if (typeof input === 'string') {
    return { text: input, encoding: 'utf8', bom: hasBOM(input), utf8Key: input };
  }
  if (!Buffer.isBuffer(input)) {
    const s = String(input == null ? '' : input);
    return { text: s, encoding: 'utf8', bom: hasBOM(s), utf8Key: s };
  }
  if (input.length >= 2 && input[0] === 0xFF && input[1] === 0xFE) {
    return { text: input.toString('utf16le').slice(1), encoding: 'utf16le', bom: true, utf8Key: input.toString('utf8') };
  }
  if (input.length >= 2 && input[0] === 0xFE && input[1] === 0xFF) {
    const swapped = Buffer.from(input);
    for (let i = 0; i + 1 < swapped.length; i += 2) {
      const t = swapped[i]; swapped[i] = swapped[i + 1]; swapped[i + 1] = t;
    }
    return { text: swapped.toString('utf16le').slice(1), encoding: 'utf16be', bom: true, utf8Key: input.toString('utf8') };
  }
  if (input.length >= 3 && input[0] === 0xEF && input[1] === 0xBB && input[2] === 0xBF) {
    const text = input.slice(3).toString('utf8');
    return { text, encoding: 'utf8', bom: true, utf8Key: input.toString('utf8') };
  }
  const utf8 = input.toString('utf8');
  if (isValidUtf8(input)) {
    return { text: utf8, encoding: 'utf8', bom: false, utf8Key: utf8 };
  }
  // Not valid UTF-8 → assume Windows-1256 (the legacy Arabic codepage).
  if (typeof TextDecoder === 'function') {
    try {
      const text = new TextDecoder('windows-1256').decode(input);
      return { text, encoding: 'windows-1256', bom: false, utf8Key: utf8 };
    } catch (_) { /* fall through */ }
  }
  return { text: utf8, encoding: 'utf8', bom: false, utf8Key: utf8 };
}

/** Encode clean text back to the file's original encoding (BOM re-applied). */
function encodeBuffer(text, encoding, bom) {
  switch (encoding) {
    case 'utf16le': {
      const body = Buffer.from(text, 'utf16le');
      return bom ? Buffer.concat([Buffer.from([0xFF, 0xFE]), body]) : body;
    }
    case 'utf16be': {
      const body = Buffer.from(text, 'utf16le');
      for (let i = 0; i + 1 < body.length; i += 2) {
        const t = body[i]; body[i] = body[i + 1]; body[i + 1] = t;
      }
      return bom ? Buffer.concat([Buffer.from([0xFE, 0xFF]), body]) : body;
    }
    case 'windows-1256':
      // A cp1256 file cannot carry a UTF-8 BOM (a BOM would have classified it as
      // UTF-8 on read); the flag is deliberately ignored here.
      return encodeWindows1256(text);
    default: {
      const body = Buffer.from(text, 'utf8');
      return bom ? Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), body]) : body;
    }
  }
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

function canonicalPath(fs, path, candidate) {
  return typeof fs.realpathSync === 'function' ? fs.realpathSync(candidate) : path.resolve(candidate);
}

function validateWriteTarget(fs, path, absPath, root) {
  if (root) try {
    const canonicalRoot = canonicalPath(fs, path, root);
    const canonicalTarget = fs.existsSync(absPath)
      ? canonicalPath(fs, path, absPath)
      : path.join(canonicalPath(fs, path, path.dirname(absPath)), path.basename(absPath));
    if (!isInsideRoot(canonicalTarget, canonicalRoot, path)) return { error: 'unauthorized-path' };
  } catch (_) {
    return { error: 'unauthorized-path' };
  }
  if (!/\.(md|markdown)$/i.test(absPath)) return { error: 'invalid-file-type' };
  return { path: absPath };
}

/** Atomically replace a destination with text or binary data. */
function atomicWriteFile(fs, absPath, data, encoding) {
  const tmp = absPath + '.tmp-' + Math.random().toString(36).slice(2);
  try {
    if (encoding === undefined) fs.writeFileSync(tmp, data);
    else fs.writeFileSync(tmp, data, encoding);
    if (fs.fsyncSync) {
      try { const fd = fs.openSync(tmp, 'r+'); fs.fsyncSync(fd); fs.closeSync(fd); } catch (_) { /* best effort */ }
    }
    fs.renameSync(tmp, absPath);
    return { ok: true };
  } catch (e) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
    if (e && e.code === 'ENOSPC') return { error: 'enospc' };
    if (e && e.code === 'ENOENT') return { error: 'gone' };
    return { error: 'write-failed' };
  }
}

function createDocumentStore({ fs, path, crypto } = {}) {
  /** Read a file; return normalized body + meta needed for a faithful write. */
  function read(absPath) {
    // v1.2: read BYTES so the encoding can be detected (a mocked fs that only serves
    // strings still works — decodeBuffer treats strings as UTF-8, as before).
    const raw = fs.readFileSync(absPath);
    const dec = decodeBuffer(raw);
    const meta = {
      bom: dec.bom,
      eol: detectEol(dec.text),
      finalNewline: /\n$/.test(dec.text),
      encoding: dec.encoding,
      hash: hashContent(dec.utf8Key, crypto),
      mtimeMs: fs.statSync(absPath).mtimeMs,
    };
    return { content: normalize(dec.text), meta };
  }

  /**
   * Atomically write `content`, preserving the original encoding, with a
   * conflict check against the last-known hash.
   * @returns {{ok:true, meta}}|{error}
   */
  function write(absPath, content, opts = {}) {
    const { root, baseHash, bom = false, eol = '\n', finalNewline = true, encoding = 'utf8' } = opts;
    const validated = validateWriteTarget(fs, path, absPath, root);
    if (validated.error) return validated;

    // Conflict detection (EC-A2): the file changed since we last read it.
    if (baseHash != null && fs.existsSync(absPath)) {
      const current = hashContent(fs.readFileSync(absPath, 'utf8'), crypto);
      if (current !== baseHash) return { error: 'conflict' };
    }

    // Re-apply original encoding (EC-A1).
    let out = applyEol(content, eol);
    if (finalNewline && !out.endsWith(eol)) out += eol;
    let written;
    if (!encoding || encoding === 'utf8') {
      // UTF-8 keeps the legacy string-write path (BOM as the U+FEFF character).
      if (bom) out = '﻿' + out;
      written = atomicWriteFile(fs, absPath, out, 'utf8');
    } else {
      // v1.2: UTF-16 / Windows-1256 go out as real bytes.
      written = atomicWriteFile(fs, absPath, encodeBuffer(out, encoding, bom));
    }
    if (written.error) return written;
    let mtimeMs;
    try { mtimeMs = fs.statSync(absPath).mtimeMs; } catch (_) { /* optional metadata */ }
    return { ok: true, meta: { hash: hashContent(out, crypto), bom, eol, finalNewline, encoding, mtimeMs } };
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

  /**
   * Watch `root` for external changes (T-B9). Coalesces the burst of events fs.watch
   * emits per save into a single debounced `cb({ files })`. Returns a disposable.
   * Degrades to a no-op where fs.watch is unavailable or throws (e.g. EMFILE, or
   * recursive watch unsupported on the platform).
   */
  function watch(root, cb, { debounceMs = 150 } = {}) {
    if (typeof fs.watch !== 'function') return { close() {} };
    let timer = null;
    let pending = new Set();
    function flush() {
      const files = [...pending];
      pending = new Set();
      timer = null;
      try { cb({ files }); } catch (_) { /* a renderer-notify error must never crash the watcher */ }
    }
    let watcher;
    try {
      watcher = fs.watch(root, { recursive: true }, (_eventType, filename) => {
        if (filename) pending.add(String(filename));
        if (timer) clearTimeout(timer);
        timer = setTimeout(flush, debounceMs);
      });
    } catch (_) {
      return { close() {} };
    }
    return { close() { if (timer) clearTimeout(timer); try { watcher.close(); } catch (_) { /* already gone */ } } };
  }

  return { read, write, listMarkdown, watch };
}

module.exports = {
  createDocumentStore,
  // pure helpers exported for unit/mutation testing
  hasBOM, stripBOM, detectEol, applyEol, normalize, hashContent, isInsideRoot,
  validateWriteTarget, atomicWriteFile,
  decodeBuffer, encodeBuffer, encodeWindows1256,
  MAX_FILES, MAX_DEPTH,
};
