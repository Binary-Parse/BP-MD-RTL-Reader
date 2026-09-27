/**
 * zip-store.test.js — T6.1a: the dependency-free stored-ZIP writer.
 *
 * No compression library is available (and none is allowed), so the archive is verified with
 * an independent little reader written here: it walks the EOCD → central directory → local
 * headers, which is exactly what an EPUB reader does, and fails loudly if any offset, size or
 * CRC is wrong.
 */
import { describe, test, expect } from 'vitest';
import { crc32, utf8Bytes, zipStore } from '../../src/renderer/markdown/zip-store.js';

const decoder = new TextDecoder();

/** Minimal, independent ZIP reader used to validate the writer's output. */
function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = bytes.length - 22;
  const eocd = {
    signature: view.getUint32(eocdOffset, true),
    disks: view.getUint16(eocdOffset + 4, true),
    count: view.getUint16(eocdOffset + 10, true),
    centralSize: view.getUint32(eocdOffset + 12, true),
    centralOffset: view.getUint32(eocdOffset + 16, true),
    commentLength: view.getUint16(eocdOffset + 20, true),
  };
  const entries = [];
  let p = eocd.centralOffset;
  for (let i = 0; i < eocd.count; i += 1) {
    const nameLength = view.getUint16(p + 28, true);
    const localOffset = view.getUint32(p + 42, true);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const size = view.getUint32(p + 24, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    entries.push({
      centralSignature: view.getUint32(p, true),
      localSignature: view.getUint32(localOffset, true),
      name: decoder.decode(bytes.slice(p + 46, p + 46 + nameLength)),
      method: view.getUint16(p + 10, true),
      localMethod: view.getUint16(localOffset + 8, true),
      flags: view.getUint16(p + 8, true),
      time: view.getUint16(p + 12, true),
      date: view.getUint16(p + 14, true),
      crc: view.getUint32(p + 16, true),
      size,
      localCompressed: view.getUint32(localOffset + 18, true),
      extraLength: view.getUint16(localOffset + 28, true),
      localOffset,
      data: bytes.slice(dataStart, dataStart + size),
    });
    p += 46 + nameLength;
  }
  return { eocd, entries };
}

const EPUB_ENTRIES = [
  { name: 'mimetype', data: 'application/epub+zip' },
  { name: 'META-INF/container.xml', data: '<container/>' },
  { name: 'OEBPS/chapter1.xhtml', data: '<html>مرحبا بكم</html>' },
];

describe('crc32 (T6.1a)', () => {
  test('matches the canonical check value for "123456789"', () => {
    expect(crc32(utf8Bytes('123456789'))).toBe(0xCBF43926);
  });

  test('matches further published vectors, including the empty input', () => {
    expect(crc32(utf8Bytes(''))).toBe(0);
    expect(crc32(utf8Bytes('a'))).toBe(0xE8B7BE43);
    expect(crc32(utf8Bytes('The quick brown fox jumps over the lazy dog'))).toBe(0x414FA339);
  });

  test('always returns an unsigned 32-bit value', () => {
    for (const text of ['a', '123456789', 'x'.repeat(1000), 'مرحبا']) {
      const value = crc32(utf8Bytes(text));
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(0xFFFFFFFF);
    }
  });

  test('is byte-wise on the UTF-8 encoding, not the string', () => {
    // 'é' is two UTF-8 bytes; hashing the code points instead would give a different value.
    expect(crc32(utf8Bytes('é'))).toBe(crc32(Uint8Array.from([0xC3, 0xA9])));
  });

  test('utf8Bytes encodes multi-byte text and never mutates the input string', () => {
    expect([...utf8Bytes('é')]).toEqual([0xC3, 0xA9]);
    expect(utf8Bytes('ab').length).toBe(2);
  });
});

describe('zipStore — structure (T6.1a)', () => {
  test('starts with the local file header signature and ends with the EOCD', () => {
    const zip = zipStore(EPUB_ENTRIES);
    expect([...zip.slice(0, 4)]).toEqual([0x50, 0x4B, 0x03, 0x04]); // PK\x03\x04
    expect([...zip.slice(-22, -18)]).toEqual([0x50, 0x4B, 0x05, 0x06]); // PK\x05\x06
  });

  test('the first entry is mimetype, stored, with no extra field (OCF rule)', () => {
    const zip = zipStore(EPUB_ENTRIES);
    const { entries } = readZip(zip);
    expect(entries.map((e) => e.name)).toEqual(['mimetype', 'META-INF/container.xml', 'OEBPS/chapter1.xhtml']);
    const [mimetype] = entries;
    expect(mimetype.method).toBe(0);          // stored, never deflated
    expect(mimetype.localMethod).toBe(0);
    expect(mimetype.extraLength).toBe(0);
    expect(mimetype.localOffset).toBe(0);     // physically first
    expect(decoder.decode(mimetype.data)).toBe('application/epub+zip');
    // mimetype's bytes start at offset 30 (header) + 8 (name length).
    expect(decoder.decode(zip.slice(38, 38 + 20))).toBe('application/epub+zip');
  });

  test('every entry round-trips: name, bytes, stored method, size and CRC all agree', () => {
    const zip = zipStore(EPUB_ENTRIES);
    const { entries } = readZip(zip);
    expect(entries).toHaveLength(EPUB_ENTRIES.length);
    entries.forEach((entry, i) => {
      const source = EPUB_ENTRIES[i];
      expect(entry.centralSignature).toBe(0x02014B50); // PK\x01\x02
      expect(entry.localSignature).toBe(0x04034B50);
      expect(entry.name).toBe(source.name);
      expect(decoder.decode(entry.data)).toBe(source.data);
      expect(entry.method).toBe(0);
      expect(entry.size).toBe(utf8Bytes(source.data).length);
      expect(entry.localCompressed).toBe(entry.size);  // stored → compressed == uncompressed
      expect(entry.crc).toBe(crc32(utf8Bytes(source.data)));
    });
  });

  test('the EOCD describes the whole archive (count, central size, central offset)', () => {
    const zip = zipStore(EPUB_ENTRIES);
    const { eocd, entries } = readZip(zip);
    expect(eocd.signature).toBe(0x06054B50);
    expect(eocd.disks).toBe(0);
    expect(eocd.count).toBe(3);
    expect(eocd.commentLength).toBe(0);
    // The central directory holds every entry and the FIRST local header sits at 0.
    expect(entries[0].localOffset).toBe(0);
    expect(eocd.centralOffset + eocd.centralSize).toBe(zip.length - 22);
    const centralHeaderBytes = entries.reduce((sum, e) => sum + 46 + utf8Bytes(e.name).length, 0);
    expect(eocd.centralSize).toBe(centralHeaderBytes);
  });

  test('the modification time/date fields are the local MS-DOS pair', () => {
    // 2026-01-02 03:04:05 → time = 3<<11 | 4<<5 | 5>>1 = 6274; date = 46<<9 | 1<<5 | 2 = 23586
    const { entries } = readZip(zipStore(EPUB_ENTRIES, { now: new Date(2026, 0, 2, 3, 4, 5) }));
    expect(entries[0].time).toBe(6274);
    expect(entries[0].date).toBe(23586);
  });

  test('archive bytes are binary data, not a string, and accept Uint8Array input', () => {
    const zip = zipStore([{ name: 'a.bin', data: Uint8Array.from([0, 1, 2, 255]) }]);
    expect(zip).toBeInstanceOf(Uint8Array);
    const { entries } = readZip(zip);
    expect([...entries[0].data]).toEqual([0, 1, 2, 255]);
    expect(entries[0].crc).toBe(crc32(Uint8Array.from([0, 1, 2, 255])));
  });

  test('an empty archive is still a valid 22-byte ZIP', () => {
    const zip = zipStore([]);
    expect(zip.length).toBe(22);
    const { eocd, entries } = readZip(zip);
    expect(eocd.signature).toBe(0x06054B50);
    expect(eocd.count).toBe(0);
    expect(eocd.centralOffset).toBe(0);
    expect(eocd.centralSize).toBe(0);
    expect(entries).toEqual([]);
  });

  test('a non-ASCII entry name sets the UTF-8 name flag', () => {
    const { entries } = readZip(zipStore([{ name: 'فصل/١.xhtml', data: 'x' }]));
    expect(entries[0].flags).toBe(0x0800);
    expect(entries[0].name).toBe('فصل/١.xhtml');
    // An all-ASCII name leaves the flag clear (both are valid; ASCII stays maximally portable).
    expect(readZip(zipStore([{ name: 'OEBPS/nav.xhtml', data: 'x' }])).entries[0].flags).toBe(0);
  });

  test('missing data is an empty entry rather than a crash', () => {
    const { entries } = readZip(zipStore([{ name: 'empty.txt' }]));
    expect(entries[0].size).toBe(0);
    expect(entries[0].crc).toBe(0);
  });
});

describe('zipStore — input validation (T6.1a)', () => {
  test('rejects a non-array, a nameless entry and unusable data', () => {
    expect(() => zipStore(null)).toThrow(/entries must be an array/);
    expect(() => zipStore([{ data: 'x' }])).toThrow(/non-empty name/);
    expect(() => zipStore([{ name: '', data: 'x' }])).toThrow(/non-empty name/);
    expect(() => zipStore([{ name: 'a', data: 42 }])).toThrow(/string, Uint8Array or number\[\]/);
  });

  test('refuses to emit an archive whose offsets would overflow (no silent corruption)', () => {
    const tooMany = Array.from({ length: 65536 }, (_, i) => ({ name: `f${i}`, data: '' }));
    expect(() => zipStore(tooMany)).toThrow(/65535/);
  });
});
