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

const root = path.resolve(import.meta.dirname, '../..');
const pkg = require('../../package.json');
const changelog = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');

describe('v1 release preflight', () => {
  test('accepts private validation but refuses private publication and wrong tags', () => {
    const base = {
      packageVersion: pkg.version,
      changelog,
      repository: 'Binary-Parse/BP-MD-RTL-Reader',
      visibility: 'private',
      publish: false,
      refType: 'branch',
      refName: 'release/v1.0.0-readiness',
      skipArtifactCheck: true,
    };
    expect(validateRelease(base)).toEqual([]);
    expect(validateRelease({ ...base, publish: true, refType: 'tag', refName: 'v1.0.0' })).toContain(
      'publishing requires a public repository',
    );
    expect(validateRelease({ ...base, visibility: 'public', publish: true, refType: 'tag', refName: 'v1.0.2' })).toContain(
      `release tag v1.0.2 does not match package version ${pkg.version}`,
    );
    expect(validateRelease({ ...base, visibility: 'public', publish: true, refType: 'branch', refName: 'main' })).toContain(
      `publishing is allowed only from an annotated v${pkg.version} tag`,
    );
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
    visibility: 'private',
    publish: false,
    refType: 'branch',
    refName: 'main',
    skipArtifactCheck: true,
  };
  const LOCK_MTIME = new Date('2026-09-03T12:00:00Z');
  const STALE_MTIME = new Date('2026-08-22T12:00:00Z');
  const FRESH_MTIME = new Date('2026-09-04T12:00:00Z');

  function fixture(ages) {
    const spec = typeof ages === 'string' ? { sbom: ages } : (ages || {});
    const dir = mkdtempSync(path.join(os.tmpdir(), 'preflight-sbom-'));
    const lockfilePath = path.join(dir, 'package-lock.json');
    const sbomPath = path.join(dir, 'sbom.json');
    const osvPath = path.join(dir, 'osv-scanner.txt');
    writeFileSync(lockfilePath, '{}');
    utimesSync(lockfilePath, LOCK_MTIME, LOCK_MTIME);
    const mtimeOf = (age) => (age === 'stale' ? STALE_MTIME : FRESH_MTIME);
    for (const [name, artifactPath] of [['sbom', sbomPath], ['osv', osvPath]]) {
      if (spec[name]) {
        writeFileSync(artifactPath, '{}');
        utimesSync(artifactPath, mtimeOf(spec[name]), mtimeOf(spec[name]));
      }
    }
    return { dir, sbomPath, osvPath, lockfilePath };
  }

  const withFixture = (ages, run) => {
    const f = fixture(ages);
    try { return run(f); } finally { rmSync(f.dir, { recursive: true, force: true }); }
  };

  test('a scan older than the lockfile fails the release', () => {
    withFixture('stale', (f) => {
      const errors = validateRelease({ ...base, sbomPath: f.sbomPath, osvPath: f.osvPath, lockfilePath: f.lockfilePath });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain(`${f.sbomPath} predates ${f.lockfilePath}`);
      expect(errors[0]).toContain('--skip-sbom-staleness');
    });
  });

  test('an OSV report older than the lockfile fails the release even with a fresh SBOM (audit GATE-02)', () => {
    withFixture({ sbom: 'fresh', osv: 'stale' }, (f) => {
      const errors = validateRelease({ ...base, sbomPath: f.sbomPath, osvPath: f.osvPath, lockfilePath: f.lockfilePath });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain(`${f.osvPath} predates ${f.lockfilePath}`);
    });
  });

  test('both stale artifacts are each reported', () => {
    withFixture({ sbom: 'stale', osv: 'stale' }, (f) => {
      const errors = validateRelease({ ...base, sbomPath: f.sbomPath, osvPath: f.osvPath, lockfilePath: f.lockfilePath });
      expect(errors).toHaveLength(2);
    });
  });

  test('fresh scans pass', () => {
    withFixture({ sbom: 'fresh', osv: 'fresh' }, (f) => {
      expect(validateRelease({ ...base, sbomPath: f.sbomPath, osvPath: f.osvPath, lockfilePath: f.lockfilePath })).toEqual([]);
    });
  });

  test('skipSbomStaleness escapes a stale scan (the --skip-sbom-staleness flag)', () => {
    withFixture('stale', (f) => {
      expect(validateRelease({ ...base, sbomPath: f.sbomPath, osvPath: f.osvPath, lockfilePath: f.lockfilePath, skipSbomStaleness: true }))
        .toEqual([]);
    });
  });

  test('absent artifacts are not this gate\'s concern', () => {
    withFixture(null, (f) => {
      expect(validateRelease({ ...base, sbomPath: f.sbomPath, osvPath: f.osvPath, lockfilePath: f.lockfilePath })).toEqual([]);
      expect(() => validateRelease({ ...base, sbomPath: f.sbomPath, osvPath: f.osvPath, lockfilePath: f.lockfilePath })).not.toThrow();
    });
  });

  test('parseArgs takes the new flag and still rejects unknown arguments', () => {
    expect(parseArgs(['--skip-sbom-staleness'])).toEqual({
      writeNotes: '', skipSbomStaleness: true, skipArtifactCheck: false,
    });
    expect(parseArgs(['--write-notes', 'out.md'])).toEqual({
      writeNotes: 'out.md', skipSbomStaleness: false, skipArtifactCheck: false,
    });
    expect(parseArgs(['--skip-artifact-check'])).toEqual({
      writeNotes: '', skipSbomStaleness: false, skipArtifactCheck: true,
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
    visibility: 'private',
    publish: false,
    refType: 'branch',
    refName: 'main',
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
