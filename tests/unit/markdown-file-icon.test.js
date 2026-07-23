/**
 * Dedicated Markdown document icon guard.
 *
 * The Markdown file-association artwork is intentionally separate from the
 * application/window/installer icon. These tests pin that boundary and the
 * Windows packaging paths used by both NSIS and Inno Setup.
 */
import { describe, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel));
const json = (rel) => JSON.parse(read(rel).toString('utf8'));
const sha256 = (rel) => createHash('sha256').update(read(rel)).digest('hex').toUpperCase();

function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len;
  }
  const channels = colorType === 6 ? 4 : 0;
  if (channels !== 4 || bitDepth !== 8 || interlace !== 0) {
    throw new Error(`expected non-interlaced 8-bit RGBA PNG, got colorType=${colorType}`);
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    for (let x = 0; x < stride; x++) {
      const encoded = raw[pos++];
      const left = x >= channels ? out[y * stride + x - channels] : 0;
      const up = y > 0 ? out[(y - 1) * stride + x] : 0;
      const upperLeft = x >= channels && y > 0
        ? out[(y - 1) * stride + x - channels]
        : 0;
      let value;
      switch (filter) {
        case 0:
          value = encoded;
          break;
        case 1:
          value = encoded + left;
          break;
        case 2:
          value = encoded + up;
          break;
        case 3:
          value = encoded + ((left + up) >> 1);
          break;
        case 4: {
          const p = left + up - upperLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upperLeft);
          value = encoded + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upperLeft);
          break;
        }
        default:
          throw new Error(`unsupported PNG filter ${filter}`);
      }
      out[y * stride + x] = value & 0xff;
    }
  }
  const px = (x, y) => {
    const i = (y * width + x) * channels;
    return { r: out[i], g: out[i + 1], b: out[i + 2], a: out[i + 3] };
  };
  return { width, height, px };
}

function parseICO(buf) {
  if (buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) throw new Error('not an ICO');
  const count = buf.readUInt16LE(4);
  const entries = [];
  for (let i = 0; i < count; i++) {
    const off = 6 + i * 16;
    const width = buf[off] || 256;
    const height = buf[off + 1] || 256;
    const byteLength = buf.readUInt32LE(off + 8);
    const imageOffset = buf.readUInt32LE(off + 12);
    const blob = buf.subarray(imageOffset, imageOffset + byteLength);
    entries.push({
      width,
      height,
      format: blob.readUInt32BE(0) === 0x89504e47 ? 'PNG' : 'BMP',
      blob,
    });
  }
  return entries;
}

describe('Markdown file-association icon', () => {
  test('prepared PNG has transparent corners and visible BP MD artwork', () => {
    const image = decodePNG(read('build/icons/markdown-file-icon.png'));
    expect([image.width, image.height]).toEqual([256, 256]);
    for (const [x, y] of [[0, 0], [255, 0], [0, 255], [255, 255]]) {
      expect(image.px(x, y).a, `corner ${x},${y} should be transparent`).toBe(0);
    }

    let opaque = 0;
    let vividGreen = 0;
    let dark = 0;
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        const pixel = image.px(x, y);
        if (pixel.a > 240) opaque++;
        if (pixel.a > 200 && pixel.g > 140 && pixel.g - pixel.r > 35 && pixel.g - pixel.b > 35) {
          vividGreen++;
        }
        if (pixel.a > 200 && Math.max(pixel.r, pixel.g, pixel.b) < 65) dark++;
      }
    }
    expect(opaque).toBeGreaterThan(20_000);
    expect(opaque).toBeLessThan(60_000);
    expect(vividGreen).toBeGreaterThan(150);
    expect(dark).toBeGreaterThan(1_000);
  });

  test('ICO contains PNG-compressed 16, 32, 48, and 256 pixel entries', () => {
    const entries = parseICO(read('build/icons/markdown-file-icon.ico'));
    expect(entries.map(({ width }) => width).sort((a, b) => a - b)).toEqual([16, 32, 48, 256]);
    expect(entries.every(({ width, height, format }) => width === height && format === 'PNG')).toBe(true);
    expect(entries.find(({ width }) => width === 256).blob.equals(read('build/icons/markdown-file-icon.png'))).toBe(true);
  });

  test('both Markdown extensions use the dedicated Windows icon resource', () => {
    const pkg = json('package.json');
    expect(pkg.build.fileAssociations).toEqual([
      expect.objectContaining({ ext: 'md', icon: 'build/icons/markdown-file-icon.ico' }),
      expect.objectContaining({ ext: 'markdown', icon: 'build/icons/markdown-file-icon.ico' }),
    ]);
    expect(pkg.build.win.extraResources).toContainEqual({
      from: 'build/icons/markdown-file-icon.ico',
      to: 'markdown-file-icon.ico',
    });

    const policy = json('build/installer/source-manifest-policy.json');
    expect(policy.files).toContain('resources/markdown-file-icon.ico');
    expect(policy.files).toHaveLength(75);
  });

  test('the dedicated generator is present and existing app icons are unchanged', () => {
    expect(read('scripts/generate-markdown-file-icon.ps1').length).toBeGreaterThan(0);
    expect(sha256('build/icons/icon-source.png')).toBe('5842FF32AE83E715461DD3AB2FC29931B234A5992E98EB969A7283E28351B697');
    expect(sha256('build/icons/icon.png')).toBe('F4E7C6CBAF7A6DA73534CDB059E7C6CDE036C45548EEC655452C6A352B4128D3');
    expect(sha256('build/icons/icon.ico')).toBe('4B51D7326E0564C016EC305EEE59A7EB2DE937915BE984E3A0C0B5B9A48DC421');
    expect(sha256('build/installer/assets/icon.ico')).toBe('4B51D7326E0564C016EC305EEE59A7EB2DE937915BE984E3A0C0B5B9A48DC421');
  });
});
