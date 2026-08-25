'use strict';

const fs = require('fs');
const path = require('path');
const asar = require('@electron/asar');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const REQUIRED = [
  'LICENSE',
  'THIRD-PARTY-NOTICES.md',
  'resources/vendor/THIRD-PARTY-LICENSES.txt',
  'resources/vendor/vendor-manifest.json',
  'resources/vendor/fonts/LICENSES.md',
  'resources/vendor/fonts/OFL-1.1.txt',
];
const FORBIDDEN_PREFIXES = ['.git/', 'coverage/', 'reports/', 'tests/', 'AUDIT_REPORT.md'];

// Windows installer tooling that electron-winstaller vendors (~31 MB) and that must never
// reach a shipped tree. It includes 7-Zip 16.04 (2016), which carries a KEV-listed CVE.
//
// It cannot be pruned: electron-builder-squirrel-windows is a REQUIRED peer of app-builder-lib
// (peerDependenciesMeta does not mark it optional), and upgrading does not help either --
// electron-winstaller@5.4.4, the latest, vendors the same 7-Zip 16.04 as 5.4.0. Measured
// 2026-08-23 from both tarballs' vendor/7z-x64.exe.
//
// This project builds nsis + portable and never a squirrel target, so none of it is reachable.
// That was previously an assessment recorded in an audit; the check below makes it a gate, so
// a packaging change that starts copying resources wholesale fails the build instead of
// silently shipping a 2016 archiver.
const INSTALLER_TOOLING = [
  /^7z[\w.-]*\.(exe|dll)$/i,
  /^squirrel(-mono)?\.(exe|com|pdb)$/i,
  /^(stubexecutable|syncreleases|writeziptosetup|setup)\.(exe|pdb)$/i,
  /^(candle|light|signtool|rcedit|nuget)\.exe$/i,
  /^(wix|winterop|wconsole)\.dll$/i,
  /^microsoft\.deployment\..*\.dll$/i,
  /^(darice\.cub|template\.wxs)$/i,
];

/** Every vendored-tooling binary under a packaged output tree; empty when the tree is clean. */
function findInstallerTooling(directory, found = []) {
  if (!fs.existsSync(directory)) return found;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) findInstallerTooling(full, found);
    else if (INSTALLER_TOOLING.some(pattern => pattern.test(entry.name))) found.push(full);
  }
  return found;
}

function walk(directory, name) {
  if (!fs.existsSync(directory)) return [];
  const found = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...walk(full, name));
    else if (entry.name === name) found.push(full);
  }
  return found;
}

function normalizeEntries(entries) {
  return entries.map(entry => entry.replace(/^[/\\]+/, '').replaceAll('\\', '/'));
}

function verifyPackageEntries(entries) {
  const normalized = normalizeEntries(entries);
  const files = new Set(normalized);
  const failures = [];
  for (const required of REQUIRED) {
    if (!files.has(required)) failures.push('missing ' + required);
  }
  for (const file of normalized) {
    if (FORBIDDEN_PREFIXES.some(prefix => file === prefix || file.startsWith(prefix))) {
      failures.push('forbidden packaged path ' + file);
    }
  }
  return failures;
}

function main() {
  const archives = walk(DIST, 'app.asar');
  if (archives.length === 0) throw new Error('No packaged app.asar found under ' + DIST);
  const failures = [];
  for (const archive of archives) {
    const archiveFailures = verifyPackageEntries(asar.listPackage(archive));
    if (archiveFailures.length) {
      failures.push(path.relative(ROOT, archive) + ': ' + archiveFailures.join(', '));
    } else {
      console.log('Verified package contents: ' + path.relative(ROOT, archive));
    }
  }
  const leaked = findInstallerTooling(DIST);
  if (leaked.length) {
    failures.push('vendored installer tooling present in dist/: '
      + leaked.map(file => path.relative(ROOT, file)).join(', '));
  }
  if (failures.length) throw new Error('Package-content verification failed:\n - ' + failures.join('\n - '));
  console.log('Verified ' + archives.length + ' packaged application archive(s); '
    + 'no vendored installer tooling in dist/.');
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = {
  REQUIRED, FORBIDDEN_PREFIXES, INSTALLER_TOOLING,
  normalizeEntries, verifyPackageEntries, walk, findInstallerTooling,
};
