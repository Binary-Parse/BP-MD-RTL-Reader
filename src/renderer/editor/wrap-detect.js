/**
 * wrap-detect.js — "is this text already wrapped in these inline markers?" (audit H2).
 *
 * wrapSelection() in app.js toggles inline marks: re-applying a mark UNWRAPS it. A plain
 * prefix/suffix test is wrong for markers that are a single repeated character: the `*` that
 * is half of `**word**` is not an italic marker, so Ctrl+I on a bold word turned it into
 * `*word*` (the bold was lost) instead of `***word***`. The same holds for `_` against `__`
 * and `~` (subscript) against `~~` (strikethrough).
 *
 * A single-character marker is really present only when the run of that character next to the
 * text has ODD length: 1 = the mark alone, 3 = the mark inside bold (`***`), 2/4 = bold layers.
 *
 * Pure and DOM-free so the coverage gate sees it (app.js is e2e-only).
 */

const RUN_MARKERS = new Set(['*', '_', '~']);

const isRunMarker = (left, right) => RUN_MARKERS.has(left) && left === right;

function runEndingAt(text, pos, ch) {
  let n = 0;
  while (text[pos - n - 1] === ch) n++; // past either end the index reads undefined and stops
  return n;
}

function runStartingAt(text, pos, ch) {
  let n = 0;
  while (text[pos + n] === ch) n++;
  return n;
}

/** Markers sit just OUTSIDE the range [start, end) of `text`. */
export function isWrappedOutside(text, start, end, left, right) {
  if (text.slice(start - left.length, start) !== left) return false;
  if (text.slice(end, end + right.length) !== right) return false;
  if (!isRunMarker(left, right)) return true;
  return runEndingAt(text, start, left) % 2 === 1 && runStartingAt(text, end, right) % 2 === 1;
}

/** `sel` itself starts with `left` and ends with `right` (without the markers overlapping). */
export function isWrappedInside(sel, left, right) {
  if (sel.length < left.length + right.length) return false;
  if (!sel.startsWith(left) || !sel.endsWith(right)) return false;
  if (!isRunMarker(left, right)) return true;
  return runStartingAt(sel, 0, left) % 2 === 1 && runEndingAt(sel, sel.length, right) % 2 === 1;
}
