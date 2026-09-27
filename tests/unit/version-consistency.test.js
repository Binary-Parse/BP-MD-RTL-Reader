/**
 * version-consistency.test.js — package.json is the single source of truth for the
 * release version, and this pins every place a literal copy of it still survives.
 *
 * Why this exists: a release workflow used to hardcode the version into 19 artifact
 * paths while scripts/release-preflight.js simultaneously *enforced* that the tag match
 * package.json — two facts that cannot both hold across a version bump. That workflow is
 * gone and releases are cut by hand, which makes the literals below MORE important, not
 * less: nothing in CI is left to catch one going stale.
 *
 * A literal is acceptable where a build-time substitution is unavailable (the About-dialog
 * fallback in the renderer). The Inno script carries no version literal at all: a compile
 * that omits /DAppVersion fails instead of silently mislabeling the installer.
 */
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');
const read = (file) => readFileSync(path.join(ROOT, file), 'utf8');
const VERSION = JSON.parse(read('package.json')).version;

describe('the release version has exactly one source of truth', () => {
  test('package.json carries a stable SemVer release', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test('package-lock.json agrees with package.json, in both places npm writes it', () => {
    const lock = JSON.parse(read('package-lock.json'));
    expect(lock.version).toBe(VERSION);
    expect(lock.packages[''].version).toBe(VERSION);
  });

  test('the About dialog states the real version, not a stale literal', () => {
    // The renderer asks main for app.getVersion() over the app:version channel; the
    // literal below is only the browser/dev-lane fallback (no preload bridge there).
    // The fallback stays pinned to package.json so a bump that forgets it fails fast.
    const source = read('src/renderer/app.js');
    expect(source, 'the About dialog must resolve the version over IPC').toContain('getAppVersion');
    const about = /_aboutVersion \|\| '([0-9]+\.[0-9]+\.[0-9]+)'/.exec(source);
    expect(about, 'could not find the about-version fallback literal in src/renderer/app.js').toBeTruthy();
    expect(about[1]).toBe(VERSION);

    expect(read('src/preload/index.js')).toContain("getAppVersion: () => ipcRenderer.invoke('app:version')");
    expect(read('src/main/ipc-controller.js')).toContain("ipcMain.handle('app:version'");
  });

  test("the Inno script has no version literal and rejects a compile without /DAppVersion", () => {
    // build/installer/build-installer.ps1 passes /DAppVersion from package.json and
    // refuses a mismatch. setup.iss carries no fallback literal: a direct ISCC run now
    // fails the compile instead of shipping an installer labeled by a stale default.
    const source = read('build/installer/setup.iss');
    expect(source).not.toMatch(/#define AppVersion "/);
    expect(source, 'setup.iss must #error when AppVersion is not supplied').toMatch(
      /#ifndef AppVersion\s*\r?\n\s*#error /);
  });

  test('the README version badge matches', () => {
    const badge = /img\.shields\.io\/badge\/version-([0-9]+\.[0-9]+\.[0-9]+)-/.exec(read('README.md'));
    expect(badge, 'could not find the version badge in README.md').toBeTruthy();
    expect(badge[1]).toBe(VERSION);
  });

  test('CHANGELOG.md has exactly one section for this version', () => {
    // scripts/release-preflight.js fails the release on any other count, and on an empty
    // section. Catching it here means a bad CHANGELOG fails in seconds, not mid-release.
    const headers = read('CHANGELOG.md')
      .split(/\r?\n/)
      .filter((line) => line.startsWith(`## [${VERSION}]`));
    expect(headers).toHaveLength(1);
  });
});
