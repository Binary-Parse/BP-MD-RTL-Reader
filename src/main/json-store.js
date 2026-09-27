/**
 * json-store.js — the shared core of the JSON files main owns (T8.1).
 *
 * Two stores (annotations, reading stats) grew the same ~11 lines of load-and-persist code:
 * read + parse behind a version guard, and write through a temp file + rename so a crash can
 * never leave a half-written file. It is I/O-critical enough that one tested implementation
 * beats two copies, and the duplicated block was the only clone jscpd flagged in `src/main`.
 *
 * Both helpers deliberately take `fs` as a parameter (never require it) so unit tests drive
 * them with an in-memory fs, and both return null / a typed error instead of throwing — the
 * callers own their own defaults and rollback.
 */

'use strict';

const nodeCrypto = require('crypto');
const nodePath = require('path');

/**
 * Best-effort sweep of `<file>.tmp-<uuid>` siblings orphaned by a crash between the
 * temp write and the rename. Same max-age rule as document-store.sweepStaleTempFiles:
 * a concurrent writer's in-flight temp (or a fresh one from this very call) is never
 * touched. Failures are swallowed — the sweep must never block the real write.
 */
function sweepStaleJsonTemps(fs, file, { maxAgeMs = 60 * 60 * 1000, now = Date.now() } = {}) {
  let entries;
  let dir;
  try {
    dir = nodePath.dirname(file);
    entries = fs.readdirSync(dir);
  } catch (_) { return; }
  const prefix = `${nodePath.basename(file)}.tmp-`;
  for (const name of entries) {
    if (!name.startsWith(prefix)) continue;
    const full = nodePath.join(dir, name);
    try {
      const stat = fs.statSync(full);
      if (stat.isFile() && now - stat.mtimeMs >= maxAgeMs) fs.unlinkSync(full);
    } catch (_) { /* in use or already gone */ }
  }
}

/**
 * Write `data` to `file` atomically: temp file first, then rename onto the target.
 * @returns {{ok: true} | {error: 'write-failed'}}
 */
function atomicWriteJson(fs, file, data) {
  sweepStaleJsonTemps(fs, file);
  // S-M6 class hardening (mirrors document-store.atomicWriteFile): a predictable
  // `<file>.tmp` opened with the default flags follows a pre-planted symlink and
  // lets a same-user process steer the publish target. A random UUID name plus
  // O_EXCL ('wx') makes neither the squat nor the link possible.
  const tmp = `${file}.tmp-${nodeCrypto.randomUUID()}`;
  try {
    fs.writeFileSync(tmp, data, { encoding: 'utf8', flag: 'wx' });
    // T14 (post-review M1): flush the temp bytes BEFORE the rename publishes them. A process
    // crash was always safe (temp + rename), but without this an OS crash / power cut could
    // persist the rename ahead of the data and leave the store zero-length or torn — a silent
    // total loss of annotations or reading stats with no backup. Best-effort on injected test
    // fakes without openSync/fsyncSync; mirrors document-store.atomicWriteFile.
    if (fs.fsyncSync) {
      try { const fd = fs.openSync(tmp, 'r+'); fs.fsyncSync(fd); fs.closeSync(fd); } catch (_) { /* best effort */ }
    }
    fs.renameSync(tmp, file);
    return { ok: true };
  } catch (_) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) { /* best effort */ }
    return { error: 'write-failed' };
  }
}

/**
 * Read + parse `file`, returning the parsed value only when `isAcceptable` approves it.
 * A missing file, invalid JSON or an unexpected shape all degrade to null.
 * @param {object} fs injected fs
 * @param {string} file absolute path
 * @param {(parsed: any) => boolean} isAcceptable shape/version guard
 * @returns {any|null}
 */
function readJsonFile(fs, file, isAcceptable) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return isAcceptable(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

module.exports = { atomicWriteJson, readJsonFile, sweepStaleJsonTemps };
