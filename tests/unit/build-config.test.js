/**
 * build-config.test.js — T-B7 cross-platform packaging config. The mac/linux artifacts
 * can't be BUILT on this win32 host, but the electron-builder config + entitlements are
 * validated here so they don't silently rot.
 */
import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const targetsOf = (cfg) => (cfg?.target || []).map((t) => (typeof t === 'string' ? t : t.target));

describe('electron-builder cross-platform config (T-B7)', () => {
  test('mac builds dmg + zip, hardened runtime, productivity category', () => {
    const mac = pkg.build.mac;
    expect(targetsOf(mac)).toEqual(expect.arrayContaining(['dmg', 'zip']));
    expect(mac.hardenedRuntime).toBe(true);
    expect(mac.category).toMatch(/productivity/);
    expect(mac.entitlements).toBe('build/entitlements.mac.plist');
  });

  test('linux builds AppImage + deb with an Office category + maintainer', () => {
    const linux = pkg.build.linux;
    expect(targetsOf(linux)).toEqual(expect.arrayContaining(['AppImage', 'deb']));
    expect(linux.category).toBe('Office');
    expect(typeof linux.maintainer).toBe('string');
  });

  test('the referenced mac entitlements plist exists and grants user-selected file access + JIT', () => {
    const p = path.join(root, pkg.build.mac.entitlements);
    expect(existsSync(p)).toBe(true);
    const xml = readFileSync(p, 'utf8');
    expect(xml).toContain('com.apple.security.files.user-selected.read-write'); // vault folders
    expect(xml).toContain('com.apple.security.cs.allow-jit');                    // Chromium/V8 under hardened runtime
  });

  test('app and helper entitlements retain only the required hardened-runtime exceptions', () => {
    expect(pkg.build.mac.entitlementsInherit).toBe('build/entitlements.mac.inherit.plist');
    for (const relative of [pkg.build.mac.entitlements, pkg.build.mac.entitlementsInherit]) {
      const xml = readFileSync(path.join(root, relative), 'utf8');
      expect(xml).toContain('com.apple.security.cs.allow-jit');
      expect(xml).not.toContain('com.apple.security.cs.allow-unsigned-executable-memory');
      expect(xml).not.toContain('com.apple.security.cs.allow-dyld-environment-variables');
      expect(xml).not.toContain('com.apple.security.cs.disable-library-validation');
    }
    const helper = readFileSync(path.join(root, pkg.build.mac.entitlementsInherit), 'utf8');
    expect(helper).not.toContain('com.apple.security.files.user-selected.read-write');
    expect(helper).not.toContain('com.apple.security.files.bookmarks.app-scope');
  });

  test('win packaging (pre-existing) is preserved alongside the new targets', () => {
    expect(targetsOf(pkg.build.win)).toEqual(expect.arrayContaining(['nsis']));
    expect(pkg.build.appId).toBe('com.binaryparse.bpmdrtlreader');
  });
});
