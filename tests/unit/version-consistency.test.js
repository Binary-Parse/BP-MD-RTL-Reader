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
 * A literal is acceptable where a build-time substitution is unavailable (a template
 * string in the renderer, an Inno `#ifndef` fallback). A literal nothing checks is not.
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
    // src/renderer/app.js builds the dialog as a template string. There is no preload
    // bridge for app.getVersion(), and adding IPC surface for a cosmetic label is a worse
    // trade than pinning the literal here, where drift fails fast and cheaply.
    const about = /class="about-version">version ([0-9]+\.[0-9]+\.[0-9]+) /.exec(read('src/renderer/app.js'));
    expect(about, 'could not find the about-version literal in src/renderer/app.js').toBeTruthy();
    expect(about[1]).toBe(VERSION);
  });

  test("the Inno fallback matches, so a direct compile cannot mislabel the installer", () => {
    // build/installer/build-installer.ps1 passes /DAppVersion from package.json and
    // refuses a mismatch, so this #ifndef default is only reached by a direct ISCC run —
    // which setup.iss rejects anyway. Kept in sync so it can never state a wrong version.
    const iss = /#define AppVersion "([0-9]+\.[0-9]+\.[0-9]+)"/.exec(read('build/installer/setup.iss'));
    expect(iss, 'could not find the AppVersion define in setup.iss').toBeTruthy();
    expect(iss[1]).toBe(VERSION);
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
