'use strict';

// What a release ships: Windows and Linux. macOS is not built or tested (no Mac to build,
// sign or notarize on), so it is not in the contract.
// The Linux names are the ones electron-builder writes: it spells the x64 architecture the way
// each package format does (x86_64 for an AppImage, amd64 for a deb). Checked against a real
// build in WSL on 2026-10-11 (audit B11).
const PUBLIC_ARTIFACT_NAMES = Object.freeze([
  'BP-MD-RTL-Reader-{version}-Windows-NSIS-multiarch.exe',
  'BP-MD-RTL-Reader-{version}-Windows-Portable-multiarch.exe',
  'BP-MD-RTL-Reader-{version}-Windows-Inno-x64.exe',
  'BP-MD-RTL-Reader-{version}-Windows-Inno-x64.source-manifest.json',
  'BP-MD-RTL-Reader-{version}-Linux-x86_64.AppImage',
  'BP-MD-RTL-Reader-{version}-Linux-arm64.AppImage',
  'BP-MD-RTL-Reader-{version}-Linux-amd64.deb',
  'BP-MD-RTL-Reader-{version}-Linux-arm64.deb',
]);

function assertReleaseVersion(version) {
  const parts = version.split('.');
  const valid = parts.length === 3 && parts.every(part => {
    if (!part) return false;
    if (part.length > 1 && part.startsWith('0')) return false;
    for (const character of part) {
      if (character < '0' || character > '9') return false;
    }
    return true;
  });
  if (!valid) {
    throw new Error(`Invalid release version: ${version}`);
  }
}

function expectedArtifactNames(version) {
  assertReleaseVersion(version);
  return PUBLIC_ARTIFACT_NAMES.map(name => name.replace('{version}', version));
}

function validateReleaseEntries(entries, version) {
  const expected = expectedArtifactNames(version);
  const expectedSet = new Set(expected);
  const errors = [];
  const exactSeen = new Set();
  const foldedSeen = new Map();

  for (const name of entries) {
    if (exactSeen.has(name)) errors.push(`duplicate artifact ${name}`);
    exactSeen.add(name);

    const folded = name.toLowerCase();
    const previous = foldedSeen.get(folded);
    if (previous && previous !== name) {
      errors.push(`case-insensitive artifact collision ${previous} / ${name}`);
    } else if (!previous) {
      foldedSeen.set(folded, name);
    }

    if (!expectedSet.has(name)) errors.push(`unexpected artifact ${name}`);
  }

  for (const name of expected) {
    if (!exactSeen.has(name)) errors.push(`missing artifact ${name}`);
  }

  return errors;
}

module.exports = {
  PUBLIC_ARTIFACT_NAMES,
  assertReleaseVersion,
  expectedArtifactNames,
  validateReleaseEntries,
};
