/** Shared, allocation-safe limits for renderer-side expensive transforms. */
export const MAX_MATH_BYTES = 32 * 1024;
export const MAX_CODE_BYTES = 256 * 1024;
// audit M4: the time one Markdown render may spend on inline formatting before the rest of
// the note is emitted as literal text. Honest text costs about 0.25 ms per KB, so the slope
// leaves a wide margin; the base covers small notes on a slow or busy machine.
export const RENDER_BUDGET_BASE_MS = 400;
export const RENDER_BUDGET_MS_PER_KB = 2;
// Matches x length of one inline context above which marked's masking pass (one copy of the
// context per match, about 0.3 ns per unit) is not run.
export const RENDER_MASK_UNITS = 4e9;
// QA H5: the editor's regex previews (highlight, underline, sub/sup, wiki-links, math) are
// quadratic on text full of unclosed openers ("==a ==a ..."): one 80 KB line froze the
// editor for 7-13 s. They scan pieces of at most this many characters; a longer line keeps
// its raw Markdown in the editor (the reading view has its own guard, render-guard.js).
export const MAX_PREVIEW_CHARS = 5000;

/**
 * Cut `text` into runs of whole lines, each at most MAX_PREVIEW_CHARS long, for the editor's
 * regex previews. A line longer than the limit is left out. Returns [{ offset, text }].
 */
export function previewChunks(text) {
  const chunks = [];
  let start = 0; // start of the current chunk
  let pos = 0;   // start of the current line
  const flush = (end) => { if (end > start) chunks.push({ offset: start, text: text.slice(start, end) }); };
  while (pos <= text.length) {
    let nl = text.indexOf('\n', pos);
    if (nl === -1) nl = text.length;
    if (nl - pos > MAX_PREVIEW_CHARS) {
      flush(pos - 1);
      start = nl + 1;
    } else if (nl - start > MAX_PREVIEW_CHARS) {
      flush(pos - 1);
      start = pos;
    }
    pos = nl + 1;
  }
  flush(text.length);
  return chunks;
}

/** Return the UTF-8 byte length without allocating an encoded copy. */
export function utf8ByteLength(value) {
  let bytes = 0;
  for (const ch of String(value)) {
    const cp = ch.codePointAt(0);
    if (cp <= 0x7f) bytes += 1;
    else if (cp <= 0x7ff) bytes += 2;
    else if (cp <= 0xffff) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}

/** True when the character at `index` is preceded by an odd slash run. */
export function isEscaped(text, index) {
  let slashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i--) slashes += 1;
  return slashes % 2 === 1;
}
