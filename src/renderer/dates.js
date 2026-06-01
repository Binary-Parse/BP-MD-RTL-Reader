/**
 * dates.js — daily-note naming with Gregorian or Hijri calendar (T-R8). Pure.
 * Hijri conversion uses the platform Intl (Umm al-Qura) — no extra deps.
 */

function pad(n) { return String(n).padStart(2, '0'); }

/** Gregorian YYYY-MM-DD. */
export function gregorianYMD(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Hijri {year, month, day} via Intl Umm al-Qura calendar. */
export function hijriParts(date) {
  const fmt = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', {
    year: 'numeric', month: 'numeric', day: 'numeric',
  });
  const parts = fmt.formatToParts(date);
  const get = (t) => Number(parts.find((p) => p.type === t)?.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

/** Hijri YYYY-MM-DD (Umm al-Qura). */
export function hijriYMD(date) {
  const h = hijriParts(date);
  return `${h.year}-${pad(h.month)}-${pad(h.day)}`;
}

/** Daily-note filename for the chosen calendar. */
export function dailyNoteName(date, calendar = 'gregorian') {
  const ymd = calendar === 'hijri' ? hijriYMD(date) : gregorianYMD(date);
  return `${ymd}.md`;
}
