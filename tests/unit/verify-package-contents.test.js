import { describe, expect, test } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {
  REQUIRED, FORBIDDEN_PREFIXES, normalizeEntries, verifyPackageEntries,
  INSTALLER_TOOLING, findInstallerTooling,
} = require('../../scripts/verify-package-contents.js');

describe('packaged asar contents', () => {
  test('accepts an archive carrying every required licence file', () => {
    expect(verifyPackageEntries([...REQUIRED, 'src/renderer/app.js'])).toEqual([]);
  });

  test('reports each missing required file by name', () => {
    const failures = verifyPackageEntries(REQUIRED.filter(f => f !== 'LICENSE'));
    expect(failures).toEqual(['missing LICENSE']);
  });

  test('rejects a forbidden path prefix', () => {
    const failures = verifyPackageEntries([...REQUIRED, 'tests/e2e/smoke.spec.js']);
    expect(failures).toEqual(['forbidden packaged path tests/e2e/smoke.spec.js']);
  });

  test('normalises leading separators and backslashes before matching', () => {
    expect(normalizeEntries(['\\LICENSE', '/tests\\e2e\\a.js'])).toEqual(['LICENSE', 'tests/e2e/a.js']);
    // A backslash path must still trip the forbidden-prefix check after normalising.
    expect(verifyPackageEntries([...REQUIRED, '\\tests\\e2e\\a.js']))
      .toEqual(['forbidden packaged path tests/e2e/a.js']);
  });

  test('FORBIDDEN_PREFIXES covers the directories that must never ship', () => {
    expect(FORBIDDEN_PREFIXES).toEqual(expect.arrayContaining(['.git/', 'tests/', 'coverage/']));
  });
});

// electron-winstaller vendors ~31 MB of Windows installer tooling, including 7-Zip 16.04
// (2016) which carries a KEV-listed CVE. It arrives as a REQUIRED peer dependency of
// app-builder-lib -- peerDependenciesMeta does not mark it optional -- and upgrading does not
// help: electron-winstaller@5.4.4, the latest, vendors the same 7-Zip 16.04 as 5.4.0 (measured
// 2026-08-23 from both tarballs' vendor/7z-x64.exe FileVersion). This project builds nsis and
// portable targets and never a squirrel target, so none of it is reachable.
//
// That reachability was previously an assessment written in an audit. These assertions make it
// a gate, so "not shipped" is enforced on every build rather than re-argued.
describe('vendored installer tooling never reaches dist/', () => {
  test('matches the 7-Zip, Squirrel and WiX binaries electron-winstaller vendors', () => {
    const vendored = [
      '7z.exe', '7z.dll', '7z-x64.exe', '7z-x64.dll', '7z-arm64.exe', '7z-arm64.dll',
      'Squirrel.exe', 'Squirrel.com', 'Squirrel-Mono.exe', 'StubExecutable.exe',
      'SyncReleases.exe', 'WriteZipToSetup.exe', 'candle.exe', 'light.exe',
      'signtool.exe', 'rcedit.exe', 'nuget.exe', 'wix.dll', 'winterop.dll', 'wconsole.dll',
    ];
    for (const name of vendored) {
      expect(INSTALLER_TOOLING.some(re => re.test(name)), name).toBe(true);
    }
  });

  test('does not match the application binaries or installers this project ships', () => {
    const shipped = [
      'BP MD RTL Reader.exe',
      'BP-MD-RTL-Reader-1.0.1-Windows-NSIS-multiarch.exe',
      'BP-MD-RTL-Reader-1.0.1-Windows-Portable-multiarch.exe',
      'BP-MD-RTL-Reader-1.0.1-Windows-Inno-x64.exe',
      'elevate.exe', 'app.asar', 'LICENSE', 'ffmpeg.dll', 'libEGL.dll', 'vk_swiftshader.dll',
    ];
    for (const name of shipped) {
      expect(INSTALLER_TOOLING.some(re => re.test(name)), name).toBe(false);
    }
  });

  test('finds vendored tooling anywhere in the tree, and reports a clean tree as empty', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'bpmd-dist-'));
    try {
      mkdirSync(path.join(dir, 'win-unpacked', 'resources'), { recursive: true });
      writeFileSync(path.join(dir, 'win-unpacked', 'BP MD RTL Reader.exe'), '');
      writeFileSync(path.join(dir, 'win-unpacked', 'resources', 'app.asar'), '');
      expect(findInstallerTooling(dir)).toEqual([]);

      // A nested leak must still be caught -- this is the shape a packaging change would take.
      writeFileSync(path.join(dir, 'win-unpacked', 'resources', '7z-x64.exe'), '');
      expect(findInstallerTooling(dir).map(p => path.basename(p))).toEqual(['7z-x64.exe']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('returns empty for a directory that does not exist', () => {
    expect(findInstallerTooling(path.join(tmpdir(), 'bpmd-no-such-dist-4c1f'))).toEqual([]);
  });
});
