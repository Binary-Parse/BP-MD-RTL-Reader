'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const REQUIRED = {
  runAsNode: false,
  enableNodeOptionsEnvironmentVariable: false,
  enableNodeCliInspectArguments: false,
  enableEmbeddedAsarIntegrityValidation: true,
  onlyLoadAppFromAsar: true,
  grantFileProtocolExtraPrivileges: false,
};

// getCurrentFuseWire returns a wire keyed by NUMERIC FuseV1Options index whose values are
// FuseState bytes -- not by fuse name, and not booleans. Measured against a real packaged
// binary: {"0":48,"1":49,"2":48,"3":48,"4":49,"5":49,"6":48,"7":48,"8":49,"version":"1"}.
// These indices mirror FuseV1Options; a unit test pins the two together so this map cannot
// drift silently, and keeping them literal here means compareFuseWire needs no import and
// stays testable without a packaged binary.
const FUSE_INDEX = {
  runAsNode: 0,
  enableCookieEncryption: 1,
  enableNodeOptionsEnvironmentVariable: 2,
  enableNodeCliInspectArguments: 3,
  enableEmbeddedAsarIntegrityValidation: 4,
  onlyLoadAppFromAsar: 5,
  loadBrowserProcessSpecificV8Snapshot: 6,
  grantFileProtocolExtraPrivileges: 7,
};

// The 32-byte marker @electron/fuses writes into every Electron binary. Anything without it
// is not an Electron binary and getCurrentFuseWire throws on it.
const SENTINEL = 'dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX';
const FUSE_ENABLE = 49;   // FuseState.ENABLE
const FUSE_DISABLE = 48;  // FuseState.DISABLE

const APP_BUNDLE = /\.app$/i;
const HAS_EXTENSION = /\.[A-Za-z0-9]+$/;

/**
 * Candidate binaries under a packaged output tree, across all three platform layouts.
 *
 * Windows ships `*.exe`. macOS ships a `.app` bundle, which is the path @electron/fuses wants
 * -- it resolves the framework inside itself -- so the bundle is returned whole and not
 * descended into, or its inner binaries would each be read as a separate candidate. Linux
 * ships an extensionless ELF beside its `.pak`/`.dat` resources, and its name follows
 * executableName rather than a fixed string, so extensionless-ness is the test rather than a
 * literal `electron`.
 *
 * This over-collects on purpose: LICENSE, `version` and similar extensionless files come back
 * too. isElectronBinary discards them by sentinel, which is cheaper than encoding a name rule
 * per platform and cannot go stale when a target is added.
 */
function walkExecutables(directory, found = []) {
  if (!fs.existsSync(directory)) return found;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (APP_BUNDLE.test(entry.name)) found.push(full);
      else walkExecutables(full, found);
    } else if (/\.exe$/i.test(entry.name) || !HAS_EXTENSION.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

/**
 * The file that actually carries the fuse sentinel for a candidate path.
 *
 * Mirrors @electron/fuses' own pathToFuseFile (dist/index.js:53-60): a `.app` bundle holds its
 * wire in the embedded Electron Framework, not at the bundle path. Every other layout stores
 * it in the file itself.
 */
function fuseFilePath(target) {
  if (!APP_BUNDLE.test(target)) return target;
  return path.join(target, 'Contents', 'Frameworks', 'Electron Framework.framework', 'Electron Framework');
}

function expectedFusesFromPackage() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  return pkg.build && pkg.build.electronFuses ? pkg.build.electronFuses : null;
}

/**
 * Names of the required fuses whose actual wire state disagrees with the requirement.
 *
 * A fuse the wire does not carry counts as a mismatch, and so do REMOVED (114) and
 * INHERIT (144): folding "not ENABLE" into "false" would let a removed fuse pass as a
 * satisfied `false` requirement. Wire indices REQUIRED does not name are ignored.
 *
 * @param {Record<string|number, number>} wire  as returned by getCurrentFuseWire
 * @param {Record<string, boolean>} required    name -> required boolean state
 * @returns {string[]} mismatched fuse names, empty when every requirement holds
 */
function compareFuseWire(wire, required) {
  const mismatched = [];
  if (!wire || typeof wire !== 'object') return Object.keys(required || {});
  for (const name of Object.keys(required || {})) {
    const index = FUSE_INDEX[name];
    if (index === undefined) { mismatched.push(name); continue; }
    const expected = required[name] ? FUSE_ENABLE : FUSE_DISABLE;
    if (wire[index] !== expected) mismatched.push(name);
  }
  return mismatched;
}

/**
 * Whether a file carries the Electron fuse sentinel.
 *
 * Read in chunks with an overlap, so a 150 MB binary costs a bounded amount of memory and a
 * sentinel straddling a chunk boundary is still found. Returns false rather than throwing on
 * an unreadable path: the caller is filtering a directory walk, not asserting the file exists.
 */
function isElectronBinary(filePath) {
  const CHUNK = 1 << 20;
  const overlap = SENTINEL.length - 1;
  let fd;
  try {
    fd = fs.openSync(fuseFilePath(filePath), 'r');
    const buffer = Buffer.alloc(CHUNK + overlap);
    let carried = 0;
    for (;;) {
      const read = fs.readSync(fd, buffer, carried, CHUNK, null);
      if (read <= 0) return false;
      if (buffer.slice(0, carried + read).includes(SENTINEL)) return true;
      buffer.copy(buffer, 0, carried + read - overlap, carried + read);
      carried = overlap;
    }
  } catch (_) {
    return false;
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch (_) { /* already gone */ } }
  }
}

async function main() {
  const configured = expectedFusesFromPackage();
  if (!configured) throw new Error('package.json build.electronFuses is missing');
  for (const [key, value] of Object.entries(REQUIRED)) {
    if (configured[key] !== value) throw new Error(`electronFuses.${key} must be ${value}`);
  }
  const required = process.env.VERIFY_FUSES_REQUIRED === '1';
  const binaries = walkExecutables(DIST);
  if (binaries.length === 0) {
    if (required) throw new Error('No packaged Electron binary under dist/ to read fuses from');
    console.log('electronFuses config verified; no dist/ binary present (skip runtime fuse read)');
    return;
  }
  let fuses;
  try {
    fuses = require('@electron/fuses');
  } catch (_) {
    // Fail closed where it matters. Reporting success because the reader is missing is the
    // same inert-control shape this check exists to prevent.
    if (required) throw new Error('@electron/fuses is required to read fuse wires but could not be loaded');
    console.log('electronFuses config verified; @electron/fuses not installed for binary read');
    return;
  }
  if (typeof fuses.getCurrentFuseWire !== 'function') {
    if (required) throw new Error('@electron/fuses exposes no getCurrentFuseWire; cannot read fuse wires');
    console.log('Verified fuse config; binary fuse reader API unavailable');
    return;
  }

  const electronBinaries = binaries.filter(isElectronBinary);
  if (electronBinaries.length === 0) {
    // Walked candidates but recognised none: the filter is broken, or the packaging changed.
    // Silence here would restore the very gap this check closes. The walker covers all three
    // layouts, so on any real packaged tree this list is non-empty -- reaching here means the
    // candidates exist and none is an Electron binary, which is a failure, not a skip.
    throw new Error(
      `Walked ${binaries.length} executable(s) under dist/ but none carry an Electron fuse sentinel`
    );
  }

  for (const binary of electronBinaries) {
    const wire = await fuses.getCurrentFuseWire(binary);
    const mismatched = compareFuseWire(wire, REQUIRED);
    if (mismatched.length > 0) {
      throw new Error(`${path.relative(ROOT, binary)}: fuses do not match policy: ${mismatched.join(', ')}`);
    }
  }
  console.log(
    `Verified ${Object.keys(REQUIRED).length} fuses against ${electronBinaries.length} packaged Electron binary/binaries.`
  );
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  REQUIRED, FUSE_INDEX, expectedFusesFromPackage, walkExecutables, fuseFilePath,
  compareFuseWire, isElectronBinary,
};
