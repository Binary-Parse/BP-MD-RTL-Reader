/**
 * atomic-rename.js — the one atomic writer main uses for notes, exports and its own JSON
 * files (MAIN-4): write a temp file, flush it, then rename it onto the target, and try the
 * rename again when the target is held for a moment (audit M14).
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

const nodeCrypto = require('crypto');

const RETRY_DELAYS_MS = [20, 50, 100, 200];
// A temp file older than this was orphaned by a crash between its write and its rename;
// every sweeper uses the same age, so a writer's in-flight temp is never swept.
const STALE_TEMP_AGE_MS = 60 * 60 * 1000;
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

/**
 * Atomically replace a destination with text or binary data.
 * @returns {{ok:true}|{error:'locked'|'enospc'|'gone'|'write-failed'}} `locked`: the target
 *   stayed held by another program (or is read-only) through every retry (audit M14).
 */
function atomicWriteFile(fs, absPath, data, encoding, { sleep } = {}) {
  const tmp = `${absPath}.tmp-${nodeCrypto.randomUUID()}`;
  let mode = null;
  try {
    const stat = fs.statSync(absPath);
    if (stat && typeof stat.mode === 'number') mode = stat.mode & 0o7777;
  } catch (_) { /* new file — default mode */ }
  try {
    const options = encoding === undefined ? { flag: 'wx' } : { encoding, flag: 'wx' };
    fs.writeFileSync(tmp, data, options);
    if (fs.fsyncSync) {
      try { const fd = fs.openSync(tmp, 'r+'); fs.fsyncSync(fd); fs.closeSync(fd); } catch (_) { /* best effort */ }
    }
    // Re-apply the target's mode so a 0600 note does not widen to the umask default via
    // the fresh temp file. On Windows chmod only toggles the read-only bit (the rename
    // below tolerates it); a failed chmod is best-effort and never blocks the write.
    if (mode != null && typeof fs.chmodSync === 'function') {
      try { fs.chmodSync(tmp, mode); } catch (_) { /* best effort */ }
    }
    renameWithRetry(fs, tmp, absPath, sleep ? { sleep } : undefined);
    return { ok: true };
  } catch (e) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
    if (isLockError(e)) return { error: 'locked' };
    if (e && e.code === 'ENOSPC') return { error: 'enospc' };
    if (e && e.code === 'ENOENT') return { error: 'gone' };
    return { error: 'write-failed' };
  }
}

module.exports = { atomicWriteFile, renameWithRetry, isLockError, RETRY_DELAYS_MS, STALE_TEMP_AGE_MS };
