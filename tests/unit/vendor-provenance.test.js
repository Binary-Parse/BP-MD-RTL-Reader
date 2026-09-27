import crypto from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relative) => readFileSync(path.join(root, relative));
const pkg = JSON.parse(read('package.json'));
const manifest = JSON.parse(read('resources/vendor/vendor-manifest.json'));
const manifestAsset = (relative) => manifest.assets.find((asset) => asset.file === relative);

describe('vendored runtime provenance (DEP-001, DEP-002)', () => {
  test('records exact direct source versions and content hashes', () => {
    for (const source of manifest.sources) {
      expect(pkg.devDependencies[source.package]).toBe(source.version);
    }
    for (const asset of manifest.assets) {
      const digest = crypto.createHash('sha256').update(read(asset.file)).digest('hex');
      expect(digest, asset.file).toBe(asset.sha256);
    }
  });

  test('ships the project, runtime dependency, and font license texts', () => {
    expect(pkg.build.files).toEqual(expect.arrayContaining([
      'LICENSE', 'THIRD-PARTY-NOTICES.md', 'resources/vendor/**',
    ]));
    expect(read('resources/vendor/THIRD-PARTY-LICENSES.txt').toString()).toContain('mermaid@11.16.1');
    expect(read('resources/vendor/fonts/OFL-1.1.txt').toString()).toContain(
      'SIL OPEN FONT LICENSE Version 1.1',
    );
  });

  test('all direct dependencies are pinned to exact versions', () => {
    for (const [name, version] of Object.entries(pkg.devDependencies)) {
      expect(version, name).toMatch(/^\d+(?:\.\d+){2}(?:[-+][0-9A-Za-z.-]+)?$/);
    }
  });
});

// The app fonts and the privileged NSIS EnVar plug-in are static repo assets, not npm
// outputs, so nothing else forces them into the manifest. A missing entry would leave the
// file swappable with no gate noise; the hash check below is what pins the bytes.
describe('static vendored assets are pinned (app fonts, EnVar.dll)', () => {
  const staticAssets = [
    ...readdirSync(path.join(root, 'resources/vendor/fonts'))
      .filter((file) => file.endsWith('.woff2')).sort()
      .map((file) => `resources/vendor/fonts/${file}`),
    'build/x86-unicode/EnVar.dll',
  ];

  test('the manifest carries an entry for every static asset', () => {
    for (const asset of staticAssets) {
      expect(manifestAsset(asset), asset).toBeDefined();
    }
  });

  test('each pinned static asset still hashes to its manifest entry', () => {
    for (const asset of staticAssets) {
      const digest = crypto.createHash('sha256').update(read(asset)).digest('hex');
      expect(digest, asset).toBe(manifestAsset(asset).sha256);
    }
  });
});
