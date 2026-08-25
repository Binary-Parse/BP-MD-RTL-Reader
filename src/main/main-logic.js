/**
 * Pure, testable business logic extracted from src/main/index.js.
 * No Electron dependencies — can be unit-tested in Node.js.
 */

const MAX_OPEN_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILES_PER_DIR = 5000;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_CUMULATIVE_BYTES = 100 * 1024 * 1024;

/**
 * Extract the first valid markdown file path from process.argv.
 * @param {string[]} argv
 * @param {object} fs - fs module (injected for testability)
 * @returns {string|null}
 */
function parseFileArg(argv, fs) {
  // Array.from normalises array-like objects (e.g. Electron second-instance
  // argv); honours .length so out-of-bounds indices are not visited.
  const candidates = Array.from(argv).slice(1).filter(a =>
    typeof a === 'string' &&
    !a.startsWith('-') &&
    !isNetworkPath(a) &&
    /\.(md|markdown)$/i.test(a)
  );
  for (const a of candidates) {
    try {
      const real = fs.realpathSync(a);
      const stat = fs.statSync(real);
      if (stat.isFile() && stat.size <= MAX_OPEN_FILE_BYTES) return real;
    } catch (_) { /* try next candidate */ }
  }
  return null;
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
 * Legacy path collectors kept for unit tests. Runtime FS authority is the
 * capability registry (opaque vaultId/documentId); settings.migrate() does not
 * persist lastSession.vaultPath or recents[].vaultRoot/abs. Network paths are
 * excluded (JB2). Returns a de-duplicated array of non-empty string paths.
 * @param {object} settings
 * @returns {string[]}
 */
function collectAuthorizedFolders(settings) {
  if (!settings || typeof settings !== 'object') return [];
  const out = [];
  const add = (p) => {
    if (typeof p === 'string' && p && !isNetworkPath(p) && !out.includes(p)) out.push(p);
  };
  if (settings.lastSession && typeof settings.lastSession === 'object') add(settings.lastSession.vaultPath);
  if (Array.isArray(settings.recents)) {
    for (const r of settings.recents) {
      if (r && typeof r === 'object') add(r.vaultRoot);
    }
  }
  return out;
}

/**
 * Legacy single-file path collector (see collectAuthorizedFolders). Unused at
 * runtime. Network paths are excluded (JB2).
 * @param {object} settings
 * @returns {string[]}
 */
function collectAuthorizedFiles(settings) {
  if (!settings || typeof settings !== 'object') return [];
  const out = [];
  if (Array.isArray(settings.recents)) {
    for (const r of settings.recents) {
      if (r && typeof r === 'object' && typeof r.abs === 'string' && r.abs && !isNetworkPath(r.abs) && !out.includes(r.abs)) {
        out.push(r.abs);
      }
    }
  }
  return out;
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
  return rel.startsWith('..') || path.isAbsolute(rel);
}

/**
 * Strip UTF-8 BOM if present.
 * @param {string} content
 * @returns {string}
 */
function stripBOM(content) {
  if (content.charCodeAt(0) === 0xFEFF) {
    return content.slice(1);
  }
  return content;
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

// ── File-type predicates (T-B10) ───────────────────────────────────────────
// Single source of truth so the vault filter and drag-drop agree on extensions.
// Vault = notes only (.md/.markdown); drag-drop additionally accepts .txt.
function isVaultFile(name) {
  return typeof name === 'string' && /\.(md|markdown)$/i.test(name);
}
function isDroppableFile(name) {
  return typeof name === 'string' && /\.(md|markdown|txt)$/i.test(name);
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
  shouldResetChrome,
  isVaultFile,
  isDroppableFile,
  isAuthorizedPath,
  isNetworkPath,
  collectAuthorizedFolders,
  collectAuthorizedFiles,
  isTooManyFiles,
  isOversizedFile,
  wouldExceedCumulative,
  isSymlinkEscape,
  stripBOM,
  filterAndSortMdFiles,
  MAX_OPEN_FILE_BYTES,
  MAX_FILES_PER_DIR,
  MAX_FILE_BYTES,
  MAX_CUMULATIVE_BYTES,
};
