/**
 * block-direction.js — one block's direction, pinned inside the note (design-mock feature 1).
 *
 * The pin is one line directly above the block, `<!-- dir: rtl -->` or `<!-- dir: ltr -->`.
 * Every Markdown viewer hides it (an HTML comment), so the file stays portable; here it wins
 * over the block's automatic direction and over the note's forced one. Pure functions: the
 * marked extension, the source-line bookkeeping and the text edits; no DOM, no editor.
 */

const MARKER = /^<!-- dir: (rtl|ltr) -->[ \t]*(?:\n|$)/;
const MARKER_LINE = /^<!-- dir: (rtl|ltr) -->[ \t]*\r?$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** 'rtl' | 'ltr' when `line` is a pin, else null. */
export function markerDirection(line) {
  const m = MARKER_LINE.exec(String(line));
  return m ? m[1] : null;
}

export function markerLine(dir) {
  return `<!-- dir: ${dir === 'rtl' ? 'rtl' : 'ltr'} -->`;
}

/**
 * marked extension. The pin renders as an empty hidden paragraph that carries the direction
 * (DOMPurify keeps `hidden`, `class` and `dir`); applyBidi moves it onto the next block and
 * removes it. No `start` hint is needed: marked's paragraph rule already stops at `<!--`.
 */
export function dirMarkerExtension() {
  return {
    name: 'dirMarker',
    level: 'block',
    tokenizer(src) {
      const m = MARKER.exec(src);
      if (m) return { type: 'dirMarker', raw: m[0], dir: m[1] };
      return undefined;
    },
    renderer(token) { return `<p hidden class="bpmd-dir" dir="${token.dir}"></p>\n`; },
  };
}

// Top-level tokens that render nothing of their own: a source line placed before them would
// attach to the next block instead.
const SILENT = new Set(['space', 'def', 'dirMarker', 'footnoteDef']);

/**
 * Before every rendered top-level token, a `srcLine` token holding the token's first line
 * (0-based, in the text marked was given). Lines, not offsets: marked turns CRLF into LF.
 */
export function withSourceLines(tokens) {
  const out = [];
  let line = 0;
  for (const token of tokens) {
    if (!SILENT.has(token.type)) out.push({ type: 'srcLine', raw: '', line });
    out.push(token);
    const raw = token.raw || '';
    for (let i = raw.indexOf('\n'); i >= 0; i = raw.indexOf('\n', i + 1)) line++;
  }
  return out;
}

export function srcLineRenderer(token) {
  return `<p hidden class="bpmd-src" title="${token.line}"></p>`;
}

/**
 * Moves each source-line placeholder of a sanitized fragment onto the element after it as
 * `data-src-line`, then removes the placeholder.
 */
export function attachSourceLines(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return root;
  for (const holder of root.querySelectorAll('p.bpmd-src')) {
    const next = holder.nextElementSibling;
    if (next && !next.classList.contains('bpmd-src')) next.setAttribute('data-src-line', holder.getAttribute('title') || '0');
    holder.remove();
  }
  return root;
}

/**
 * Where the block whose first line is `line` (0-based) starts in `text`, and the pin line
 * above it (blank lines allowed between), or null when `line` is out of range.
 * @returns {{start:number,pin:{from:number,length:number,dir:string,cr:boolean}|null}|null}
 */
function blockAt(text, line) {
  if (!Number.isInteger(line) || line < 0) return null;
  let at = 0;
  let pin = null; // the last pin line with only blank lines after it
  for (const [n, current] of String(text).split('\n').entries()) {
    if (n === line) return { start: at, pin };
    const dir = markerDirection(current);
    if (dir) pin = { from: at, length: current.length, dir, cr: current.endsWith('\r') };
    else if (current.trim() !== '') pin = null;
    at += current.length + 1;
  }
  return null;
}

/**
 * The edit that flips a block's pin, for the note text `text` and the block's first line
 * `line` (0-based). A pinned block (a pin line directly above, blank lines allowed between)
 * goes back to automatic: the pin line is removed. Otherwise a pin for `nextDir` is inserted.
 * @returns {{from:number,to:number,insert:string,dir:string|null}|null}
 */
export function flipEdit(text, line, nextDir) {
  const block = blockAt(text, line);
  if (!block) return null;
  const { start, pin } = block;
  if (pin) return { from: pin.from, to: pin.from + pin.length + 1, insert: '', dir: null };
  return { from: start, to: start, insert: `${markerLine(nextDir)}\n`, dir: nextDir };
}

/**
 * The edit that sets a block's pin to `dir` ('rtl' | 'ltr', or null for automatic), for the
 * note text `text` and the block's first line `line` (0-based). An existing pin line above the
 * block (blank lines allowed between) is replaced or removed; otherwise one is inserted.
 * @returns {{from:number,to:number,insert:string,dir:string|null,shift:number}|null} null when
 *   the line is out of range or the block already has that state. `shift` is how many lines
 *   the block moved (+1 a pin added, -1 a pin removed, 0 replaced).
 */
export function pinEdit(text, line, dir) {
  const block = blockAt(text, line);
  if (!block) return null;
  const want = dir === 'rtl' || dir === 'ltr' ? dir : null;
  const { start, pin } = block;
  if ((pin ? pin.dir : null) === want) return null;
  if (!pin) return { from: start, to: start, insert: `${markerLine(want)}\n`, dir: want, shift: 1 };
  if (!want) return { from: pin.from, to: pin.from + pin.length + 1, insert: '', dir: null, shift: -1 };
  // Replace the pin text only: a CRLF note keeps its `\r`.
  return { from: pin.from, to: pin.from + pin.length - (pin.cr ? 1 : 0), insert: markerLine(want), dir: want, shift: 0 };
}

/**
 * Where the pin lines are: each {from, to} covers one pin line and its line break. Lines
 * inside fenced code are text, not pins.
 */
export function markerRanges(text) {
  const ranges = [];
  let fence = null;
  let at = 0;
  for (const line of String(text).split('\n')) {
    const f = FENCE.exec(line);
    if (f) {
      if (!fence) fence = f[1];
      else if (f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
    } else if (!fence && markerDirection(line)) {
      ranges.push({ from: at, to: Math.min(at + line.length + 1, String(text).length) });
    }
    at += line.length + 1;
  }
  return ranges;
}

/** The note without any pin line. */
export function removeAllMarkers(text) {
  const ranges = markerRanges(text);
  let out = String(text);
  for (const { from, to } of [...ranges].reverse()) out = out.slice(0, from) + out.slice(to);
  return { text: out, removed: ranges.length };
}

/**
 * Per-line pins for the editor: given the lines in order (from the top of the note, or from a
 * line known to start a block), the pin each line is under. A pin covers the lines after it
 * up to the next blank line; the pin line itself is reported as 'marker'.
 */
export function pinnedLines(lines, startPin = null) {
  const out = [];
  let pin = startPin;
  for (const line of lines) {
    const dir = markerDirection(line);
    if (dir) { out.push('marker'); pin = dir; continue; }
    if (line.trim() === '') { out.push(null); pin = null; continue; }
    out.push(pin);
  }
  return out;
}
