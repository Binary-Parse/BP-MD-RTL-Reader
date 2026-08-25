import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relative) => readFileSync(path.join(root, relative), 'utf8');
const pkg = JSON.parse(read('package.json'));

describe('automated dependency update policy', () => {
  const dependabot = read('.github/dependabot.yml');

  // A freshly published version is the window where a compromised release is
  // still unreported; a cooldown keeps it out of an auto-merged PR until the
  // ecosystem has had a chance to catch it.
  test('every ecosystem waits out a cooldown before opening a PR', () => {
    const ecosystems = [...dependabot.matchAll(/^\s+- package-ecosystem:/gm)].length;
    const cooldowns = [...dependabot.matchAll(/^\s+cooldown:$/gm)].length;
    expect(ecosystems).toBeGreaterThan(0);
    expect(cooldowns).toBe(ecosystems);
  });

  // github-actions accepts only default-days; the semver-scoped keys are
  // rejected for ecosystems that do not advertise SemVer support.
  test('scopes the semver cooldown keys to the npm ecosystem', () => {
    const [, actions] = dependabot.split('- package-ecosystem: github-actions');
    expect(actions).toBeDefined();
    expect(actions).toMatch(/default-days:/);
    expect(actions).not.toMatch(/semver-(major|minor|patch)-days:/);
  });
});

describe('dependency overrides', () => {
  // An override pins a transitive package for every consumer, so a stale one
  // silently holds the whole tree on a vulnerable release.
  test('no override pins a version with a known advisory', () => {
    // fast-uri 3.1.4 is GHSA-7p8r-x3mc-p8w7; fixed in 3.1.5.
    expect(pkg.overrides['fast-uri']).not.toBe('3.1.4');
  });

  test('every override is a resolvable version specifier', () => {
    for (const [name, spec] of Object.entries(pkg.overrides ?? {})) {
      expect(spec, name).toMatch(/^[\^~]?\d+(?:\.\d+){2}(?:[-+][0-9A-Za-z.-]+)?$/);
    }
  });
});

describe('software bill of materials coverage', () => {
  // This project declares no runtime dependencies — everything ships vendored —
  // so every lockfile entry is dev-scoped. Syft omits dev dependencies by
  // default, which reduced the SBOM to a single component and made grype report
  // an empty tree as clean. The config below is what keeps that from recurring.
  test('syft is configured to catalog dev dependencies', () => {
    const syft = read('.syft.yaml');
    expect(syft).toMatch(/include-dev-dependencies:\s*true/);
  });

  test('the lockfile really is dev-only, which is why the setting matters', () => {
    expect(pkg.dependencies).toBeUndefined();
    expect(Object.keys(pkg.devDependencies).length).toBeGreaterThan(0);
  });
});
