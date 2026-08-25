/**
 * App-icon guard (BP MD RTL Reader branding).
 *
 * Pins the application icon artifacts so a regression that drops or reverts the
 * icon is caught by the unit suite:
 *   - icon.png                     — 256x256 PNG, the app/window icon (Linux + fallback)
 *   - icon.ico                     — multi-size PNG-in-ICO used by src/main/index.js BrowserWindow,
 *                                    electron-builder (build.win.icon / nsis), fileAssociations
 *   - build/installer/assets/icon.ico  — the same icon, used by Inno SetupIconFile
 *
 * These assertions go RED against the previous (placeholder) icons:
 *   • the old icon.ico's 256 entry and old icon.png were different PNGs, and
 *   • the old icon was not the black-background / green-text "BP MD RTL Reader" design.
 *
 * A tiny dependency-free PNG decoder (zlib + unfilter) lets us assert the design
 * without pulling in an image library.
 */
import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import zlib from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel));

// ── minimal PNG decoder: 8-bit, colorType 2 (RGB) or 6 (RGBA), no interlace ──
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8, width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === 'IDAT') { idat.push(data); }
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0;
  if (!channels || bitDepth !== 8 || interlace !== 0) {
    throw new Error(`unsupported PNG (colorType=${colorType}, bitDepth=${bitDepth}, interlace=${interlace})`);
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const ft = raw[pos++];
    for (let x = 0; x < stride; x++) {
      const rb = raw[pos++];
      const a = x >= channels ? out[y * stride + x - channels] : 0;        // left
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;                     // up
      const c = (x >= channels && y > 0) ? out[(y - 1) * stride + x - channels] : 0; // upper-left
      let v;
      switch (ft) {
        case 0: v = rb; break;
        case 1: v = rb + a; break;
        case 2: v = rb + b; break;
        case 3: v = rb + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v = rb + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); break;
        }
        default: throw new Error('bad filter ' + ft);
      }
      out[y * stride + x] = v & 0xff;
    }
  }
  const px = (x, y) => {
    const i = (y * width + x) * channels;
    return { r: out[i], g: out[i + 1], b: out[i + 2], a: channels === 4 ? out[i + 3] : 255 };
  };
  return { width, height, channels, px, data: out };
}

// ── parse an ICO into { sizes, entryAt(size) -> {fmt, png} } ──────────────────
function parseICO(buf) {
  if (buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) throw new Error('not an ICO');
  const n = buf.readUInt16LE(4);
  const entries = [];
  for (let i = 0; i < n; i++) {
    const o = 6 + i * 16;
    const w = buf[o] || 256, h = buf[o + 1] || 256;
    const bytes = buf.readUInt32LE(o + 8), offset = buf.readUInt32LE(o + 12);
    const blob = buf.subarray(offset, offset + bytes);
    const isPNG = blob.readUInt32BE(0) === 0x89504e47;
    entries.push({ w, h, fmt: isPNG ? 'PNG' : 'BMP', blob });
  }
  return {
    sizes: entries.map((e) => e.w).sort((a, b) => a - b),
    entries,
    at: (size) => entries.find((e) => e.w === size),
  };
}

const PNG_ICO_SIZES = [16, 32, 48, 256];

describe('app icon — BP MD RTL Reader', () => {
  test('icon.png is a 256x256 PNG', () => {
    const img = decodePNG(read('build/icons/icon.png'));
    expect(img.width).toBe(256);
    expect(img.height).toBe(256);
  });

  test('icon.ico is a valid multi-size PNG-in-ICO incl. {16,32,48,256}', () => {
    const ico = parseICO(read('build/icons/icon.ico'));
    for (const s of PNG_ICO_SIZES) {
      const e = ico.at(s);
      expect(e, `icon.ico missing ${s}x${s}`).toBeTruthy();
      expect(e.fmt).toBe('PNG');
    }
  });

  test('build/installer/assets/icon.ico matches icon.ico byte-for-byte', () => {
    expect(read('build/installer/assets/icon.ico').equals(read('build/icons/icon.ico'))).toBe(true);
  });

  test('icon.ico 256x256 entry is exactly icon.png (window/installer icon == app png)', () => {
    const ico = parseICO(read('build/icons/icon.ico'));
    expect(ico.at(256).blob.equals(read('build/icons/icon.png'))).toBe(true);
  });

  test('icon design is the black-background, green-text BP MD RTL Reader mark', () => {
    const img = decodePNG(read('build/icons/icon.png'));
    // Black background: the four corners are dark.
    const corners = [img.px(0, 0), img.px(255, 0), img.px(0, 255), img.px(255, 255)];
    const dark = corners.filter((p) => Math.max(p.r, p.g, p.b) < 60).length;
    expect(dark, 'expected dark corners (black background)').toBeGreaterThanOrEqual(3);
    // Green accent ("RTL READER" text): many vivid-green pixels exist.
    let green = 0;
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const p = img.px(x, y);
        if (p.g > 150 && p.g - p.r > 40 && p.g - p.b > 40) green++;
      }
    }
    expect(green, 'expected vivid-green pixels (RTL READER text)').toBeGreaterThanOrEqual(30);
  });
});
