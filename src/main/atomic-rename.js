/**
 * atomic-rename.js — the last step of every atomic write: rename the finished temp file
 * onto its target, and try again when the target is held for a moment (audit M14).
 *
 * On Windows a file that another process has open cannot be replaced: antivirus, a sync
 * client (OneDrive, Dropbox) or the search indexer hold a note for a few milliseconds
 * right after it changes, and the rename fails with EPERM, EBUSY or EACCES. One attempt
 * turned that moment into a failed save. The rename is retried a few times over at most
 * 370 ms; only then is the file reported as locked.
 *
 * The wait is synchronous because the writers are (writeFileSync, renameSync): it blocks
 * the main process, but only after a rename has already failed, and for a bounded time.
 * `fs` and `sleep` are parameters so unit tests drive this with fakes and without waiting.
 */

const RETRY_DELAYS_MS = [20, 50, 100, 200];
const LOCK_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);

/** True for the errors a held (or read-only) target gives. */
function isLockError(error) {
  return !!error && LOCK_CODES.has(error.code);
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * fs.renameSync with retries on a held target. Throws the last error when it does not
 * succeed; any other error is thrown at once.
 */
function renameWithRetry(fs, from, to, { sleep = sleepSync } = {}) {
  let attempt = 0;
  for (;;) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (error) {
      if (!isLockError(error) || attempt >= RETRY_DELAYS_MS.length) throw error;
      sleep(RETRY_DELAYS_MS.at(attempt));
      attempt += 1;
    }
  }
}

module.exports = { renameWithRetry, isLockError, RETRY_DELAYS_MS };
