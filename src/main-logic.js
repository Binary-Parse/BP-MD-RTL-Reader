/**
 * Pure, testable business logic extracted from main.js.
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
    /\.(md|markdown|txt)$/i.test(a)
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

module.exports = {
  parseFileArg,
  isVaultFile,
  isDroppableFile,
  isAuthorizedPath,
  isNetworkPath,
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
