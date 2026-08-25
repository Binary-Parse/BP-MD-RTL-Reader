import { describe, expect, test } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const {
  REQUIRED, FUSE_INDEX, expectedFusesFromPackage, walkExecutables, compareFuseWire, isElectronBinary,
} = require('../../scripts/verify-electron-fuses.js');
const { SENTINEL, FuseState } = require('@electron/fuses/dist/constants.js');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

describe('electron fuse verification', () => {
  test('package.json fuse flags match the required fail-closed set', () => {
    expect(expectedFusesFromPackage()).toEqual(expect.objectContaining(REQUIRED));
    expect(pkg.scripts['package:verify']).toContain('scripts/verify-electron-fuses.js');
    expect(pkg.scripts['fuses:verify']).toBe('node scripts/verify-electron-fuses.js');
  });

  test('walkExecutables finds packaged Electron binaries and ignores other files', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'bpmd-fuses-'));
    try {
      mkdirSync(path.join(dir, 'win-unpacked'));
      writeFileSync(path.join(dir, 'win-unpacked', 'BP MD RTL Reader.exe'), '');
      writeFileSync(path.join(dir, 'win-unpacked', 'readme.txt'), '');
      mkdirSync(path.join(dir, 'linux'));
      writeFileSync(path.join(dir, 'linux', 'electron'), '');
      expect(walkExecutables(dir).sort()).toEqual([
        path.join(dir, 'linux', 'electron'),
        path.join(dir, 'win-unpacked', 'BP MD RTL Reader.exe'),
      ].sort());
      expect(walkExecutables(path.join(dir, 'missing'))).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// getCurrentFuseWire returns a wire keyed by NUMERIC FuseV1Options index whose values are
// FuseState bytes -- measured against a real packaged binary 2026-08-23:
//   {"0":48,"1":49,"2":48,"3":48,"4":49,"5":49,"6":48,"7":48,"8":49,"version":"1"}
// REQUIRED is keyed by camelCase name with booleans, so the two shapes must be translated
// before they can be compared at all. wire.runAsNode is undefined.
describe('compareFuseWire', () => {
  /** A wire in which every REQUIRED fuse already holds its required state. */
  function goodWire() {
    return {
      version: '1',
      0: FuseState.DISABLE, // runAsNode: false
      1: FuseState.ENABLE,  // enableCookieEncryption (not in REQUIRED)
      2: FuseState.DISABLE, // enableNodeOptionsEnvironmentVariable: false
      3: FuseState.DISABLE, // enableNodeCliInspectArguments: false
      4: FuseState.ENABLE,  // enableEmbeddedAsarIntegrityValidation: true
      5: FuseState.ENABLE,  // onlyLoadAppFromAsar: true
      6: FuseState.DISABLE, // loadBrowserProcessSpecificV8Snapshot (not in REQUIRED)
      7: FuseState.DISABLE, // grantFileProtocolExtraPrivileges: false
      8: FuseState.ENABLE,  // (not in REQUIRED)
    };
  }

  test('returns [] when every required fuse holds its required state', () => {
    expect(compareFuseWire(goodWire(), REQUIRED)).toEqual([]);
  });

  test('names a fuse whose state is the opposite of what is required', () => {
    const wire = goodWire();
    wire[0] = FuseState.ENABLE; // runAsNode must be false
    expect(compareFuseWire(wire, REQUIRED)).toEqual(['runAsNode']);
  });

  test('names every mismatch, not just the first', () => {
    const wire = goodWire();
    wire[0] = FuseState.ENABLE;  // runAsNode
    wire[5] = FuseState.DISABLE; // onlyLoadAppFromAsar
    expect(compareFuseWire(wire, REQUIRED).sort()).toEqual(['onlyLoadAppFromAsar', 'runAsNode']);
  });

  test('reports REMOVED and INHERIT rather than accepting them as a match', () => {
    // 114/144 are neither ENABLE nor DISABLE. Treating "not ENABLE" as "false" would let a
    // REMOVED fuse pass as a satisfied `false` requirement.
    const removed = goodWire();
    removed[0] = FuseState.REMOVED;
    expect(compareFuseWire(removed, REQUIRED)).toEqual(['runAsNode']);

    const inherit = goodWire();
    inherit[4] = FuseState.INHERIT;
    expect(compareFuseWire(inherit, REQUIRED)).toEqual(['enableEmbeddedAsarIntegrityValidation']);
  });

  test('ignores wire indices that REQUIRED does not name, and the version key', () => {
    const wire = goodWire();
    wire[1] = FuseState.DISABLE; // enableCookieEncryption — not in REQUIRED
    wire[6] = FuseState.ENABLE;  // not in REQUIRED
    wire[8] = FuseState.DISABLE; // not in REQUIRED
    expect(compareFuseWire(wire, REQUIRED)).toEqual([]);
  });

  test('reports a required fuse the wire does not carry at all', () => {
    const wire = goodWire();
    delete wire[7]; // grantFileProtocolExtraPrivileges
    expect(compareFuseWire(wire, REQUIRED)).toEqual(['grantFileProtocolExtraPrivileges']);
  });
});

// Only a binary carrying the fuse sentinel can be read; getCurrentFuseWire throws
// "Could not find sentinel in the provided Electron binary" on anything else. Measured
// 2026-08-23: of the 9 executables walkExecutables finds under dist/, only the three
// *-unpacked/BP MD RTL Reader.exe carry it -- elevate.exe and the Portable, NSIS and Inno
// artifacts do not. A name rule would have to enumerate those, and would still be wrong on
// the next target added; the sentinel is the property that actually matters.
describe('isElectronBinary', () => {
  let dir;
  const at = (name) => path.join(dir, name);

  test('accepts a file containing the fuse sentinel and rejects one without it', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'bpmd-sentinel-'));
    try {
      writeFileSync(at('app.exe'), Buffer.concat([
        Buffer.from('MZ padding padding '),
        Buffer.from(SENTINEL),
        Buffer.from([0, 48, 49, 48, 48, 49, 49, 48, 48, 49]),
      ]));
      writeFileSync(at('elevate.exe'), Buffer.from('MZ no sentinel here at all'));
      writeFileSync(at('Setup-NSIS.exe'), Buffer.from('MZ installer stub'));
      writeFileSync(at('Portable.exe'), Buffer.from('MZ portable stub'));

      expect(isElectronBinary(at('app.exe'))).toBe(true);
      expect(isElectronBinary(at('elevate.exe'))).toBe(false);
      expect(isElectronBinary(at('Setup-NSIS.exe'))).toBe(false);
      expect(isElectronBinary(at('Portable.exe'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('returns false for a path that cannot be read instead of throwing', () => {
    expect(isElectronBinary(path.join(tmpdir(), 'bpmd-does-not-exist-9f3a.exe'))).toBe(false);
  });
});

// FUSE_INDEX is written out literally in the script so compareFuseWire needs no import and
// stays testable without a packaged binary. That copy can drift from the library it mirrors,
// so pin the two together here: this is the only thing standing between a renumbered
// FuseV1Options and a verifier that silently reads the wrong index.
describe('FUSE_INDEX', () => {
  test('agrees with FuseV1Options for every name it maps', () => {
    // FuseV1Options is a TypeScript enum keyed PascalCase (RunAsNode), while electron-builder's
    // build.electronFuses -- and therefore REQUIRED and FUSE_INDEX -- is keyed camelCase. The
    // numbers agree; only the casing differs, so bridge it rather than renaming either side.
    const { FuseV1Options } = require('@electron/fuses');
    const pascal = (name) => name.charAt(0).toUpperCase() + name.slice(1);
    for (const [name, index] of Object.entries(FUSE_INDEX)) {
      expect(FuseV1Options[pascal(name)], `FUSE_INDEX.${name}`).toBe(index);
    }
  });

  test('names every fuse FuseV1Options defines, so a newly added fuse is noticed', () => {
    // Numeric keys are the enum's reverse mapping; the string keys are the fuse names.
    const { FuseV1Options } = require('@electron/fuses');
    const defined = Object.keys(FuseV1Options).filter((k) => Number.isNaN(Number(k)));
    const mapped = Object.keys(FUSE_INDEX).map((n) => n.charAt(0).toUpperCase() + n.slice(1));
    expect(mapped.sort()).toEqual(defined.sort());
  });

  test('maps every fuse REQUIRED names', () => {
    for (const name of Object.keys(REQUIRED)) {
      expect(FUSE_INDEX, `REQUIRED.${name} has no index`).toHaveProperty(name);
    }
  });
});

// The walker was Windows-only: it matched *.exe and a literal `electron`, so on the other two
// platforms it returned nothing and the gate passed on config alone. package.json builds
// dmg/zip for mac and AppImage/deb for linux, so both layouts are real output.
//
// @electron/fuses wants the .app DIRECTORY on macOS and resolves it itself to
// Contents/Frameworks/Electron Framework.framework/Electron Framework (dist/index.js:53-60).
// Linux ships an extensionless ELF next to its resources.
describe('walkExecutables across platform layouts', () => {
  let dir;
  const write = (rel, body = '') => {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, body);
    return full;
  };

  test('returns a macOS .app bundle as one candidate and does not descend into it', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'bpmd-mac-'));
    try {
      const bundle = path.join(dir, 'mac-arm64', 'BP MD RTL Reader.app');
      write('mac-arm64/BP MD RTL Reader.app/Contents/Frameworks/Electron Framework.framework/Electron Framework');
      write('mac-arm64/BP MD RTL Reader.app/Contents/MacOS/BP MD RTL Reader');
      // The bundle itself is the candidate; its extensionless inner binaries must not each
      // become separate candidates, or one bundle would be read three times.
      expect(walkExecutables(dir)).toEqual([bundle]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('returns an extensionless Linux binary and ignores its resource files', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'bpmd-linux-'));
    try {
      const bin = write('linux-unpacked/bpmdrtlreader');
      write('linux-unpacked/resources.pak');
      write('linux-unpacked/icudtl.dat');
      write('linux-unpacked/LICENSES.chromium.html');
      expect(walkExecutables(dir)).toContain(bin);
      expect(walkExecutables(dir).filter((f) => /\.(pak|dat|html)$/.test(f))).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('isElectronBinary across platform layouts', () => {
  test('resolves a .app bundle to its Electron Framework before looking for the sentinel', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'bpmd-mac-sentinel-'));
    try {
      const bundle = path.join(dir, 'BP MD RTL Reader.app');
      const framework = path.join(bundle, 'Contents', 'Frameworks', 'Electron Framework.framework');
      mkdirSync(framework, { recursive: true });
      // The sentinel lives in the framework, never at the bundle path itself.
      writeFileSync(path.join(framework, 'Electron Framework'), Buffer.concat([
        Buffer.from('header '), Buffer.from(SENTINEL), Buffer.from([0, 48, 49]),
      ]));
      expect(isElectronBinary(bundle)).toBe(true);

      // A bundle whose framework carries no sentinel is still rejected.
      const empty = path.join(dir, 'Other.app');
      mkdirSync(path.join(empty, 'Contents', 'Frameworks', 'Electron Framework.framework'), { recursive: true });
      writeFileSync(path.join(empty, 'Contents', 'Frameworks', 'Electron Framework.framework', 'Electron Framework'), 'nope');
      expect(isElectronBinary(empty)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('finds a sentinel that straddles a chunk boundary', () => {
    // The reader scans in 1 MiB chunks with an overlap; a sentinel split across the seam is
    // the case a naive chunked scan misses.
    const dir = mkdtempSync(path.join(tmpdir(), 'bpmd-straddle-'));
    try {
      const file = path.join(dir, 'straddle.exe');
      const chunk = 1 << 20;
      const head = Buffer.alloc(chunk - 5, 0x41);
      writeFileSync(file, Buffer.concat([head, Buffer.from(SENTINEL), Buffer.alloc(64, 0x42)]));
      expect(isElectronBinary(file)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// The strongest available check on this gate: the vanilla Electron binary in node_modules has
// had no fuses applied to it, so a working gate must REJECT it on every fuse REQUIRED names.
// Every other negative case here is synthetic -- a hand-built wire, or the real wire compared
// against an inverted policy. This one is a real, unmodified Electron binary, which is exactly
// what would ship if electron-builder silently failed to apply the fuses.
//
// require('electron') resolves to the platform's binary path, so this works on all three CI
// legs without a path rule.
describe('the gate rejects a real unfused Electron binary', () => {
  const electronBinary = require('electron');

  test('recognises the vanilla binary as an Electron binary', () => {
    expect(typeof electronBinary).toBe('string');
    expect(isElectronBinary(electronBinary)).toBe(true);
  });

  test('reports every required fuse as unsatisfied on it', async () => {
    const { getCurrentFuseWire } = require('@electron/fuses');
    const wire = await getCurrentFuseWire(electronBinary);
    const mismatched = compareFuseWire(wire, REQUIRED);
    // Not "some" -- an unfused binary satisfies none of them, and a gate that reported only a
    // subset would be silently accepting the rest.
    expect(mismatched.sort()).toEqual(Object.keys(REQUIRED).sort());
  });
});
