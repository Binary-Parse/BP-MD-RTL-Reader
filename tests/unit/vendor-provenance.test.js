import crypto from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
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

  // B10: the notices named DOMPurify 3.4.13 and KaTeX 0.17.0 while the shipped files were newer.
  test('THIRD-PARTY-NOTICES.md names the versions that are actually vendored', () => {
    const notices = read('THIRD-PARTY-NOTICES.md').toString();
    const version = (name) => manifest.sources.find((source) => source.package === name).version;
    for (const [label, name] of [
      ['marked', 'marked'], ['DOMPurify', 'dompurify'], ['KaTeX', 'katex'],
      ['highlight.js', 'highlight.js'], ['Mermaid', 'mermaid'], ['Lucide Static', 'lucide-static'],
    ]) {
      expect(notices, label).toContain(`[${label} ${version(name)}]`);
    }
  });

  test('all direct dependencies are pinned to exact versions', () => {
    for (const [name, version] of Object.entries(pkg.devDependencies)) {
      expect(version, name).toMatch(/^\d+(?:\.\d+){2}(?:[-+][0-9A-Za-z.-]+)?$/);
    }
  });
});

// Audit B10: the licence file had no text for packages bundled inside mermaid.min.js
// (chevrotain, langium, venn.js, vscode-languageserver, vscode-jsonrpc ...). The generator
// located packages with require.resolve, which fails for ESM-only packages, and skipped the
// failure silently together with everything below it.
// These tests read the licence files of the whole dependency closure from disk: over the
// 5 s default on a busy machine.
describe('bundled licence texts cover the whole dependency closure (B10)', { timeout: 60000 }, () => {
  const require = createRequire(import.meta.url);
  const {
    RUNTIME_ROOTS, packageDir, collectRuntimeLicenses, packagesInSources,
  } = require('../../scripts/sync-vendor.js');
  const licenses = read('resources/vendor/THIRD-PARTY-LICENSES.txt').toString();
  const sectionKeys = [...licenses.matchAll(/^={78}\n(\S+@\S+) — .*\n={78}$/gm)].map((match) => match[1]);

  // The closure, computed here from the installed tree and independently of the generator:
  // every package reachable through `dependencies` from the libraries we vendor.
  function closure() {
    const found = new Map();
    const locate = (name, from) => {
      for (let dir = from; ; dir = path.dirname(dir)) {
        const candidate = path.join(dir, 'node_modules', name);
        if (existsSync(path.join(candidate, 'package.json'))) return realpathSync(candidate);
        if (dir === root || dir === path.dirname(dir)) return null;
      }
    };
    const visit = (name, from) => {
      const dir = locate(name, from);
      expect(dir, `${name} (needed from ${from}) is not installed`).not.toBeNull();
      const manifest = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
      const key = `${manifest.name}@${manifest.version}`;
      if (found.has(key)) return;
      found.set(key, manifest);
      for (const dependency of Object.keys(manifest.dependencies || {})) visit(dependency, dir);
    };
    for (const name of RUNTIME_ROOTS) visit(name, path.resolve(root));
    return found;
  }

  // What prebuilt files carry inside them, read from the source maps they ship with. Computed
  // here with its own parser, for the two packages whose prebuilt code we vendor.
  function inlinedNames() {
    const names = new Set();
    const mapsUnder = (dir) => readdirSync(dir, { recursive: true }).map(String)
      .filter((file) => file.endsWith('.map')).map((file) => path.join(dir, file));
    const mermaidDir = path.join(root, 'node_modules', 'mermaid');
    const parserDir = path.join(root, 'node_modules', '@mermaid-js', 'parser');
    for (const mapFile of [...mapsUnder(path.join(mermaidDir, 'dist')), ...mapsUnder(path.join(parserDir, 'dist'))]) {
      for (const source of JSON.parse(readFileSync(mapFile, 'utf8')).sources) {
        const match = /^.*node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(source);
        if (match) names.add(match[1]);
      }
    }
    return names;
  }
  const supplements = JSON.parse(read('scripts/license-supplements/manifest.json')).packages;
  const sectionNames = new Set(sectionKeys.map((key) => key.slice(0, key.lastIndexOf('@'))));

  test('every installed package in the closure has its own section', () => {
    const expected = [...closure().keys()];
    expect(expected.length).toBeGreaterThan(100);
    for (const key of expected) expect(sectionKeys, key).toContain(key);
  });

  test('every package inlined in mermaid or its parser has a section', () => {
    const inlined = [...inlinedNames()].sort();
    expect(inlined).toEqual(expect.arrayContaining(['chevrotain', 'langium', 'vscode-jsonrpc', 'js-yaml', 'cytoscape']));
    for (const name of inlined) expect(sectionNames.has(name), name).toBe(true);
  });

  test('the file has no section beyond the closure and the tracked supplements, and none is empty', () => {
    const expected = [...closure().keys(), ...supplements.map((entry) => `${entry.name}@${entry.version}`)].sort();
    expect([...sectionKeys].sort()).toEqual(expected);
    const bodies = licenses.split(/^={78}\n\S+@\S+ — .*\n={78}$/m).slice(1);
    expect(bodies).toHaveLength(expected.length);
    for (const [index, body] of bodies.entries()) {
      expect(body.trim().length, sectionKeys[index]).toBeGreaterThan(100);
    }
  });

  test.each([
    ['chevrotain', 'Apache License'], ['@chevrotain/gast', 'Apache License'],
    ['@chevrotain/regexp-to-ast', 'Apache License'], ['@chevrotain/utils', 'Apache License'],
    ['chevrotain-allstar', 'TypeFox'], ['langium', 'TypeFox'],
    ['vscode-jsonrpc', 'Microsoft Corporation'], ['vscode-languageserver-protocol', 'Microsoft Corporation'],
    ['vscode-languageserver-types', 'Microsoft Corporation'], ['vscode-languageserver-textdocument', 'Microsoft Corporation'],
    ['js-yaml', 'Vitaly Puzrin'], ['path-browserify', 'Permission is hereby granted'],
    ['@upsetjs/venn.js', 'Permission is hereby granted'], ['@mermaid-js/parser', 'Permission is hereby granted'],
  ])('the audit package %s is covered by its own licence text', (name, marker) => {
    const index = sectionKeys.findIndex((key) => key.startsWith(`${name}@`));
    expect(index, name).toBeGreaterThanOrEqual(0);
    const body = licenses.split(/^={78}\n\S+@\S+ — .*\n={78}$/m).slice(1)[index];
    expect(body).toContain(marker);
  });

  test('each tracked supplement text still has the hash recorded for it', () => {
    expect(supplements.length).toBeGreaterThan(0);
    for (const entry of supplements) {
      const text = read(`scripts/license-supplements/${entry.file}`);
      expect(crypto.createHash('sha256').update(text).digest('hex'), entry.file).toBe(entry.sha256);
      expect(entry.file).toBe(`${entry.name.replace('/', '__')}@${entry.version}.txt`);
    }
  });

  test('the committed file is exactly what the generator produces today', () => {
    expect(collectRuntimeLicenses()).toBe(licenses);
  });

  test('a dependency that cannot be located stops the generator instead of being skipped', () => {
    expect(() => packageDir('bpmd-no-such-package-b10')).toThrow(/Could not locate installed package bpmd-no-such-package-b10/);
    expect(() => collectRuntimeLicenses(['marked', 'bpmd-no-such-package-b10'])).toThrow(/bpmd-no-such-package-b10/);
  });

  test('an inlined package without a tracked licence text stops the generator', () => {
    const tracked = new Map(supplements.map((entry) => [entry.name, entry]));
    const without = new Map(tracked);
    without.delete('langium');
    expect(() => collectRuntimeLicenses(RUNTIME_ROOTS, { supplements: without }))
      .toThrow(/No license text for langium \(4\.2\.0\)/);
    const wrongVersion = new Map(tracked).set('langium', { ...tracked.get('langium'), version: '3.0.0' });
    expect(() => collectRuntimeLicenses(RUNTIME_ROOTS, { supplements: wrongVersion }))
      .toThrow(/License supplement for langium is 3\.0\.0 but the bundle inlines 4\.2\.0/);
    const tampered = new Map(tracked).set('langium', { ...tracked.get('langium'), sha256: '0'.repeat(64) });
    expect(() => collectRuntimeLicenses(RUNTIME_ROOTS, { supplements: tampered }))
      .toThrow(/License supplement changed: langium@4\.2\.0\.txt/);
  }, 60000); // reads every source map of 137 packages



  test('packages without a main entry are located (the cause of the gap)', () => {
    for (const name of ['@mermaid-js/parser', '@upsetjs/venn.js']) {
      const dir = packageDir(name, packageDir('mermaid'));
      expect(JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')).name).toBe(name);
    }
  });

  test('packagesInSources reads names and pnpm versions from source-map paths', () => {
    const found = packagesInSources([
      '../src/own-code.ts',
      '../../../node_modules/.pnpm/chevrotain@11.1.2/node_modules/chevrotain/lib/src/api.js',
      '../../../node_modules/.pnpm/@chevrotain+gast@11.1.2/node_modules/@chevrotain/gast/lib/src/model.js',
      '../../../node_modules/.pnpm/langium@4.2.0_peer@1.0.0/node_modules/langium/lib/index.js',
      '../../../node_modules/.pnpm/langium@4.2.0_peer@1.0.0/node_modules/vscode-uri/lib/esm/index.mjs',
      '../../node_modules/d3-array/src/max.js',
      '../../node_modules/@scope/pkg/index.js',
    ]);
    expect(Object.fromEntries([...found].map(([name, versions]) => [name, [...versions]]))).toEqual({
      chevrotain: ['11.1.2'],
      '@chevrotain/gast': ['11.1.2'],
      langium: ['4.2.0'],
      'vscode-uri': [null], // the store directory belongs to langium, not to this package
      'd3-array': [null],
      '@scope/pkg': [null],
    });
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
