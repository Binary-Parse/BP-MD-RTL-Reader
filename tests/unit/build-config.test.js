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

  // H14: without a MIME type the generated .desktop file has no MimeType= line, so Linux file
  // managers never offer this app under "Open with" for Markdown files. electron-builder
  // appends %U to Exec itself and writes MimeType from these two keys.
  test('linux: both Markdown file associations carry a MIME type and the desktop entry lists it', () => {
    for (const assoc of pkg.build.fileAssociations) {
      expect(assoc.mimeType).toBe('text/markdown');
    }
    expect(pkg.build.linux.mimeTypes).toEqual(['text/markdown', 'text/x-markdown']);
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

  test('Windows NSIS and portable build x64 + arm64 only (Electron 44 has no 32-bit Windows binary)', () => {
    const archesOf = (name) => pkg.build.win.target.find((t) => t.target === name)?.arch;
    expect(archesOf('nsis')).toEqual(['x64', 'arm64']);
    expect(archesOf('portable')).toEqual(['x64', 'arm64']);
  });

  // M35: the app has no auto-updater (Help > Check for Updates only reads release metadata),
  // so nothing that exists for one may ship.
  test('no updater files are generated: publish is null', () => {
    expect(pkg.build).toHaveProperty('publish', null);
    expect(pkg.devDependencies).not.toHaveProperty('electron-updater');
    expect(pkg.dependencies || {}).not.toHaveProperty('electron-updater');
  });

  // electron-builder always packs elevate.exe into a per-machine NSIS install (it ignores
  // packElevateHelper there), so the file ships and must carry its notice.
  test('elevate.exe, which a per-machine NSIS install always carries, has a third-party notice', () => {
    expect(pkg.build.nsis.perMachine).toBe(true);
    expect(pkg.build.nsis).not.toHaveProperty('packElevateHelper');
    const notices = readFileSync(path.join(root, 'THIRD-PARTY-NOTICES.md'), 'utf8');
    expect(notices).toMatch(/\| \[Elevate\]\(https:\/\/github\.com\/jpassing\/elevate\) \| MIT \|[^\n]*resources\/elevate\.exe/);
    expect(notices).toContain('Copyright (c) 2007 Johannes Passing');
  });

  // B11: electron-builder's default desktop entry starts an AppImage with --no-sandbox.
  test('the AppImage desktop entry does not switch the Chromium sandbox off', () => {
    expect(pkg.build.appImage).toEqual({ executableArgs: [] });
    expect(pkg.build.linux.executableArgs).toBeUndefined();
  });

  test('Windows publisher identity is nested under the electron-builder 26 signtool schema', () => {
    expect(pkg.build.win).not.toHaveProperty('publisherName');
    expect(pkg.build.win.signtoolOptions).toEqual(expect.objectContaining({ publisherName: 'Binary Parse' }));
  });

  test('first-party Electron fuses disable runAsNode and extra file: privileges', () => {
    expect(pkg.build.electronFuses).toEqual(expect.objectContaining({
      runAsNode: false,
      enableEmbeddedAsarIntegrityValidation: true,
      onlyLoadAppFromAsar: true,
      grantFileProtocolExtraPrivileges: false,
    }));
  });

  test('NSIS treats installer warnings as errors', () => {
    expect(pkg.build.nsis.warningsAsErrors).toBe(true);
  });

  test('NSIS assisted installer ships the license page (v1.2.1)', () => {
    // electron-builder resolves nsis resources relative to buildResourcesDir ('build/')
    expect(pkg.build.nsis.license).toBe('installer/LICENSE-INSTALLER.rtf');
    expect(pkg.build.nsis.oneClick).toBe(false); // license page only exists in assisted flow
  });
});
