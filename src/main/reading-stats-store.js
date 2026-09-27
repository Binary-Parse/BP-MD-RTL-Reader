/**
 * reading-stats-store.js — reading minutes per day + the streak, owned by main (T8.1).
 *
 * Storage: <userData>/reading-stats.json
 *   { version: 1, days: { "YYYY-MM-DD": minutes } }
 *
 * Two design decisions are the whole point of this file:
 *
 *   1. The DATE KEY IS COMPUTED HERE, in main's local time — never in the renderer. A note
 *      opened at 23:50 and a timer tick at 00:05 must land on the days the USER sees, and a
 *      renderer that computes its own key would drift with the machine's timezone/locale.
 *   2. The streak is a pure function of the stored map, so it is unit-testable without a clock:
 *      a missing day ENDS the chain (a gap resets it), and reading only yesterday still counts
 *      as 1 — a streak is not lost until the day it would have continued has fully passed.
 *
 * Local-only by construction: nothing here touches the network, and the file never leaves the
 * user's profile.
 */

'use strict';

const { atomicWriteJson, readJsonFile } = require('./json-store');

const STATS_VERSION = 1;
const MAX_DAYS = 730;                 // two years of history
const MAX_MINUTES_PER_DAY = 24 * 60;
const MAX_ADD_MINUTES = 1;            // one tick: exactly one minute per accepted call

const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Local-time 'YYYY-MM-DD' for a Date (the key the user's own calendar would show). */
function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** The day before an ISO date key, computed in UTC so DST can never shift it. */
function previousDay(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  const stamp = Date.UTC(year, month - 1, day) - DAY_MS;
  const d = new Date(stamp);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Consecutive days of reading ending today (or yesterday, so an evening streak survives a
 * morning visit). A gap — including a missing YESTERDAY — ends the chain.
 * @param {Map<string, number>} days day key → minutes (the store's own map; a Map rather than
 *   a plain object so the lookup cannot be confused with dynamic property access)
 * @param {string} todayISO the caller's local 'YYYY-MM-DD'
 * @returns {number}
 */
function computeStreak(days, todayISO) {
  if (!(days instanceof Map) || !ISO_DATE.test(String(todayISO || ''))) return 0;
  const read = (iso) => Number(days.get(iso)) > 0;
  let cursor = read(todayISO) ? todayISO : previousDay(todayISO);
  let streak = 0;
  while (read(cursor)) {
    streak += 1;
    cursor = previousDay(cursor);
  }
  return streak;
}

/** Valid minute counts only: a finite, non-negative integer. */
function sanitizeDays(raw) {
  const out = new Map();
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, value] of Object.entries(raw)) {
    if (!ISO_DATE.test(key)) continue;
    if (!Number.isInteger(value) || value < 0) continue;
    out.set(key, Math.min(value, MAX_MINUTES_PER_DAY));
  }
  return out;
}

function createReadingStatsStore({ fs, path, userDataDir, now = () => new Date() } = {}) {
  const file = path.join(userDataDir, 'reading-stats.json');
  /** @type {Map<string, number>} */
  let days = new Map();
  let loaded = false;

  function load() {
    if (loaded) return days;
    loaded = true;
    // Missing/corrupt/foreign-version all degrade to "no history" (never throw here).
    const parsed = readJsonFile(fs, file, (value) => value && value.version === STATS_VERSION);
    if (parsed) days = sanitizeDays(parsed.days);
    return days;
  }

  /** Newest-first by date key (ISO strings sort chronologically), then keep two years. */
  function prune() {
    if (days.size <= MAX_DAYS) return;
    const keep = [...days.keys()].sort().slice(-MAX_DAYS);
    const keepSet = new Set(keep);
    for (const key of [...days.keys()]) {
      if (!keepSet.has(key)) days.delete(key);
    }
  }

  function persist() {
    return atomicWriteJson(fs, file, JSON.stringify({
      version: STATS_VERSION,
      days: Object.fromEntries([...days.entries()].sort()),
    }));
  }

  /**
   * Add minutes to TODAY (main's local day). Returns the fresh summary — today, the day key and
   * the streak — so the renderer's minute tick needs exactly one IPC round trip, or a typed error.
   */
  function addMinutes(minutes) {
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_ADD_MINUTES) {
      return { error: 'invalid-minutes' };
    }
    load();
    const key = dateKey(now());
    const previous = days.get(key) || 0;
    days.set(key, Math.min(MAX_MINUTES_PER_DAY, previous + minutes));
    prune();
    const written = persist();
    if (written.error) {
      // Roll back so memory and disk cannot disagree about "today".
      if (previous > 0) days.set(key, previous);
      else days.delete(key);
      return written;
    }
    return { ok: true, today: days.get(key), date: key, streak: computeStreak(days, key) };
  }

  /** Today's minutes, the streak, and the recent history the welcome line needs. */
  function get() {
    load();
    const todayKey = dateKey(now());
    return {
      today: days.get(todayKey) || 0,
      date: todayKey,
      streak: computeStreak(days, todayKey),
      days: Object.fromEntries([...days.entries()].sort()),
    };
  }

  return {
    STATS_VERSION,
    MAX_DAYS,
    file,
    load,
    get,
    addMinutes,
    dateKey: () => dateKey(now()),
  };
}

module.exports = {
  STATS_VERSION,
  MAX_DAYS,
  MAX_MINUTES_PER_DAY,
  MAX_ADD_MINUTES,
  dateKey,
  previousDay,
  computeStreak,
  createReadingStatsStore,
};
