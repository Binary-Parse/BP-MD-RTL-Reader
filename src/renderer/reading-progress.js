/**
 * reading-progress.js — pure helpers for the "Continue reading" shelf (T4.1).
 *
 * The stored shape mirrors what src/main/settings.js's migrate() keeps, and the renderer
 * validates with the SAME rules before it ever sends a payload: an entry is only usable if
 * it can be reopened, i.e. it carries a well-formed opaque capability id. A loose or
 * untitled file has neither, so it is rejected here rather than filling the shelf with
 * rows that could never open.
 *
 * No DOM: scrollRatio() takes any {scrollTop, scrollHeight, clientHeight} reader.
 */
import { fileKey } from './session.js';

export const PROGRESS_CAP = 30;
const CAPABILITY_ID = /^cap-[A-Za-z0-9_-]{1,128}$/;

/**
 * Fraction scrolled (0..1), or null when the element cannot scroll at all (short note /
 * not laid out). null is deliberately distinct from 0: "no measurable position" must not
 * be stored as "at the top".
 */
export function scrollRatio(el) {
  if (!el) return null;
  const max = Number(el.scrollHeight) - Number(el.clientHeight);
  if (!Number.isFinite(max) || max <= 0) return null;
  const ratio = Number(el.scrollTop) / max;
  if (!Number.isFinite(ratio)) return null;
  return Math.min(1, Math.max(0, ratio));
}

/** 0..100 integer for display; anything unusable reads as 0. */
export function progressPercent(ratio) {
  if (typeof ratio !== 'number' || !Number.isFinite(ratio)) return 0;
  return Math.round(Math.min(1, Math.max(0, ratio)) * 100);
}

/**
 * Build the stored entry for `file`, or null when it must not be shelved: no stable key,
 * a non-numeric ratio, a non-positive timestamp, or no valid capability id (loose file).
 */
export function progressEntryFor(file, ratio, at) {
  if (!file || typeof ratio !== 'number' || !Number.isFinite(ratio)) return null;
  const key = fileKey(file);
  if (!key) return null;
  const vaultId = CAPABILITY_ID.test(file.vaultId || '') ? file.vaultId : null;
  const documentId = CAPABILITY_ID.test(file.documentId || '') ? file.documentId : null;
  if (vaultId == null && documentId == null) return null;
  const stamp = typeof at === 'number' && Number.isFinite(at) && at > 0 ? at : Date.now();
  return {
    key,
    name: String(file.name || ''),
    path: String(file.path || ''),
    vaultId,
    documentId,
    ratio: Math.min(1, Math.max(0, ratio)),
    at: stamp,
  };
}

/**
 * Clean an untrusted list (a persisted payload, or a bridge response) into the stored
 * shape: newest first, capped at PROGRESS_CAP. Mirrors main's sanitizeReadingProgress so
 * the two ends can never disagree about what is storable.
 */
export function sanitizeProgress(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry) => entry && typeof entry === 'object'
      && typeof entry.path === 'string' && entry.path !== ''
      && typeof entry.ratio === 'number' && Number.isFinite(entry.ratio)
      && entry.ratio >= 0 && entry.ratio <= 1
      && typeof entry.at === 'number' && Number.isFinite(entry.at) && entry.at > 0
      && (CAPABILITY_ID.test(entry.vaultId || '') || CAPABILITY_ID.test(entry.documentId || '')))
    .map((entry) => ({
      key: typeof entry.key === 'string' ? entry.key : '',
      name: String(entry.name || ''),
      path: entry.path,
      vaultId: CAPABILITY_ID.test(entry.vaultId || '') ? entry.vaultId : null,
      documentId: CAPABILITY_ID.test(entry.documentId || '') ? entry.documentId : null,
      ratio: entry.ratio,
      at: entry.at,
    }))
    .sort((a, b) => b.at - a.at)
    .slice(0, PROGRESS_CAP);
}

/** New list with `entry` first and any same-key predecessor removed; never mutates input. */
export function upsertProgress(list, entry) {
  if (!entry || !entry.key) return Array.isArray(list) ? list.slice(0, PROGRESS_CAP) : [];
  const rest = (Array.isArray(list) ? list : []).filter((item) => item && item.key !== entry.key);
  return [entry, ...rest].slice(0, PROGRESS_CAP);
}

const RELATIVE_UNITS = [
  ['year', 31536000],
  ['month', 2592000],
  ['week', 604800],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
];

/**
 * Localized "3 hours ago" / "قبل 3 ساعات". `numeric:'auto'` gives the nicer words
 * (yesterday / أمس). Anything under a minute reads as "1 minute ago" rather than 0.
 */
export function relativeTime(at, locale = 'en', now = Date.now()) {
  const deltaSec = Math.round((Number(at) - Number(now)) / 1000);
  if (!Number.isFinite(deltaSec)) return '';
  try {
    const rtf = new Intl.RelativeTimeFormat(locale || 'en', { numeric: 'auto' });
    for (const [unit, seconds] of RELATIVE_UNITS) {
      if (Math.abs(deltaSec) >= seconds) return rtf.format(Math.round(deltaSec / seconds), unit);
    }
    return rtf.format(-1, 'minute');
  } catch (_) {
    // Extremely defensive: an engine without Intl.RelativeTimeFormat still gets a label.
    const mins = Math.max(1, Math.round(Math.abs(deltaSec) / 60));
    return `${mins}m`;
  }
}
