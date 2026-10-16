/**
 * document-store.js — transactional repository over the filesystem (T-AI1).
 * The single authority for reading/writing notes: preserves encoding (BOM/EOL),
 * writes atomically and detects external-modification conflicts.
 * fs/path/crypto are injected for testing.
 */

const MAX_DEPTH = 12;
const { MAX_FILE_BYTES } = require('./main-logic');
// The conflict check hashes the copy on disk up to the open limit: a note that opened is never
// larger, so no note the app can hold is saved over without being compared (sha256 of 100 MiB
// is about 30 ms). A copy that has grown past the limit since is a change, hence a conflict.
const MAX_CONFLICT_HASH_BYTES = MAX_FILE_BYTES;

const { atomicWriteFile, STALE_TEMP_AGE_MS } = require('./atomic-rename');

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
/** Normalize content for editing (strip BOM; every line ending, lone CR included, becomes LF). */
function normalize(raw) {
  return stripBOM(raw).replace(/\r\n?/g, '\n');
}

// ── Per-line endings (audit M5, decision D6) ───────────────────────────────
// The editor holds LF only (CodeMirror keeps no per-line ending), and a save used to give
// every line the dominant ending: a file with 4 CRLF lines and 1 LF line came back all
// CRLF. When one style cannot describe a file, a save now keeps the ending of every line
// the user did not touch, taken from the file as it is on disk.

/** True when one ending style cannot describe the text: CRLF beside bare LF, or any lone CR. */
function hasMixedEol(content) {
  return /\r(?!\n)/.test(content) || (/\r\n/.test(content) && /(^|[^\r])\n/.test(content));
}

/** Split into line texts and the ending that followed each (one more text than endings). */
function splitLines(text) {
  const texts = [];
  const ends = [];
  const ending = /\r\n|\n|\r/g;
  let from = 0;
  let match = ending.exec(text);
  while (match) {
    texts.push(text.slice(from, match.index));
    ends.push(match[0]);
    from = ending.lastIndex;
    match = ending.exec(text);
  }
  texts.push(text.slice(from));
  return { texts, ends };
}

/**
 * Give LF-normalized `content` the line endings of `original` (the file on disk).
 * Lines of the unchanged head and tail keep their own ending. Between them: when no line
 * was added or removed, each line keeps the ending at its position; otherwise the changed
 * lines get `eol`, the file's dominant ending.
 */
function applyEolPreserving(content, original, eol) {
  const old = splitLines(original);
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const count = lines.length - 1; // endings to decide; the last piece has none
  const oldCount = old.ends.length;
  const limit = Math.min(count, oldCount);
  let head = 0;
  while (head < limit && lines.at(head) === old.texts.at(head)) head += 1;
  let tail = 0;
  while (tail < limit - head && lines.at(count - 1 - tail) === old.texts.at(oldCount - 1 - tail)) tail += 1;
  return lines.map((line, index) => {
    if (index >= count) return line;
    if (index < head) return line + old.ends.at(index);
    if (index >= count - tail) return line + old.ends.at(oldCount - (count - index));
    return line + (count === oldCount ? old.ends.at(index) : eol);
  }).join('');
}

// ── v1.2: multi-encoding read/write (UTF-8 / UTF-16 / Windows-1256) ────────
// Previously every file was hard-read as UTF-8: an Arabic Windows-1256 or UTF-16
// file rendered as mojibake AND a subsequent save wrote that mojibake back to disk,
// destroying the file. Reads now detect the encoding; writes re-encode faithfully.
//
// `hashKey` is what the conflict hash is computed over: the file's raw bytes. The hash
// of valid UTF-8 bytes equals the hash of their string, so nothing changes for UTF-8
// files. Windows-1256 and UTF-16 bytes used to be hashed after `toString('utf8')`, which
// turns every byte that is not valid UTF-8 into U+FFFD: an external edit that kept the
// length (one Arabic letter for another) hashed the same and was overwritten (audit M8).

function isValidUtf8(buf) {
  const text = buf.toString('utf8');
  return Buffer.from(text, 'utf8').equals(buf);
}

// A copy of `input` with each byte pair swapped (UTF-16BE <-> LE). Unlike Buffer#swap16 it
// accepts an odd length and leaves the last byte as it is.
function swapBytes16(input) {
  const out = Buffer.from(input);
  for (let i = 0; i + 1 < out.length; i += 2) {
    const t = out[i]; out[i] = out[i + 1]; out[i + 1] = t;
  }
  return out;
}

// BOM-less UTF-16 detection: in UTF-16 one byte of every pair is the code unit's HIGH
// byte, and every script this app reads (ASCII/Latin 0x00, Arabic 0x06-0x08) keeps it
// ≤ 0x08, while the LOW byte is unconstrained. A single-byte encoding (UTF-8, cp1256)
// can never put ≤0x08 bytes at EVERY other position, so the parity test below is a
// high-confidence discriminator. Scripts above U+09FF (CJK…) are out of scope.
function isUtf16Parity(input, highIndex) {
  if (input.length < 4 || input.length % 2 !== 0) return false;
  for (let i = highIndex; i < input.length; i += 2) {
    if (input[i] > 0x08) return false;
  }
  return true;
}

// audit M6: the parity test above misses UTF-16 text with any character above U+08FF
// (an em dash is U+2014), and such a file then passed as "valid UTF-8" because its bytes
// are ASCII, NUL and control bytes; the first save rewrote it. A NUL byte does not occur in
// UTF-8 or Windows-1256 text, so its presence is the trigger: decode both byte orders
// strictly and keep the one that reads as text.
function decodeUtf16Strict(input, encoding) {
  try {
    const text = new TextDecoder(encoding, { fatal: true }).decode(input); // lone surrogate → throws
    // C0 controls other than tab/LF/FF/CR, and the noncharacters U+FFFE/U+FFFF, are not text.
    return /[\u0000-\u0008\u000B\u000E-\u001F￾￿]/.test(text) ? null : text;
  } catch (_) {
    return null;
  }
}

/** Characters expected in the text this app reads: ASCII, Latin-1, Arabic, general punctuation. */
function familiarCharCount(text) {
  const found = text.match(/[\t\n\r -~ -ÿ؀-ۿ‐-‧]/g);
  return found ? found.length : 0;
}

/**
 * BOM-less UTF-16 that the parity test did not accept.
 * @returns {{text:string, encoding:'utf16le'|'utf16be'}|null} null when neither byte order,
 *   or both about equally, read as text.
 */
function guessUtf16(input) {
  if (typeof TextDecoder !== 'function' || input.length < 2 || input.length % 2 !== 0 || !input.includes(0)) return null;
  const le = decodeUtf16Strict(input, 'utf-16le');
  const be = decodeUtf16Strict(input, 'utf-16be');
  // The wrong byte order of ordinary text is still well-formed UTF-16 (CJK and symbols),
  // so validity alone does not decide; the count of familiar characters does.
  const leScore = le == null ? -1 : familiarCharCount(le);
  const beScore = be == null ? -1 : familiarCharCount(be);
  // The winner must be mostly familiar text, and clearly ahead of the other byte order.
  const wins = (text, score, other) => score * 2 >= text.length && score >= other * 2 + 1;
  if (le != null && wins(le, leScore, beScore)) return { text: le, encoding: 'utf16le' };
  if (be != null && wins(be, beScore, leScore)) return { text: be, encoding: 'utf16be' };
  return null;
}

// ── Uncertain encodings (audit M7, decision D10) ───────────────────────────
// Bytes that are not valid UTF-8 used to be Windows-1256, always and silently: one bad
// byte in a UTF-8 note showed the whole note as mojibake. The decode now says when it is a
// guess (`uncertain`), and a document read with a guess is not written until the user has
// confirmed or changed the encoding (ipc-controller).

/**
 * How much of the high-byte content forms UTF-8 multi-byte sequences.
 * @returns {{valid:number, invalid:number}} sequences that are well-formed, and bytes
 *   >= 0x80 that belong to none.
 */
function utf8Profile(buf) {
  let valid = 0;
  let invalid = 0;
  let need = 0; // continuation bytes the open sequence still needs
  let seen = 0; // bytes of the open sequence so far
  for (const byte of buf) {
    if (need > 0) {
      if (byte >= 0x80 && byte <= 0xBF) {
        need -= 1;
        seen += 1;
        if (need === 0) { valid += 1; seen = 0; }
        continue;
      }
      invalid += seen; // the sequence broke off; this byte is looked at again below
      need = 0;
      seen = 0;
    }
    if (byte < 0x80) continue;
    if (byte >= 0xC2 && byte <= 0xDF) { need = 1; seen = 1; }
    else if (byte >= 0xE0 && byte <= 0xEF) { need = 2; seen = 1; }
    else if (byte >= 0xF0 && byte <= 0xF4) { need = 3; seen = 1; }
    else invalid += 1;
  }
  return { valid, invalid: invalid + seen };
}

/**
 * Bytes that are not valid UTF-8: Windows-1256 text, or UTF-8 text with damage?
 * Arabic in Windows-1256 is runs of bytes 0xC0-0xFF, which almost never line up as UTF-8
 * sequences (a letter before "،" or "؟" does), so invalid bytes far outnumber sequences.
 * Damaged UTF-8 is the reverse.
 */
function classifyInvalidUtf8(buf) {
  const { valid, invalid } = utf8Profile(buf);
  if (valid === 0 || invalid >= valid * 4) return { encoding: 'windows-1256', uncertain: false, invalidBytes: 0 };
  if (valid >= invalid * 4) return { encoding: 'utf8', uncertain: true, invalidBytes: invalid };
  return { encoding: 'windows-1256', uncertain: true, invalidBytes: 0 };
}

const REOPEN_ENCODINGS = ['utf8', 'windows-1256', 'utf16le', 'utf16be'];

/**
 * Decode with the encoding the user chose ("Reopen as…"), not a detected one.
 * @returns the decodeBuffer shape, or null when the bytes cannot be that encoding at all.
 */
function decodeBufferAs(input, encoding) {
  if (!Buffer.isBuffer(input) || !REOPEN_ENCODINGS.includes(encoding)) return null;
  if (encoding === 'windows-1256') {
    if (typeof TextDecoder !== 'function') return null;
    return { text: new TextDecoder('windows-1256').decode(input), encoding, bom: false, hashKey: input };
  }
  if (encoding === 'utf8') {
    const bom = input.length >= 3 && input[0] === 0xEF && input[1] === 0xBB && input[2] === 0xBF;
    const body = bom ? input.subarray(3) : input;
    const invalidBytes = isValidUtf8(body) ? 0 : Math.max(1, utf8Profile(body).invalid);
    // Bytes that are not UTF-8 become U+FFFD and are lost by the next save: still a guess.
    return { text: body.toString('utf8'), encoding, bom, hashKey: input, uncertain: invalidBytes > 0, invalidBytes };
  }
  if (input.length % 2 !== 0) return null; // UTF-16 is pairs of bytes
  const mark = encoding === 'utf16le' ? [0xFF, 0xFE] : [0xFE, 0xFF];
  const bom = input.length >= 2 && input[0] === mark[0] && input[1] === mark[1];
  const body = Buffer.from(bom ? input.subarray(2) : input);
  if (encoding === 'utf16be') body.swap16();
  return { text: body.toString('utf16le'), encoding, bom, hashKey: input };
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

function firstUnmappableWindows1256Char(text) {
  const map = cp1256Map();
  for (const ch of text) {
    if (ch.codePointAt(0) > 0x7F && !map.has(ch)) return ch;
  }
  return null;
}

function unmappableWindows1256Summary(text, maxSamples = 5) {
  const map = cp1256Map();
  const samples = [];
  let count = 0;
  for (const ch of text) {
    if (ch.codePointAt(0) > 0x7F && !map.has(ch)) {
      count += 1;
      if (samples.length < maxSamples && !samples.includes(ch)) samples.push(ch);
    }
  }
  return { count, samples };
}

/** Decode raw file bytes (or a legacy string from a mocked fs) into clean text. */
function decodeBuffer(input) {
  if (typeof input === 'string') {
    return { text: input, encoding: 'utf8', bom: hasBOM(input), hashKey: input };
  }
  if (!Buffer.isBuffer(input)) {
    const s = String(input == null ? '' : input);
    return { text: s, encoding: 'utf8', bom: hasBOM(s), hashKey: s };
  }
  if (input.length >= 2 && input[0] === 0xFF && input[1] === 0xFE) {
    return { text: input.toString('utf16le').slice(1), encoding: 'utf16le', bom: true, hashKey: input };
  }
  if (input.length >= 2 && input[0] === 0xFE && input[1] === 0xFF) {
    const swapped = swapBytes16(input);
    return { text: swapped.toString('utf16le').slice(1), encoding: 'utf16be', bom: true, hashKey: input };
  }
  if (input.length >= 3 && input[0] === 0xEF && input[1] === 0xBB && input[2] === 0xBF) {
    const body = input.slice(3);
    // A BOM alone proves nothing about the body: a half-converted legacy cp1256 file
    // also carries one. Trust UTF-8 only after validating the remaining bytes, else
    // decode the body as cp1256 (the BOM itself cannot survive that encoding).
    if (isValidUtf8(body)) {
      return { text: body.toString('utf8'), encoding: 'utf8', bom: true, hashKey: input };
    }
    // M7: either reading is a guess. Mostly UTF-8 → UTF-8 with the damage counted;
    // otherwise Windows-1256, as before.
    const kind = classifyInvalidUtf8(body);
    if (kind.encoding === 'utf8') {
      return { text: body.toString('utf8'), encoding: 'utf8', bom: true, hashKey: input, uncertain: true, invalidBytes: kind.invalidBytes };
    }
    if (typeof TextDecoder === 'function') {
      try {
        const text = new TextDecoder('windows-1256').decode(body);
        return { text, encoding: 'windows-1256', bom: false, hashKey: input, uncertain: true, invalidBytes: 0 };
      } catch (_) { /* fall through */ }
    }
  }
  // BOM-less UTF-16 (F7 residue): without this branch a UTF-16 file with its BOM
  // stripped decoded as mojibake cp1256/UTF-8 and the first save destroyed it.
  if (isUtf16Parity(input, 1)) {
    return { text: input.toString('utf16le'), encoding: 'utf16le', bom: false, hashKey: input };
  }
  if (isUtf16Parity(input, 0)) {
    const swapped = swapBytes16(input);
    return { text: swapped.toString('utf16le'), encoding: 'utf16be', bom: false, hashKey: input };
  }
  const utf16 = guessUtf16(input);
  if (utf16) return { text: utf16.text, encoding: utf16.encoding, bom: false, hashKey: input };
  const utf8 = input.toString('utf8');
  if (isValidUtf8(input)) {
    // M7: a NUL byte that did not read as UTF-16 either: the bytes are UTF-8, but text
    // does not hold NUL, so what this file is stays a guess.
    return input.includes(0)
      ? { text: utf8, encoding: 'utf8', bom: false, hashKey: input, uncertain: true, invalidBytes: 0 }
      : { text: utf8, encoding: 'utf8', bom: false, hashKey: input };
  }
  // Not valid UTF-8: Windows-1256 (the legacy Arabic codepage), or UTF-8 with damage (M7).
  const kind = classifyInvalidUtf8(input);
  if (kind.encoding === 'utf8') {
    return { text: utf8, encoding: 'utf8', bom: false, hashKey: input, uncertain: true, invalidBytes: kind.invalidBytes };
  }
  if (typeof TextDecoder === 'function') {
    try {
      const text = new TextDecoder('windows-1256').decode(input);
      return kind.uncertain
        ? { text, encoding: 'windows-1256', bom: false, hashKey: input, uncertain: true, invalidBytes: 0 }
        : { text, encoding: 'windows-1256', bom: false, hashKey: input };
    } catch (_) { /* fall through */ }
  }
  return { text: utf8, encoding: 'utf8', bom: false, hashKey: input };
}

/** Encode clean text back to the file's original encoding (BOM re-applied). */
function encodeBuffer(text, encoding, bom) {
  switch (encoding) {
    case 'utf16le': {
      const body = Buffer.from(text, 'utf16le');
      return bom ? Buffer.concat([Buffer.from([0xFF, 0xFE]), body]) : body;
    }
    case 'utf16be': {
      const body = swapBytes16(Buffer.from(text, 'utf16le'));
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

/** Hash of a file's content: raw bytes (Buffer), or a string taken as its UTF-8 bytes. */
function hashContent(content, crypto) {
  if (crypto && crypto.createHash) {
    return crypto.createHash('sha256').update(content).digest('hex');
  }
  // deterministic fallback hash, over the same bytes
  const bytes = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
  let h = 0;
  for (const byte of bytes) { h = (h * 31 + byte) >>> 0; }
  return String(h);
}

// ── Path guard (EC-A4) ─────────────────────────────────────────────────────
function isInsideRoot(absPath, root, path) {
  const rel = path.relative(root, absPath);
  return rel !== '' && !rel.split(path.sep).includes('..') && !path.isAbsolute(rel);
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

/**
 * Remove `<name>.tmp-<uuid>` siblings left behind by a crash between writeFileSync and
 * renameSync. Only files carrying this writer's exact random-UUID suffix qualify, and only
 * when older than maxAgeMs, so a concurrent writer's in-flight temp can never be swept.
 * @returns {number} count removed
 */
function sweepStaleTempFiles(fs, path, dir, { maxAgeMs = STALE_TEMP_AGE_MS, now = Date.now(), maxDepth = MAX_DEPTH } = {}) {
  // HYG-02: the sweep walks the same depth the vault read walks — notes live in
  // subdirectories (a 12-level walk), and a root-only listing never saw the crash
  // orphans beside the notes it exists to clean.
  let entries;
  try { entries = fs.readdirSync(dir); } catch (_) { return 0; }
  let removed = 0;
  for (const name of entries) {
    const full = path.join(dir, name);
    try {
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        if (maxDepth > 0) removed += sweepStaleTempFiles(fs, path, full, { maxAgeMs, now, maxDepth: maxDepth - 1 });
        continue;
      }
      if (!/\.tmp-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(name)) continue;
      if (!stat.isFile() || now - stat.mtimeMs < maxAgeMs) continue;
      fs.unlinkSync(full);
      removed++;
    } catch (_) { /* in use or already gone — leave it */ }
  }
  return removed;
}

function createDocumentStore({ fs, path, crypto } = {}) {
  /** The read result for decoded bytes: normalized body + the meta a faithful write needs. */
  function resultFromDecoded(dec, mtimeMs) {
    const meta = {
      bom: dec.bom,
      eol: detectEol(dec.text),
      eolMixed: hasMixedEol(dec.text),
      finalNewline: /[\r\n]$/.test(dec.text),
      encoding: dec.encoding,
      hash: hashContent(dec.hashKey, crypto),
      mtimeMs,
    };
    // M7: present only when the encoding is a guess the user has to confirm.
    if (dec.uncertain) {
      meta.encodingUncertain = true;
      meta.encodingInvalidBytes = dec.invalidBytes || 0;
    }
    return { content: normalize(dec.text), meta };
  }

  /** Build the read result from raw bytes (or a legacy mocked string). */
  function readFromRaw(absPath, raw) {
    return resultFromDecoded(decodeBuffer(raw), fs.statSync(absPath).mtimeMs);
  }

  /**
   * Read a file; return normalized body + meta needed for a faithful write.
   * `encoding` (M7) decodes with the encoding the user chose instead of detecting one;
   * the result is `{ error: 'encoding-mismatch' }` when the bytes cannot be that encoding.
   */
  function read(absPath, { encoding } = {}) {
    // v1.2: read BYTES so the encoding can be detected (a mocked fs that only serves
    // strings still works — decodeBuffer treats strings as UTF-8, as before).
    const raw = fs.readFileSync(absPath);
    if (encoding == null) return readFromRaw(absPath, raw);
    const dec = decodeBufferAs(raw, encoding);
    if (!dec) return { error: 'encoding-mismatch' };
    return resultFromDecoded(dec, fs.statSync(absPath).mtimeMs);
  }

  /**
   * Async read twin of read() so a vault walk never blocks the main event loop.
   * `knownStat` (from the walk's own lstat/stat) supplies mtimeMs without a second
   * syscall; absent one, a stat is attempted best-effort.
   */
  async function readAsync(absPath, knownStat = null) {
    if (fs.promises && typeof fs.promises.readFile === 'function') {
      const raw = await fs.promises.readFile(absPath);
      let mtimeMs;
      if (knownStat && typeof knownStat.mtimeMs === 'number') {
        mtimeMs = knownStat.mtimeMs;
      } else {
        try {
          const stat = typeof fs.promises.stat === 'function'
            ? await fs.promises.stat(absPath)
            : fs.statSync(absPath);
          mtimeMs = stat.mtimeMs;
        } catch (_) { /* optional metadata */ }
      }
      return resultFromDecoded(decodeBuffer(raw), mtimeMs);
    }
    return read(absPath);
  }

  /**
   * Atomically write `content`, preserving the original encoding, with a
   * conflict check against the last-known hash. `maxBytes` caps the bytes that reach the
   * disk, in the file's own encoding: a Windows-1256 note is one byte per Arabic letter on
   * disk but two in UTF-8, so a UTF-8 measure refused notes the app had just opened.
   * @returns {{ok:true, meta}}|{error}
   */
  function write(absPath, content, opts = {}) {
    const {
      root, baseHash, bom = false, eol = '\n', finalNewline = true, encoding = 'utf8', maxBytes = Infinity,
    } = opts;
    const validated = validateWriteTarget(fs, path, absPath, root);
    if (validated.error) return validated;

    // Conflict detection (EC-A2): the file changed since we last read it.
    // SEC-01 (2026-09-26): stat before hashing — a target swapped for a multi-GB file
    // was read whole here just to compute the conflict hash. Past the limit (or a stat that
    // fails on a file that exists) the copy on disk is not the one that was read.
    let onDisk = null; // the bytes this save replaces, once they are known to be the bytes that were read
    if (baseHash != null && fs.existsSync(absPath)) {
      let size = Infinity;
      try { size = fs.statSync(absPath).size; } catch (_) { /* unreadable — treated as changed below */ }
      // A target swapped for a file past the limit is not what was read: refuse, never overwrite.
      if (size > MAX_CONFLICT_HASH_BYTES) return { error: 'conflict' };
      onDisk = fs.readFileSync(absPath);
      if (hashContent(onDisk, crypto) !== baseHash) return { error: 'conflict' };
    }

    // Re-apply original encoding (EC-A1).
    let out;
    const diskText = onDisk == null ? '' : stripBOM(decodeBuffer(onDisk).text);
    if (hasMixedEol(diskText)) {
      // audit M5: one style cannot describe this file — keep each untouched line's ending.
      let body = content.replace(/\r\n?/g, '\n');
      if (finalNewline && !body.endsWith('\n')) body += '\n';
      out = applyEolPreserving(body, diskText, eol);
    } else {
      out = applyEol(content, eol);
      if (finalNewline && !out.endsWith(eol)) out += eol;
    }
    const eolMixed = hasMixedEol(out);
    let written;
    let hashKey;
    let size; // bytes that reach the disk: the renderer sets the note's size tier from it
    if (!encoding || encoding === 'utf8') {
      // UTF-8 keeps the legacy string-write path (BOM as the U+FEFF character).
      if (bom) out = '\uFEFF' + out;
      size = Buffer.byteLength(out, 'utf8');
      if (size > maxBytes) return { error: 'file-too-large' };
      written = atomicWriteFile(fs, absPath, out, 'utf8');
      hashKey = out;
    } else {
      if (encoding === 'windows-1256') {
        const unmappable = firstUnmappableWindows1256Char(out);
        if (unmappable) {
          const { count, samples } = unmappableWindows1256Summary(out);
          return { error: 'unmappable-character', char: unmappable, count, samples };
        }
      }
      // v1.2: UTF-16 / Windows-1256 go out as real bytes.
      const bytes = encodeBuffer(out, encoding, bom);
      size = bytes.length;
      if (size > maxBytes) return { error: 'file-too-large' };
      written = atomicWriteFile(fs, absPath, bytes);
      hashKey = bytes;
    }
    if (written.error) return written;
    let mtimeMs;
    try { mtimeMs = fs.statSync(absPath).mtimeMs; } catch (_) { /* optional metadata */ }
    return { ok: true, size, meta: { hash: hashContent(hashKey, crypto), bom, eol, eolMixed, finalNewline, encoding, mtimeMs } };
  }

  /**
   * H15 step 1: should this fs.watch event wake the renderer? A folder of notes is often a git
   * repo or has an editor/OS metadata directory; `git status` alone rewrites .git/index. Only
   * events that can change the NOTE LIST or a note's content count:
   *  - nothing inside .git, node_modules or any dot-directory, and no dot-directory itself;
   *  - a .md/.markdown file (a dot-file that is a note stays a note);
   *  - a directory created/removed/renamed ('rename' event on a path that is a directory now,
   *    or is gone and has no file extension) because its notes moved with it.
   */
  function isRelevantWatchEvent(root, eventType, rel) {
    const dirs = rel.split(/[\\/]/).filter(Boolean);
    const last = dirs.pop();
    if (last === undefined) return false;
    if (dirs.some((dir) => dir.startsWith('.') || dir === 'node_modules')) return false;
    if (/\.(md|markdown)$/i.test(last)) return true;
    if (last.startsWith('.') || last === 'node_modules') return false;
    if (eventType !== 'rename') return false;
    try {
      const st = fs.statSync(path.join(root, ...dirs, last));
      return typeof st.isDirectory === 'function' && st.isDirectory();
    } catch (_) {
      return !/\.[^.]+$/.test(last); // gone: a name without an extension may have been a folder
    }
  }

  /**
   * Watch `root` for external changes (T-B9). Coalesces the burst of events fs.watch
   * emits per save into a single debounced `cb({ files })` (trailing `debounceMs`, but never
   * later than `maxWaitMs` after the first event of the burst, so a steady stream of writes
   * cannot postpone the notification forever). Irrelevant events are dropped before they
   * touch the timer (H15). Returns a disposable. Degrades to a no-op where fs.watch is
   * unavailable or throws (e.g. EMFILE, or recursive watch unsupported on the platform).
   */
  function watch(root, cb, { debounceMs = 300, maxWaitMs = 2000 } = {}) {
    if (typeof fs.watch !== 'function') return { close() {} };
    let timer = null;
    let burstStartedAt = 0;
    let pending = new Set();
    function flush() {
      const files = [...pending];
      pending = new Set();
      timer = null;
      try { cb({ files }); } catch (_) { /* a renderer-notify error must never crash the watcher */ }
    }
    let watcher;
    try {
      watcher = fs.watch(root, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        const rel = String(filename);
        if (!isRelevantWatchEvent(root, eventType, rel)) return;
        pending.add(rel);
        const now = Date.now();
        if (timer) clearTimeout(timer); else burstStartedAt = now;
        timer = setTimeout(flush, Math.max(0, Math.min(debounceMs, burstStartedAt + maxWaitMs - now)));
      });
    } catch (_) {
      return { close() {} };
    }
    return { close() { if (timer) clearTimeout(timer); try { watcher.close(); } catch (_) { /* already gone */ } } };
  }

  return { read, readAsync, write, watch };
}

module.exports = {
  createDocumentStore,
  // pure helpers exported for unit testing
  hasBOM, stripBOM, detectEol, applyEol, hasMixedEol, applyEolPreserving, normalize, hashContent, isInsideRoot,
  validateWriteTarget, atomicWriteFile, sweepStaleTempFiles,
  decodeBuffer, decodeBufferAs, utf8Profile, REOPEN_ENCODINGS, encodeBuffer, encodeWindows1256, firstUnmappableWindows1256Char,
  unmappableWindows1256Summary,
  MAX_DEPTH,
};
