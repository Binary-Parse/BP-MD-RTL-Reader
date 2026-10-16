import { describe, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  extractReleaseNotes,
  parseArgs,
  validateRelease,
} = require('../../scripts/release-preflight.js');
const { expectedArtifactNames } = require('../../scripts/release-artifacts.js');
const { buildManifest, osvAdvisoryIds } = require('../../scripts/security-scans.js');

const root = path.resolve(import.meta.dirname, '../..');
const pkg = require('../../package.json');
const changelog = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');

describe('v1 release preflight', () => {
  test('accepts this release and refuses a version that is not stable SemVer', () => {
    const base = {
      packageVersion: pkg.version,
      changelog,
      repository: 'Binary-Parse/BP-MD-RTL-Reader',
      skipArtifactCheck: true,
    };
    expect(validateRelease(base)).toEqual([]);
    expect(validateRelease({ ...base, packageVersion: '01.0.0' })).toContain(
      'package version 01.0.0 is not a stable SemVer release',
    );
  });

  test('extracts the actual version section as release notes', () => {
    const notes = extractReleaseNotes(changelog, '1.0.0');
    expect(notes).toContain('First public release');
    expect(notes).toContain('### Added');
    expect(notes).not.toContain('## [Unreleased]');
  });

});

// audit CMP-05: the SBOM/OSV scan artifacts must not silently predate the lockfile they
// were produced from. Real files in a temp dir with explicit mtimes — the gate is a
// pure statSync comparison.
describe('SBOM staleness gate (audit CMP-05)', () => {
  const base = {
    packageVersion: pkg.version,
    changelog,
    repository: 'Binary-Parse/BP-MD-RTL-Reader',
    skipArtifactCheck: true,
  };
  // B9 / M39: freshness is proven by the lockfile's SHA-256 recorded at scan time, never by
  // file dates, and a missing report fails instead of being skipped.
  const SBOM = JSON.stringify({ bomFormat: 'CycloneDX', components: [{ name: 'marked' }] });
  const OSV = 'No issues found\n';

  function fixture({ lock = '{"lockfileVersion":3}', sbom = SBOM, osv = OSV, manifest = 'recorded' } = {}) {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'preflight-sbom-'));
    const f = {
      dir,
      lockfilePath: path.join(dir, 'package-lock.json'),
      sbomPath: path.join(dir, 'sbom.json'),
      osvPath: path.join(dir, 'osv-scanner.txt'),
      scanManifestPath: path.join(dir, 'scan-manifest.json'),
    };
    if (lock !== null) writeFileSync(f.lockfilePath, lock);
    if (sbom !== null) writeFileSync(f.sbomPath, sbom);
    if (osv !== null) writeFileSync(f.osvPath, osv);
    if (manifest === 'recorded') {
      writeFileSync(f.scanManifestPath, JSON.stringify(buildManifest({
        lockBytes: Buffer.from(lock || ''), sbomBytes: Buffer.from(sbom || ''), osvBytes: Buffer.from(osv || ''),
      })));
    } else if (manifest !== null) {
      writeFileSync(f.scanManifestPath, manifest);
    }
    return f;
  }

  const withFixture = (spec, run) => {
    const f = fixture(spec);
    try { return run(f); } finally { rmSync(f.dir, { recursive: true, force: true }); }
  };
  const check = (f, extra = {}) => validateRelease({
    ...base, sbomPath: f.sbomPath, osvPath: f.osvPath, lockfilePath: f.lockfilePath, scanManifestPath: f.scanManifestPath, ...extra,
  });
  const ESCAPE = ', or pass --skip-sbom-staleness with a note in the release report';

  test('scans recorded for the lockfile on disk pass', () => {
    withFixture({}, (f) => expect(check(f)).toEqual([]));
  });

  test('file dates decide nothing: old reports of the same lockfile pass, new reports of another one fail', () => {
    withFixture({}, (f) => {
      const old = new Date('2020-01-01T00:00:00Z');
      for (const file of [f.sbomPath, f.osvPath, f.scanManifestPath]) utimesSync(file, old, old);
      expect(check(f)).toEqual([]);
      writeFileSync(f.lockfilePath, '{"lockfileVersion":3,"changed":true}');
      const future = new Date('2099-01-01T00:00:00Z');
      for (const file of [f.sbomPath, f.osvPath, f.scanManifestPath]) utimesSync(file, future, future);
      expect(check(f)).toEqual(['the SBOM and the OSV report were made from a different package-lock.json — run `npm run scan:deps`' + ESCAPE]);
    });
  });

  test('a missing SBOM, OSV report or scan record each fail the release (M39)', () => {
    withFixture({ sbom: null }, (f) => expect(check(f)).toEqual([f.sbomPath + ' is missing — run `npm run scan:deps`' + ESCAPE]));
    withFixture({ osv: null }, (f) => expect(check(f)).toEqual([f.osvPath + ' is missing — run `npm run scan:deps`' + ESCAPE]));
    withFixture({ manifest: null }, (f) => expect(check(f)).toEqual([f.scanManifestPath + ' is missing — run `npm run scan:deps`' + ESCAPE]));
    withFixture({ sbom: null, osv: null, manifest: null }, (f) => expect(check(f)).toHaveLength(3));
  });

  test('a missing lockfile fails: nothing can be proven without it', () => {
    withFixture({}, (f) => {
      rmSync(f.lockfilePath);
      expect(check(f)).toEqual([f.lockfilePath + ' is missing — run `npm run scan:deps`' + ESCAPE]);
    });
  });

  test('a report changed after the scan fails, each one by name', () => {
    withFixture({}, (f) => {
      writeFileSync(f.sbomPath, JSON.stringify({ bomFormat: 'CycloneDX', components: [{ name: 'other' }] }));
      expect(check(f)).toEqual([f.sbomPath + ' changed after the scan — run `npm run scan:deps`' + ESCAPE]);
    });
    withFixture({}, (f) => {
      writeFileSync(f.osvPath, 'edited\n');
      expect(check(f)).toEqual([f.osvPath + ' changed after the scan — run `npm run scan:deps`' + ESCAPE]);
    });
  });

  test('an SBOM that is not a CycloneDX document with components fails', () => {
    for (const sbom of ['{}', 'not json', JSON.stringify({ bomFormat: 'CycloneDX', components: [] }),
      JSON.stringify({ bomFormat: 'SPDX', components: [{ name: 'a' }] }), JSON.stringify({ bomFormat: 'CycloneDX', components: 'many' })]) {
      withFixture({ sbom }, (f) => expect(check(f)).toEqual([f.sbomPath + ' is not a CycloneDX document with components — run `npm run scan:deps`' + ESCAPE]));
    }
  });

  test('a scan record that is not JSON, or not an object, fails', () => {
    for (const manifest of ['{ nope', 'null', '7']) {
      withFixture({ manifest }, (f) => expect(check(f)).toEqual([f.scanManifestPath + ' is not valid JSON — run `npm run scan:deps`' + ESCAPE]));
    }
  });

  test('an advisory in the OSV report must be reviewed in the acceptance file', () => {
    const osv = '| https://osv.dev/GHSA-aaaa-bbbb-cccc | 8.7 | npm | braces |\n| https://osv.dev/GHSA-dddd-eeee-ffff | 2.1 | npm | katex |\n| https://osv.dev/GHSA-aaaa-bbbb-cccc | again |\n';
    withFixture({ osv }, (f) => {
      expect(check(f, { acceptedAdvisories: ['GHSA-aaaa-bbbb-cccc', 'GHSA-dddd-eeee-ffff'] })).toEqual([]);
      expect(check(f, { acceptedAdvisories: ['GHSA-aaaa-bbbb-cccc'] }))
        .toEqual([f.osvPath + ' reports GHSA-dddd-eeee-ffff, which is not reviewed in config/audit-acceptance.json' + ESCAPE]);
      expect(check(f)).toHaveLength(2); // nothing accepted: each advisory once
    });
  });

  test('skipSbomStaleness escapes every scan problem (the --skip-sbom-staleness flag)', () => {
    withFixture({ sbom: null, osv: null, manifest: null }, (f) => expect(check(f, { skipSbomStaleness: true })).toEqual([]));
  });

  test('the scan record holds the SHA-256 of the lockfile and of both reports', () => {
    const manifest = buildManifest({
      lockBytes: Buffer.from('lock'), sbomBytes: Buffer.from('sbom'), osvBytes: Buffer.from('osv'),
      tools: { syft: '1.0' }, now: new Date('2026-10-11T08:00:00Z'),
    });
    const hex = (text) => createHash('sha256').update(text).digest('hex');
    expect(manifest).toEqual({
      schemaVersion: 1, generatedAt: '2026-10-11T08:00:00.000Z',
      lockfileSha256: hex('lock'), sbomSha256: hex('sbom'), osvSha256: hex('osv'), tools: { syft: '1.0' },
    });
    expect(buildManifest({ lockBytes: Buffer.from('a'), sbomBytes: Buffer.from('b'), osvBytes: Buffer.from('c') }).tools).toEqual({});
  });

  test('osvAdvisoryIds reads each linked id once and nothing from a clean report', () => {
    expect(osvAdvisoryIds('x https://osv.dev/GHSA-1 y https://osv.dev/CVE-2026-1 z https://osv.dev/GHSA-1')).toEqual(['GHSA-1', 'CVE-2026-1']);
    expect(osvAdvisoryIds('No issues found\n')).toEqual([]);
    expect(osvAdvisoryIds(undefined)).toEqual([]);
  });

  test('parseArgs takes the new flag and still rejects unknown arguments', () => {
    expect(parseArgs(['--skip-sbom-staleness'])).toEqual({
      skipSbomStaleness: true, skipArtifactCheck: false,
    });
    expect(() => parseArgs(['--write-notes', 'out.md'])).toThrow('Unknown argument: --write-notes');
    expect(parseArgs(['--skip-artifact-check'])).toEqual({
      skipSbomStaleness: false, skipArtifactCheck: true,
    });
    expect(() => parseArgs(['--nope'])).toThrow('Unknown argument: --nope');
  });
});

// The dist/release gate: absent artifacts fail hard unless --skip-artifact-check is passed,
// and a populated directory must be exactly the public allowlist with a SHA256SUMS.txt whose
// bytes match. Real files in a temp dir — the gate is a readdir plus a hash comparison.
describe('release artifact gate (--skip-artifact-check)', () => {
  const base = {
    packageVersion: pkg.version,
    changelog,
    repository: 'Binary-Parse/BP-MD-RTL-Reader',
    skipArtifactCheck: false,
  };
  const CHECKSUM_FILE = 'SHA256SUMS.txt';

  const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

  function fixture(kind) {
    const parent = mkdtempSync(path.join(os.tmpdir(), 'preflight-artifacts-'));
    const dir = path.join(parent, 'release');
    if (kind !== 'absent') {
      mkdirSync(dir);
      const names = expectedArtifactNames(pkg.version);
      for (const name of names) writeFileSync(path.join(dir, name), 'artifact');
      if (kind === 'extra') writeFileSync(path.join(dir, 'BP-MD-RTL-Reader-Extra.exe'), 'surprise');
      if (kind !== 'no-checksums') {
        const lines = names.slice().sort().map((name) => `${sha256(path.join(dir, name))}  ${name}`);
        writeFileSync(path.join(dir, CHECKSUM_FILE), `${lines.join('\n')}\n`);
        if (kind === 'tampered') writeFileSync(path.join(dir, names[0]), 'tampered');
      }
    }
    return dir;
  }

  const withFixture = (kind, run) => {
    const dir = fixture(kind);
    try { return run(dir); } finally { rmSync(path.dirname(dir), { recursive: true, force: true }); }
  };

  test('an absent release directory fails the release and names the escape hatch', () => {
    withFixture('absent', (dir) => {
      const errors = validateRelease({ ...base, releaseDir: dir });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain(`Release directory does not exist: ${dir}`);
      expect(errors[0]).toContain('--skip-artifact-check');
    });
  });

  test('skipArtifactCheck escapes an absent release directory', () => {
    withFixture('absent', (dir) => {
      expect(validateRelease({ ...base, releaseDir: dir, skipArtifactCheck: true })).toEqual([]);
    });
  });

  test('the exact public allowlist with a matching SHA256SUMS.txt passes', () => {
    withFixture('complete', (dir) => {
      expect(validateRelease({ ...base, releaseDir: dir })).toEqual([]);
    });
  });

  test('a populated directory without SHA256SUMS.txt fails', () => {
    withFixture('no-checksums', (dir) => {
      const errors = validateRelease({ ...base, releaseDir: dir });
      expect(errors).toContain(`missing ${CHECKSUM_FILE}`);
    });
  });

  test('an artifact outside the public allowlist fails', () => {
    withFixture('extra', (dir) => {
      const errors = validateRelease({ ...base, releaseDir: dir });
      expect(errors).toContain('unexpected artifact BP-MD-RTL-Reader-Extra.exe');
    });
  });

  test('a checksum that no longer matches the file bytes fails', () => {
    withFixture('tampered', (dir) => {
      const errors = validateRelease({ ...base, releaseDir: dir });
      expect(errors.filter((error) => error.includes('checksum mismatch'))).toHaveLength(1);
    });
  });
});
