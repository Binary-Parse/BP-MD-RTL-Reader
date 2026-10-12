/**
 * annotations-store.js — highlights + margin notes, owned by main (T5.1a).
 *
 * Storage: <userData>/annotations.json
 *   { version: 1, docs: { "<fileKey>": { highlights: [{ id, text, note, at,
 *                                                     anchor: { headingSlug, ordinal } }] } } }
 *
 * Deliberately on the settings.js pattern: fs injected (so unit tests drive it with an
 * in-memory fs), atomic tmp+rename save, strict validation, and a corrupt file degrading to
 * "no annotations" rather than throwing — the corrupt file itself is kept beside the new one
 * as `annotations.json.corrupt-<timestamp>`. The channel carries TEXT ONLY — no paths, no
 * authority — so storing annotations never widens the capability model.
 *
 * The in-memory map is a Map, not an object keyed by the renderer's docKey: a dynamic
 * `obj[var]` is both a prototype-pollution foot-gun and a security-lint finding.
 */

'use strict';

const { atomicWriteJson, readJsonFileChecked, setAsideCorruptFile } = require('./json-store');

const ANNOTATIONS_VERSION = 1;
const MAX_HIGHLIGHTS_PER_DOC = 500;
const MAX_DOC_KEY = 512;
const MAX_TEXT = 5000; // the renderer refuses a longer highlight up front: HIGHLIGHT_MAX_TEXT in app.js
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

function createAnnotationsStore({ fs, path, userDataDir, maxBytes = MAX_TOTAL_BYTES, now = Date.now } = {}) {
  const file = path.join(userDataDir, 'annotations.json');
  /** @type {Map<string, {highlights: object[]}>} */
  let docs = new Map();
  let loaded = false;
  let status = null;       // what the first read found: ok | missing | corrupt | unreadable
  let writable = true;     // false while a damaged file still sits at `file` (B3)

  function load() {
    if (loaded) return { version: ANNOTATIONS_VERSION, docs };
    loaded = true;
    // Missing/corrupt/foreign-version all degrade to "no annotations" (never throw here).
    const read = readJsonFileChecked(
      fs,
      file,
      (value) => value && value.version === ANNOTATIONS_VERSION
        && value.docs && typeof value.docs === 'object',
    );
    status = read.status;
    // B3: a damaged file (torn, or written by a newer version) is moved aside before any save
    // can replace it. If it cannot be moved, or cannot even be read, saving is refused: an
    // empty list on screen is recoverable, an overwritten file is not.
    if (status === 'corrupt') writable = setAsideCorruptFile(fs, file, now()) !== null;
    if (status === 'unreadable') writable = false;
    const parsed = read.value;
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
    if (!writable) return { error: 'store-unreadable' };
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
   * The capability ids the stored keys name (B3): `doc:<id>` and `vault:<id> <path>`.
   * There is deliberately no bulk delete in this store. An earlier version dropped every key
   * whose id the capability registry no longer knew, and the registry forgets a note as soon
   * as it falls off the recents list, so highlights vanished after a few other files were
   * opened. Now the dependency runs the other way: the registry keeps every record listed
   * here, so the same file or folder gets the same id, and the same key, when it is reopened.
   * @returns {{vaultIds: string[], documentIds: string[]}}
   */
  function referencedIds() {
    load();
    const vaultIds = new Set();
    const documentIds = new Set();
    for (const key of docs.keys()) {
      if (key.startsWith('doc:')) {
        if (key.length > 4) documentIds.add(key.slice(4));
      } else if (key.startsWith('vault:')) {
        const space = key.indexOf(' ');
        if (space > 6) vaultIds.add(key.slice(6, space));
      }
    }
    return { vaultIds: [...vaultIds], documentIds: [...documentIds] };
  }

  return {
    ANNOTATIONS_VERSION,
    MAX_HIGHLIGHTS_PER_DOC,
    MAX_TOTAL_BYTES,
    file,
    load,
    get,
    put,
    referencedIds,
    loadStatus: () => { load(); return status; },
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
