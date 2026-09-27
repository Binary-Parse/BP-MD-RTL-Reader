/**
 * zip-store.js — a dependency-free, STORED-only ZIP writer (T6.1a).
 *
 * EPUB is a ZIP, and the OCF spec makes two demands a generic archiver will not always
 * honour: the FIRST entry must be `mimetype` with content `application/epub+zip`, and it
 * must be STORED (method 0) with NO extra field. Writing those bytes ourselves — instead of
 * pulling in a compression library — removes both the dependency and the deflate risk, at
 * the cost of an uncompressed archive (markdown is tiny; EPUB readers accept stored entries).
 *
 * Implemented signatures:
 *   PK\x03\x04  local file header        (one per entry)
 *   PK\x01\x02  central directory header (one per entry)
 *   PK\x05\x06  end of central directory (always last)
 *
 * No ZIP64: sizes and counts are the classic 16/32-bit fields, and anything that would
 * overflow them throws instead of silently emitting a corrupt archive.
 */

const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;

const VERSION_NEEDED = 20; // 2.0 — the oldest version that defines "stored"
const METHOD_STORED = 0;
const FLAG_UTF8_NAMES = 0x0800;

const LOCAL_HEADER_BYTES = 30;
const CENTRAL_HEADER_BYTES = 46;
const EOCD_BYTES = 22;

const MAX_ENTRIES = 0xFFFF;
const MAX_UINT32 = 0xFFFFFFFF;

/** CRC-32 (IEEE 802.3) table, built once at module load and reused for every byte. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    // security/detect-object-injection (accepted): `n` is the loop counter of a 0..255 sweep
    // over a freshly allocated Uint32Array, so the index is in range by construction.
    table[n] = c >>> 0;
  }
  return table;
})();

/** UTF-8 bytes for a string (TextEncoder is a platform builtin in Electron and jsdom). */
export function utf8Bytes(text) {
  return new TextEncoder().encode(String(text));
}

/** CRC-32 of a byte array, as the unsigned 32-bit value the ZIP headers store. */
export function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i += 1) {
    // security/detect-object-injection (accepted): the index is `(crc ^ byte) & 0xFF`, i.e.
    // masked to 0..255 — exactly the table's length, so it can never read out of bounds.
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (typeof data === 'string') return utf8Bytes(data);
  if (Array.isArray(data)) return Uint8Array.from(data);
  throw new TypeError('zipStore: entry data must be a string, Uint8Array or number[]');
}

/** MS-DOS date/time pair for the ZIP headers (local time, second resolution, 1980 floor). */
function dosDateTime(when) {
  const year = Math.max(1980, when.getFullYear());
  const time = ((when.getHours() & 0x1F) << 11) | ((when.getMinutes() & 0x3F) << 5) | (when.getSeconds() >> 1);
  const date = (((year - 1980) & 0x7F) << 9) | (((when.getMonth() + 1) & 0x0F) << 5) | (when.getDate() & 0x1F);
  return { time: time & 0xFFFF, date: date & 0xFFFF };
}

/**
 * Build a stored-only ZIP archive.
 * @param {Array<{name: string, data: string|Uint8Array|number[]}>} entries in archive order
 *   (EPUB callers put `mimetype` first).
 * @param {{now?: Date}} [options] archive timestamp; injectable so output is reproducible.
 * @returns {Uint8Array} the complete archive.
 */
export function zipStore(entries, { now = new Date() } = {}) {
  if (!Array.isArray(entries)) throw new TypeError('zipStore: entries must be an array');
  if (entries.length > MAX_ENTRIES) throw new RangeError('zipStore: more than 65535 entries needs ZIP64');
  const { time, date } = dosDateTime(now);

  const prepared = entries.map((entry) => {
    if (!entry || typeof entry.name !== 'string' || entry.name === '') {
      throw new TypeError('zipStore: every entry needs a non-empty name');
    }
    const name = utf8Bytes(entry.name);
    if (name.length > 0xFFFF) throw new RangeError('zipStore: entry name is too long');
    const data = toBytes(entry.data === undefined ? '' : entry.data);
    return {
      name,
      data,
      crc: crc32(data),
      flags: name.length === entry.name.length ? 0 : FLAG_UTF8_NAMES,
      offset: 0,
    };
  });

  const localBytes = prepared.reduce((sum, e) => sum + LOCAL_HEADER_BYTES + e.name.length + e.data.length, 0);
  const centralBytes = prepared.reduce((sum, e) => sum + CENTRAL_HEADER_BYTES + e.name.length, 0);
  const total = localBytes + centralBytes + EOCD_BYTES;
  if (localBytes > MAX_UINT32 || centralBytes > MAX_UINT32 || total > MAX_UINT32) {
    throw new RangeError('zipStore: archive exceeds 4 GiB without ZIP64');
  }

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let offset = 0;

  for (const entry of prepared) {
    entry.offset = offset;
    view.setUint32(offset, LOCAL_SIGNATURE, true);
    view.setUint16(offset + 4, VERSION_NEEDED, true);
    view.setUint16(offset + 6, entry.flags, true);
    view.setUint16(offset + 8, METHOD_STORED, true);
    view.setUint16(offset + 10, time, true);
    view.setUint16(offset + 12, date, true);
    view.setUint32(offset + 14, entry.crc, true);
    view.setUint32(offset + 18, entry.data.length, true); // compressed size == uncompressed (stored)
    view.setUint32(offset + 22, entry.data.length, true);
    view.setUint16(offset + 26, entry.name.length, true);
    view.setUint16(offset + 28, 0, true); // extra field length — OCF forbids one on `mimetype`
    offset += LOCAL_HEADER_BYTES;
    out.set(entry.name, offset);
    offset += entry.name.length;
    out.set(entry.data, offset);
    offset += entry.data.length;
  }

  const centralStart = offset;
  for (const entry of prepared) {
    view.setUint32(offset, CENTRAL_SIGNATURE, true);
    view.setUint16(offset + 4, VERSION_NEEDED, true);  // version made by
    view.setUint16(offset + 6, VERSION_NEEDED, true);  // version needed to extract
    view.setUint16(offset + 8, entry.flags, true);
    view.setUint16(offset + 10, METHOD_STORED, true);
    view.setUint16(offset + 12, time, true);
    view.setUint16(offset + 14, date, true);
    view.setUint32(offset + 16, entry.crc, true);
    view.setUint32(offset + 20, entry.data.length, true);
    view.setUint32(offset + 24, entry.data.length, true);
    view.setUint16(offset + 28, entry.name.length, true);
    view.setUint16(offset + 30, 0, true); // extra field length
    view.setUint16(offset + 32, 0, true); // file comment length
    view.setUint16(offset + 34, 0, true); // disk number start
    view.setUint16(offset + 36, 0, true); // internal attributes
    view.setUint32(offset + 38, 0, true); // external attributes
    view.setUint32(offset + 42, entry.offset, true);
    offset += CENTRAL_HEADER_BYTES;
    out.set(entry.name, offset);
    offset += entry.name.length;
  }

  view.setUint32(offset, EOCD_SIGNATURE, true);
  view.setUint16(offset + 4, 0, true);                  // this disk
  view.setUint16(offset + 6, 0, true);                  // disk holding the central directory
  view.setUint16(offset + 8, prepared.length, true);    // entries on this disk
  view.setUint16(offset + 10, prepared.length, true);   // entries in total
  view.setUint32(offset + 12, centralBytes, true);
  view.setUint32(offset + 16, centralStart, true);
  view.setUint16(offset + 20, 0, true);                 // archive comment length
  offset += EOCD_BYTES;

  return out;
}
