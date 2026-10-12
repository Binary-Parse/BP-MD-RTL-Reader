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
