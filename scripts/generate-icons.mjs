#!/usr/bin/env node
/**
 * generate-icons.mjs — rebuild every icon artifact from the two SVG sources.
 *
 * Sources (tracked):
 *   build/icons/icon-source.svg               — app icon (navy tile, coral kashida, reed pen)
 *   build/icons/markdown-file-icon-source.svg — Markdown document icon (ivory page, navy kashida)
 *
 * Outputs (overwritten):
 *   build/icons/icon.png                      — 256x256 PNG (app/window icon, Linux + fallback)
 *   build/icons/icon.ico                      — PNG-in-ICO entries 256, 48, 32, 16
 *   build/installer/assets/icon.ico           — byte-identical copy (Inno Setup / NSIS)
 *   docs/assets/icon.png                      — byte-identical copy of icon.png (README)
 *   build/icons/markdown-file-icon.png        — 256x256 transparent PNG
 *   build/icons/markdown-file-icon.ico        — PNG-in-ICO entries 256, 48, 32, 16
 *
 * Each size is rasterized directly from the SVG by headless Chromium (Playwright),
 * so small sizes are drawn at their own resolution instead of downscaled.
 *
 * Run (from anywhere):
 *   node scripts/generate-icons.mjs
 *   npm run icons:generate
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

// All paths below are relative to the repo root, so run from there.
process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), '..'));

const ICO_SIZES = [256, 48, 32, 16]; // order preserved in the ICO directory
const SVG_SIZE = 512; // width/height attributes of the source SVGs

async function rasterize(page, svgText, size) {
  const sized = svgText.replace(
    `width="${SVG_SIZE}" height="${SVG_SIZE}"`,
    `width="${size}" height="${size}"`,
  );
  if (sized === svgText) {
    throw new Error(`SVG source has no width="${SVG_SIZE}" height="${SVG_SIZE}" to resize`);
  }
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<!doctype html><html><body style="margin:0;background:transparent">${sized}</body></html>`,
  );
  return page.locator('svg').screenshot({ omitBackground: true });
}

async function renderAllSizes(page, svgText) {
  const pngBySize = new Map();
  for (const size of ICO_SIZES) {
    pngBySize.set(size, await rasterize(page, svgText, size));
  }
  return pngBySize;
}

function buildIco(pngBySize) {
  const count = ICO_SIZES.length;
  const header = Buffer.alloc(6 + 16 * count);
  header.writeUInt16LE(0, 0); // idReserved
  header.writeUInt16LE(1, 2); // idType = icon
  header.writeUInt16LE(count, 4); // idCount
  let offset = header.length;
  ICO_SIZES.forEach((size, index) => {
    const png = pngBySize.get(size);
    const o = 6 + 16 * index;
    const dim = size >= 256 ? 0 : size; // 0 means 256 in an ICONDIRENTRY
    header.writeUInt8(dim, o); // bWidth
    header.writeUInt8(dim, o + 1); // bHeight
    header.writeUInt8(0, o + 2); // bColorCount
    header.writeUInt8(0, o + 3); // bReserved
    header.writeUInt16LE(1, o + 4); // wPlanes
    header.writeUInt16LE(32, o + 6); // wBitCount
    header.writeUInt32LE(png.length, o + 8); // dwBytesInRes
    header.writeUInt32LE(offset, o + 12); // dwImageOffset
    offset += png.length;
  });
  return Buffer.concat([header, ...ICO_SIZES.map((size) => pngBySize.get(size))]);
}

const browser = await chromium.launch();
let appPngs;
let markdownPngs;
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  appPngs = await renderAllSizes(page, await readFile('build/icons/icon-source.svg', 'utf8'));
  markdownPngs = await renderAllSizes(
    page,
    await readFile('build/icons/markdown-file-icon-source.svg', 'utf8'),
  );
} finally {
  await browser.close();
}

const appIco = buildIco(appPngs);
const markdownIco = buildIco(markdownPngs);
await writeFile('build/icons/icon.png', appPngs.get(256));
await writeFile('build/icons/icon.ico', appIco);
await writeFile('build/icons/markdown-file-icon.png', markdownPngs.get(256));
await writeFile('build/icons/markdown-file-icon.ico', markdownIco);

// Byte-identical copies of the app icon.
await copyFile('build/icons/icon.ico', 'build/installer/assets/icon.ico');
await copyFile('build/icons/icon.png', 'docs/assets/icon.png');

console.log(`build/icons/icon.png (256 px, ${appPngs.get(256).length} bytes)`);
console.log(`build/icons/icon.ico (${ICO_SIZES.join(',')} px, ${appIco.length} bytes)`);
console.log(`build/icons/markdown-file-icon.png (256 px, ${markdownPngs.get(256).length} bytes)`);
console.log(`build/icons/markdown-file-icon.ico (${ICO_SIZES.join(',')} px, ${markdownIco.length} bytes)`);
console.log('copied icon.ico -> build/installer/assets/, icon.png -> docs/assets/');
