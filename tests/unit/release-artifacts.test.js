import { afterEach, describe, expect, test } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  PUBLIC_ARTIFACT_NAMES,
  expectedArtifactNames,
  validateReleaseEntries,
} = require('../../scripts/release-artifacts.js');
const {
  verifyChecksums,
  writeChecksums,
} = require('../../scripts/write-artifact-checksums.js');
const pkg = require('../../package.json');

const temporary = [];
afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function releaseDirectory() {
  const directory = mkdtempSync(path.join(tmpdir(), 'bpmd-release-'));
  temporary.push(directory);
  return directory;
}

function seedArtifacts(directory, version = '1.0.0') {
  for (const name of expectedArtifactNames(version)) {
    writeFileSync(path.join(directory, name), `artifact:${name}`);
  }
}

describe('public v1 release artifact contract', () => {
  test('pins the exact supported public filenames', () => {
    expect(PUBLIC_ARTIFACT_NAMES).toEqual([
      'BP-MD-RTL-Reader-{version}-Windows-NSIS-multiarch.exe',
      'BP-MD-RTL-Reader-{version}-Windows-Portable-multiarch.exe',
      'BP-MD-RTL-Reader-{version}-Windows-Inno-x64.exe',
      'BP-MD-RTL-Reader-{version}-Windows-Inno-x64.source-manifest.json',
      'BP-MD-RTL-Reader-{version}-macOS-x64.dmg',
      'BP-MD-RTL-Reader-{version}-macOS-arm64.dmg',
      'BP-MD-RTL-Reader-{version}-macOS-x64.zip',
      'BP-MD-RTL-Reader-{version}-macOS-arm64.zip',
      'BP-MD-RTL-Reader-{version}-Linux-x64.AppImage',
      'BP-MD-RTL-Reader-{version}-Linux-arm64.AppImage',
      'BP-MD-RTL-Reader-{version}-Linux-x64.deb',
      'BP-MD-RTL-Reader-{version}-Linux-arm64.deb',
    ]);
  });

  test('rejects missing, extra, duplicate, and case-colliding entries', () => {
    const exact = expectedArtifactNames('1.0.0');
    expect(validateReleaseEntries(exact, '1.0.0')).toEqual([]);
    expect(validateReleaseEntries(exact.slice(1), '1.0.0')).toContain(`missing artifact ${exact[0]}`);
    expect(validateReleaseEntries([...exact, 'surprise.exe'], '1.0.0')).toContain('unexpected artifact surprise.exe');
    expect(validateReleaseEntries([...exact, exact[0]], '1.0.0')).toContain(`duplicate artifact ${exact[0]}`);
    expect(validateReleaseEntries([...exact, exact[0].toUpperCase()], '1.0.0')).toContain(
      `case-insensitive artifact collision ${exact[0]} / ${exact[0].toUpperCase()}`,
    );
    expect(() => expectedArtifactNames('01.0.0')).toThrow(/Invalid release version/);
  });

  test('writes and verifies one canonical SHA-256 manifest for only the exact allowlist', () => {
    const directory = releaseDirectory();
    seedArtifacts(directory);
    const checksumPath = writeChecksums(directory, '1.0.0');
    const lines = readFileSync(checksumPath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(12);
    expect(lines.map(line => line.slice(66))).toEqual(expectedArtifactNames('1.0.0').slice().sort());
    expect(verifyChecksums(directory, '1.0.0')).toEqual([]);
  });

  test('fails closed for extra files and checksum tampering', () => {
    const directory = releaseDirectory();
    seedArtifacts(directory);
    writeChecksums(directory, '1.0.0');
    writeFileSync(path.join(directory, expectedArtifactNames('1.0.0')[0]), 'tampered');
    expect(verifyChecksums(directory, '1.0.0')).toContain(
      `checksum mismatch ${expectedArtifactNames('1.0.0')[0]}`,
    );
    writeFileSync(path.join(directory, 'surprise.exe'), 'unexpected');
    expect(() => writeChecksums(directory, '1.0.0')).toThrow(/unexpected artifact surprise\.exe/);
  });

  test('rejects a valid but non-canonical checksum line order', () => {
    const directory = releaseDirectory();
    seedArtifacts(directory);
    const checksumPath = writeChecksums(directory, '1.0.0');
    const lines = readFileSync(checksumPath, 'utf8').trim().split('\n').reverse();
    writeFileSync(checksumPath, `${lines.join('\n')}\n`);
    expect(verifyChecksums(directory, '1.0.0')).toContain('SHA256SUMS.txt is not canonical');
  });

  test('package metadata and electron-builder names match the public contract', () => {
    expect(pkg.repository).toEqual({
      type: 'git',
      url: 'git+https://github.com/Binary-Parse/BP-MD-RTL-Reader.git',
    });
    expect(pkg.homepage).toBe('https://github.com/Binary-Parse/BP-MD-RTL-Reader#readme');
    expect(pkg.bugs).toEqual({ url: 'https://github.com/Binary-Parse/BP-MD-RTL-Reader/issues' });
    expect(pkg.build.nsis.artifactName).toBe('BP-MD-RTL-Reader-${version}-Windows-NSIS-multiarch.${ext}');
    expect(pkg.build.portable.artifactName).toBe('BP-MD-RTL-Reader-${version}-Windows-Portable-multiarch.${ext}');
    expect(pkg.build.mac.artifactName).toBe('BP-MD-RTL-Reader-${version}-macOS-${arch}.${ext}');
    expect(pkg.build.linux.artifactName).toBe('BP-MD-RTL-Reader-${version}-Linux-${arch}.${ext}');
  });

  test('NSIS Installed Apps name omits the version number', () => {
    expect(pkg.build.nsis.uninstallDisplayName).toBe('${productName}');
  });
});
