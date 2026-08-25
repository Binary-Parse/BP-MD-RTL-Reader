/** Shared, allocation-safe limits for renderer-side expensive transforms. */
export const MAX_MATH_BYTES = 32 * 1024;
export const MAX_CODE_BYTES = 256 * 1024;

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
