/**
 * annotations-store.js — highlights + margin notes, owned by main (T5.1a).
 *
 * Storage: <userData>/annotations.json
 *   { version: 1, docs: { "<fileKey>": { highlights: [{ id, text, note, at,
 *                                                     anchor: { headingSlug, ordinal } }] } } }
 *
 * Deliberately on the settings.js pattern: fs injected (so unit tests drive it with an
 * in-memory fs), atomic tmp+rename save, strict validation, and a corrupt file degrading to
 * "no annotations" rather than throwing. The channel carries TEXT ONLY — no paths, no
 * authority — so storing annotations never widens the capability model.
 *
 * The in-memory map is a Map, not an object keyed by the renderer's docKey: a dynamic
 * `obj[var]` is both a prototype-pollution foot-gun and a security-lint finding.
 */

'use strict';

const { atomicWriteJson, readJsonFile } = require('./json-store');

const ANNOTATIONS_VERSION = 1;
const MAX_HIGHLIGHTS_PER_DOC = 500;
const MAX_DOC_KEY = 512;
const MAX_TEXT = 5000;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024;

function validText(value, max = MAX_TEXT) {
  return typeof value === 'string' && value.length <= max;
}

/** One highlight, or null when it cannot be trusted. `text` is what gets re-anchored. */
function sanitizeHighlight(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!validText(raw.id, 128) || raw.id === '') return null;
  if (!validText(raw.text) || raw.text === '') return null;
  // A note is optional, but a note that IS present must be valid — coercing it to '' would
  // silently bin the user's margin note.
  const note = raw.note === undefined || raw.note === null
    ? ''
    : (validText(raw.note) ? raw.note : null);
  if (note === null) return null;
  const at = typeof raw.at === 'number' && Number.isFinite(raw.at) && raw.at > 0 ? raw.at : null;
  if (at == null) return null;
  const anchor = raw.anchor && typeof raw.anchor === 'object' ? raw.anchor : {};
  const headingSlug = validText(anchor.headingSlug, MAX_DOC_KEY) ? anchor.headingSlug : '';
  const ordinal = Number.isInteger(anchor.ordinal) && anchor.ordinal >= 0 ? anchor.ordinal : 0;
  return { id: raw.id, text: raw.text, note, at, anchor: { headingSlug, ordinal } };
}

function sanitizeHighlights(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(sanitizeHighlight)
    .filter(Boolean)
    .slice(0, MAX_HIGHLIGHTS_PER_DOC);
}

function createAnnotationsStore({ fs, path, userDataDir, maxBytes = MAX_TOTAL_BYTES } = {}) {
  const file = path.join(userDataDir, 'annotations.json');
  /** @type {Map<string, {highlights: object[]}>} */
  let docs = new Map();
  let loaded = false;

  function load() {
    if (loaded) return { version: ANNOTATIONS_VERSION, docs };
    loaded = true;
    // Missing/corrupt/foreign-version all degrade to "no annotations" (never throw here).
    const parsed = readJsonFile(
      fs,
      file,
      (value) => value && value.version === ANNOTATIONS_VERSION
        && value.docs && typeof value.docs === 'object',
    );
    if (parsed) {
      for (const [key, value] of Object.entries(parsed.docs)) {
        if (!validText(key, MAX_DOC_KEY) || key === '') continue;
        const highlights = sanitizeHighlights(value && value.highlights);
        if (highlights.length) docs.set(key, { highlights });
      }
    }
    return { version: ANNOTATIONS_VERSION, docs };
  }

  function serialize() {
    return JSON.stringify({
      version: ANNOTATIONS_VERSION,
      docs: Object.fromEntries(docs),
    });
  }

  function persist() {
    const data = serialize();
    if (Buffer.byteLength(data, 'utf8') > maxBytes) return { error: 'too-large' };
    return atomicWriteJson(fs, file, data);
  }

  /** Highlights for one document (never throws; an unknown key is simply empty). */
  function get(docKey) {
    if (!validText(docKey, MAX_DOC_KEY) || docKey === '') return { error: 'invalid-key' };
    load();
    const record = docs.get(docKey);
    return { highlights: record ? record.highlights.map((h) => ({ ...h, anchor: { ...h.anchor } })) : [] };
  }

  /** Replace one document's highlight list. Returns {ok, count} or a typed error. */
  function put(docKey, highlights) {
    if (!validText(docKey, MAX_DOC_KEY) || docKey === '') return { error: 'invalid-key' };
    if (!Array.isArray(highlights)) return { error: 'invalid-highlights' };
    // Anything the renderer sends must be fully valid: a silently dropped highlight would
    // look like "my highlight vanished", so a malformed payload is refused as a whole.
    const cleaned = highlights.map(sanitizeHighlight);
    if (cleaned.some((entry) => entry === null)) return { error: 'invalid-highlight' };
    if (cleaned.length > MAX_HIGHLIGHTS_PER_DOC) return { error: 'too-many' };

    load();
    const previous = docs.get(docKey);
    if (cleaned.length === 0) docs.delete(docKey);
    else docs.set(docKey, { highlights: cleaned });

    const result = persist();
    if (result.error) { // roll back so memory and disk cannot disagree
      if (previous) docs.set(docKey, previous);
      else docs.delete(docKey);
      return result;
    }
    return { ok: true, count: cleaned.length };
  }

  /**
   * Drop annotation keys whose identity is no longer known to the registry (DATA-01):
   * `doc:<id>` keys whose capability id is unknown (vault-read grants are sessionOnly, so
   * their ids rotate every launch), and — when a vault allowlist is supplied — `vault:<id>
   * <path>` keys whose vault grant was pruned (bootstrapSessionGrants drops vaults settings
   * no longer reference; a reopened folder mints a NEW vault id, so the old key can never
   * resolve again and only counts toward the 2 MiB store cap). `loose:` keys are user-visible
   * stable paths and are always kept. Persists atomically; on a persist error the in-memory
   * deletion rolls back so memory matches disk.
   * @param {Iterable<string>} validDocIds capability ids that can still be resolved
   * @param {Iterable<string>=} validVaultIds vault capability ids; when omitted, the vault
   *   namespace is left untouched (single-arg callers keep the historical behavior)
   */
  function pruneOrphanDocKeys(validDocIds, validVaultIds) {
    load();
    const keep = new Set(validDocIds || []);
    const keepVaults = validVaultIds == null ? null : new Set(validVaultIds);
    const removed = [];
    for (const key of docs.keys()) {
      if (key.startsWith('doc:')) {
        if (!keep.has(key.slice(4))) removed.push(key);
      } else if (keepVaults && key.startsWith('vault:')) {
        const space = key.indexOf(' ');
        if (!keepVaults.has(space > 5 ? key.slice(6, space) : '')) removed.push(key);
      }
    }
    if (!removed.length) return { pruned: 0 };
    const backup = removed.map((key) => [key, docs.get(key)]);
    for (const key of removed) docs.delete(key);
    const result = persist();
    if (result.error) {
      for (const [key, value] of backup) docs.set(key, value);
      return result;
    }
    return { pruned: removed.length };
  }

  return {
    ANNOTATIONS_VERSION,
    MAX_HIGHLIGHTS_PER_DOC,
    MAX_TOTAL_BYTES,
    file,
    load,
    get,
    put,
    pruneOrphanDocKeys,
    sizeInBytes: () => Buffer.byteLength(serialize(), 'utf8'),
  };
}

module.exports = {
  ANNOTATIONS_VERSION,
  MAX_HIGHLIGHTS_PER_DOC,
  MAX_DOC_KEY,
  MAX_TEXT,
  MAX_TOTAL_BYTES,
  sanitizeHighlight,
  sanitizeHighlights,
  createAnnotationsStore,
};
