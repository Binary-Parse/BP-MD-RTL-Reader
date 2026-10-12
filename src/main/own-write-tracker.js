'use strict';

/**
 * own-write-tracker.js — H15 step 2: do not tell the renderer about changes the app made itself.
 *
 * Every save the app performs makes the OS emit several file events, and each one used to cost a
 * full re-read of the vault. The write handler records `path -> hash of what it wrote`; the
 * watcher asks `isOwnWrite(path, readCurrentHash)` before forwarding an event.
 *
 * DATA-INTEGRITY RULE: an external edit must NEVER be hidden. An event is "ours" only when ALL of
 * these hold:
 *   1. we recorded a write for exactly this path, and the record is not older than `ttlMs`;
 *   2. the file's content hash RIGHT NOW equals the hash we recorded.
 * Timestamps are used only to forget old records, never to decide that something is ours.
 * Anything that does not match (different bytes, unreadable file, expired record) is reported,
 * and a mismatch also deletes the record, so a file that was edited externally and later
 * changed back to the bytes we once wrote is still reported (the renderer has moved on).
 */

/**
 * @param {object} [options]
 * @param {() => number} [options.now] - clock (injectable)
 * @param {number} [options.ttlMs] - how long a record stays valid; covers debounce + max-wait
 * @param {number} [options.maxEntries] - memory bound; the oldest record is forgotten first (expired
 *   records are always the oldest, so they leave first)
 * @param {object} [options.path] - path module (injectable)
 * @param {string} [options.platform] - process.platform (decides path case sensitivity)
 */
function createOwnWriteTracker({
  now = Date.now,
  ttlMs = 10000,
  maxEntries = 256,
  path = require('path'),
  platform = process.platform,
} = {}) {
  const records = new Map(); // key -> { hash, writtenAt }

  function keyOf(absPath) {
    const resolved = path.resolve(absPath);
    return platform === 'win32' ? resolved.toLowerCase() : resolved;
  }
  function expired(record) {
    return now() - record.writtenAt > ttlMs;
  }

  function record(absPath, hash) {
    if (typeof absPath !== 'string' || absPath === '' || typeof hash !== 'string' || hash === '') return;
    const key = keyOf(absPath);
    records.delete(key); // re-insert so Map order is "oldest write first"
    records.set(key, { hash, writtenAt: now() });
    while (records.size > maxEntries) records.delete(records.keys().next().value);
  }

  function isOwnWrite(absPath, readCurrentHash) {
    if (typeof absPath !== 'string') return false;
    const key = keyOf(absPath);
    const entry = records.get(key);
    if (!entry) return false;
    if (expired(entry)) {
      records.delete(key);
      return false;
    }
    let current = null;
    try { current = readCurrentHash(); } catch (_) { /* unreadable (or no reader): not ours */ }
    if (current === entry.hash) return true;
    records.delete(key);
    return false;
  }

  return { record, isOwnWrite };
}

module.exports = { createOwnWriteTracker };
