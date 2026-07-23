import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relative) => readFileSync(path.join(root, relative));
const pkg = JSON.parse(read('package.json'));
const manifest = JSON.parse(read('resources/vendor/vendor-manifest.json'));

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
    expect(read('resources/vendor/THIRD-PARTY-LICENSES.txt').toString()).toContain('mermaid@11.15.0');
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
