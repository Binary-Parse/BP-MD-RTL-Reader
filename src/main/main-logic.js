/**
 * Pure, testable business logic extracted from src/main/index.js.
 * No Electron dependencies — can be unit-tested in Node.js.
 */

const { fileURLToPath } = require('url');

// ── Note size tiers (large-file mode) — the ONE source of truth for every size number. ──
// The renderer receives these through the `app:limits` channel (see getLimits() below); its
// own fallback copy (src/renderer/components/large-file.js) is pinned to them by a unit test.
//   <= LARGE_NOTE_BYTES            opens as before
//   <= CONFIRM_NOTE_BYTES          opens; the user is told once the note is large
//   <= MAX_FILE_BYTES              asks first, then opens in large-file mode
//   >  MAX_FILE_BYTES              refused (open and save alike)
const MIB = 1024 * 1024;
const LARGE_NOTE_BYTES = 5 * MIB;
const CONFIRM_NOTE_BYTES = 20 * MIB;
const MAX_FILE_BYTES = 100 * MIB;
const MAX_OPEN_FILE_BYTES = MAX_FILE_BYTES;
// A folder read sends every note's text to the renderer at once, with no per-note question, so
// a note the single-file lane would ask about (above CONFIRM_NOTE_BYTES) is skipped there and
// opened on its own with Open File. The folder total stays at 100 MiB: it bounds renderer
// memory (a JS string is up to two bytes per character), and it still fits five 20 MiB notes.
const MAX_VAULT_FILE_BYTES = CONFIRM_NOTE_BYTES;
const MAX_CUMULATIVE_BYTES = 100 * MIB;
const MAX_FILES_PER_DIR = 5000;

// Export ceilings, enforced in main. PDF: the print window lays the whole HTML out, so it is
// the tightest. HTML: a plain file write, but images are inlined. EPUB: an opaque archive.
const MAX_PDF_EXPORT_BYTES = 64 * MIB;
const MAX_HTML_EXPORT_BYTES = 256 * MIB;
const MAX_EPUB_BYTES = 64 * MIB;
// Export timeouts for the print window: 30 s + 10 s per MiB of HTML, at most 5 minutes. A
// small note keeps today's 30 s. The slope comes from a layout rate of roughly 0.2-0.5 MiB/s
// on a modest laptop, with 2-3x headroom; the ceiling stops a stuck print from hanging forever.
const PDF_TIMEOUT_BASE_MS = 30000;
const PDF_TIMEOUT_PER_MIB_MS = 10000;
const PDF_TIMEOUT_MAX_MS = 5 * 60 * 1000;
// Above this many bytes of export HTML the renderer says "large export, may take a while".
const LARGE_EXPORT_BYTES = 5 * MIB;

/** @param {number} htmlBytes @returns {number} milliseconds the print window may take */
function pdfTimeoutMs(htmlBytes) {
  const mib = Math.max(0, Number(htmlBytes) || 0) / MIB;
  return Math.min(PDF_TIMEOUT_MAX_MS, Math.floor(PDF_TIMEOUT_BASE_MS + PDF_TIMEOUT_PER_MIB_MS * mib));
}

/** The numbers the renderer needs, as plain data for the `app:limits` channel. */
function getLimits() {
  return {
    largeNoteBytes: LARGE_NOTE_BYTES,
    confirmNoteBytes: CONFIRM_NOTE_BYTES,
    maxFileBytes: MAX_FILE_BYTES,
    maxVaultFileBytes: MAX_VAULT_FILE_BYTES,
    maxPdfExportBytes: MAX_PDF_EXPORT_BYTES,
    maxHtmlExportBytes: MAX_HTML_EXPORT_BYTES,
    maxEpubBytes: MAX_EPUB_BYTES,
    largeExportBytes: LARGE_EXPORT_BYTES,
  };
}

/**
 * Which tier an on-disk size falls in: 'normal' | 'large' | 'confirm' | 'refused'.
 * @param {number} bytes
 */
function noteSizeTier(bytes) {
  if (bytes > MAX_FILE_BYTES) return 'refused';
  if (bytes > CONFIRM_NOTE_BYTES) return 'confirm';
  if (bytes > LARGE_NOTE_BYTES) return 'large';
  return 'normal';
}

/**
 * H14: Linux desktop entries end in "%U", so a file manager's "Open with" passes a
 * `file://` URL instead of a path. Turn such an argument into a plain path so the existing
 * extension / network-path / realpath / size checks run on the real path. Anything that is
 * not a string or does not START with `file://` is returned unchanged. A URL Node cannot
 * convert (malformed, remote host on posix, encoded separator) yields null, which the callers'
 * `typeof === 'string'` filter drops. On Windows a host in the URL becomes a UNC path, which
 * isNetworkPath then rejects.
 * @param {*} arg
 * @param {boolean} [windows] - force Windows/posix conversion (tests); default = host platform
 * @returns {*}
 */
function fileArgToPath(arg, windows = process.platform === 'win32') {
  if (typeof arg !== 'string' || !/^file:\/\//i.test(arg)) return arg;
  try {
    return fileURLToPath(arg, { windows });
  } catch (_) {
    return null;
  }
}

/**
 * Extract the first valid markdown file path from process.argv.
 * @param {string[]} argv
 * @param {object} fs - fs module (injected for testability)
 * @returns {string|null}
 */
function parseFileArg(argv, fs) {
  // Array.from normalises array-like objects (e.g. Electron second-instance
  // argv); honours .length so out-of-bounds indices are not visited.
  const candidates = Array.from(argv).slice(1).map(a => fileArgToPath(a)).filter(a =>
    typeof a === 'string' &&
    !a.startsWith('-') &&
    !isNetworkPath(a) &&
    /\.(md|markdown)$/i.test(a)
  );
  for (const a of candidates) {
    try {
      const real = fs.realpathSync(a);
      const stat = fs.statSync(real);
      // Any size is returned: a note past the open limit (or one that needs the large-file
      // question) is answered by the delivery step with a message the user can see, instead
      // of "Open with" silently doing nothing.
      if (stat.isFile()) return real;
    } catch (_) { /* try next candidate */ }
  }
  return null;
}

/**
 * v1.2: every valid markdown file path from argv, in order (deduplicated). "Open
 * with" on several selected files used to open exactly the first one. parseFileArg
 * stays for compatibility (and keeps returning the first match).
 * @param {string[]} argv
 * @param {object} fs
 * @returns {string[]}
 */
function parseFileArgs(argv, fs) {
  const candidates = Array.from(argv).slice(1).map(a => fileArgToPath(a)).filter(a =>
    typeof a === 'string' &&
    !a.startsWith('-') &&
    !isNetworkPath(a) &&
    /\.(md|markdown)$/i.test(a)
  );
  const out = [];
  const seen = new Set();
  let cumulativeBytes = 0;
  for (const a of candidates) {
    // Same two batch caps readVault enforces: an "Open With" selection of thousands of
    // files (or a second-instance launch) must not read an unbounded payload into main.
    if (isTooManyFiles(out.length + 1)) break;
    try {
      const real = fs.realpathSync(a);
      if (seen.has(real)) continue;
      const stat = fs.statSync(real);
      if (stat.isFile()) {
        // Only a note that is read straight away counts toward the batch cap: one above the
        // confirm size is answered with a question or a refusal, without reading its bytes.
        if (stat.size <= CONFIRM_NOTE_BYTES) {
          if (wouldExceedCumulative(cumulativeBytes, stat.size)) break;
          cumulativeBytes += stat.size;
        }
        seen.add(real);
        out.push(real);
      }
    } catch (_) { /* try next candidate */ }
  }
  return out;
}

/**
 * H13 (macOS): `open-file` can fire BEFORE `ready` and queue a path; the later argv parse
 * must ADD to that queue, not replace it. Order is kept (queued first), duplicates dropped,
 * and the batch stays under the same read cap the second-instance path enforces.
 * @param {string[]} pending - already queued paths
 * @param {string[]} incoming - newly parsed paths
 * @returns {string[]}
 */
function mergePendingFiles(pending, incoming) {
  return Array.from(new Set([...pending, ...incoming])).slice(0, MAX_FILES_PER_DIR);
}

// ==== SECURITY CHECKS (JB1-JB4) ====

/**
 * JB1: Path allowlist check.
 * @param {string} folderPath
 * @param {Set<string>} allowedFolders
 * @returns {boolean}
 */
function isAuthorizedPath(folderPath, allowedFolders) {
  return allowedFolders.has(folderPath);
}

/**
 * JB2: Reject UNC/network paths.
 * @param {string} folderPath
 * @returns {boolean} true if path is a network path
 */
function isNetworkPath(folderPath) {
  return folderPath.startsWith('\\\\') || folderPath.startsWith('//');
}

/**
 * JB3: Check if directory has too many files.
 * @param {number} count
 * @returns {boolean}
 */
function isTooManyFiles(count) {
  return count > MAX_FILES_PER_DIR;
}

/**
 * JB3: Check if single file exceeds size cap.
 * @param {number} size
 * @returns {boolean}
 */
function isOversizedFile(size) {
  return size > MAX_FILE_BYTES;
}

/**
 * JB3: Check if cumulative size would exceed cap after adding file.
 * @param {number} cumulativeBytes
 * @param {number} fileSize
 * @returns {boolean}
 */
function wouldExceedCumulative(cumulativeBytes, fileSize) {
  return cumulativeBytes + fileSize > MAX_CUMULATIVE_BYTES;
}

/**
 * JB4: Check if a symlink resolves outside its containing folder.
 * @param {string} realPath - resolved real path of the symlink
 * @param {string} folderPath - containing folder
 * @param {object} path - path module (injected for testability)
 * @returns {boolean} true if symlink escapes the folder
 */
function isSymlinkEscape(realPath, folderPath, path) {
  const rel = path.relative(folderPath, realPath);
  if (path.isAbsolute(rel)) return true;
  return rel.split(path.sep).includes('..');
}

/**
 * Filter markdown files from directory entries and sort by localeCompare.
 * @param {Array<{name:string, isFile:()=>boolean, isSymbolicLink:()=>boolean}>} entries
 * @returns {string[]}
 */
function filterAndSortMdFiles(entries) {
  return entries
    .filter(e => {
      // Split to give v8 distinct branch counters per clause.
      if (!e.isFile() && !e.isSymbolicLink()) return false;
      return /\.(md|markdown)$/i.test(e.name);
    })
    .map(e => e.name)
    .sort((a, b) => a.localeCompare(b));
}

// ── File-type predicate (T-B10) ────────────────────────────────────────────
// A note is a .md or .markdown file. (Drag-drop also takes .txt: renderer file-predicates.js.)
function isVaultFile(name) {
  return typeof name === 'string' && /\.(md|markdown)$/i.test(name);
}

/**
 * T-F19: does argv ask for the chrome-visibility escape hatch?
 *
 * A window with the title bar auto-hidden has no menus and no window controls, so every
 * other recovery path lives in the renderer. This is the one the main process owns:
 * `"BP MD RTL Reader.exe" --reset-chrome` clears both flags before the window is created.
 *
 * Exact match only — `--reset-chrome=1` and `-reset-chrome` are not it. argv[0] is the
 * executable and is skipped, matching parseFileArg.
 *
 * @param {string[]} argv
 * @returns {boolean}
 */
function shouldResetChrome(argv) {
  return Array.from(argv || []).slice(1).some(a => a === '--reset-chrome');
}

module.exports = {
  parseFileArg,
  parseFileArgs,
  fileArgToPath,
  mergePendingFiles,
  shouldResetChrome,
  isVaultFile,
  isAuthorizedPath,
  isNetworkPath,
  isTooManyFiles,
  isOversizedFile,
  wouldExceedCumulative,
  isSymlinkEscape,
  filterAndSortMdFiles,
  noteSizeTier,
  getLimits,
  pdfTimeoutMs,
  MIB,
  LARGE_NOTE_BYTES,
  CONFIRM_NOTE_BYTES,
  MAX_OPEN_FILE_BYTES,
  MAX_FILES_PER_DIR,
  MAX_FILE_BYTES,
  MAX_VAULT_FILE_BYTES,
  MAX_CUMULATIVE_BYTES,
  MAX_PDF_EXPORT_BYTES,
  MAX_HTML_EXPORT_BYTES,
  MAX_EPUB_BYTES,
  LARGE_EXPORT_BYTES,
  PDF_TIMEOUT_BASE_MS,
  PDF_TIMEOUT_PER_MIB_MS,
  PDF_TIMEOUT_MAX_MS,
};
