import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  extractReleaseNotes,
  validateRelease,
} = require('../../scripts/release-preflight.js');

const root = path.resolve(import.meta.dirname, '../..');
const pkg = require('../../package.json');
const changelog = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');

describe('v1 release preflight', () => {
  test('accepts private validation but refuses private publication and wrong tags', () => {
    const base = {
      packageVersion: pkg.version,
      changelog,
      repository: 'Binary-Parse/BP-MD-RTL-Reader',
      visibility: 'private',
      publish: false,
      refType: 'branch',
      refName: 'release/v1.0.0-readiness',
    };
    expect(validateRelease(base)).toEqual([]);
    expect(validateRelease({ ...base, publish: true, refType: 'tag', refName: 'v1.0.0' })).toContain(
      'publishing requires a public repository',
    );
    expect(validateRelease({ ...base, visibility: 'public', publish: true, refType: 'tag', refName: 'v1.0.1' })).toContain(
      'release tag v1.0.1 does not match package version 1.0.0',
    );
    expect(validateRelease({ ...base, visibility: 'public', publish: true, refType: 'branch', refName: 'main' })).toContain(
      'publishing is allowed only from an annotated v1.0.0 tag',
    );
    expect(validateRelease({ ...base, packageVersion: '01.0.0' })).toContain(
      'package version 01.0.0 is not a stable SemVer release',
    );
  });

  test('extracts the actual version section as release notes', () => {
    const notes = extractReleaseNotes(changelog, '1.0.0');
    expect(notes).toContain('First public release');
    expect(notes).toContain('### Added');
    expect(notes).not.toContain('## [Unreleased]');
  });

  test('release workflow is pinned, staged, signed, notarized, attested, and publish-gated', () => {
    const workflow = readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8');
    const refs = [...workflow.matchAll(/^\s*uses:\s*([^\s#]+)(?:\s*#.*)?$/gm)].map(match => match[1]);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) expect(ref).toMatch(/^[^@\s]+@[0-9a-f]{40}$/);

    expect(workflow).toContain("tags: ['v*']");
    expect(workflow).toMatch(/publish:[\s\S]*type:\s*boolean[\s\S]*default:\s*false/);
    expect(workflow).toContain('node scripts/release-preflight.js');
    expect(workflow).toContain('test:mutation:release');
    expect(pkg.scripts['test:mutation:release']).toContain('--concurrency 2');
    expect(workflow).toContain('mcr.microsoft.com/playwright:v1.61.1-jammy');
    expect(workflow).toContain('WIN_CSC_LINK_B64');
    expect(workflow).toContain('WIN_CSC_KEY_PASSWORD');
    expect(workflow).toContain('MAC_CSC_LINK_B64');
    expect(workflow).toContain('APPLE_API_KEY_B64');
    expect(workflow).toContain('APPLE_API_KEY_ID');
    expect(workflow).toContain('APPLE_API_ISSUER');
    expect(workflow).toContain('APPLE_TEAM_ID');
    expect(workflow).toContain('forceCodeSigning=true');
    expect(workflow).toContain('codesign --verify --deep --strict');
    expect(workflow).toContain('spctl --assess --type execute');
    expect(workflow).toContain('stapler validate');
    expect(workflow).toContain('run-release-vm-tests.ps1');
    expect(workflow).toContain('-Kind Inno');
    expect(workflow).toContain('-Kind NSIS');
    expect(workflow).toContain('name: release-native-windows');
    expect(workflow).toContain('name: release-native-macos');
    expect(workflow).toContain('name: release-native-linux');
    expect(workflow).toContain('pattern: release-native-*');
    expect(workflow).toContain('actions/attest@59d89421af93a897026c735860bf21b6eb4f7b26');
    expect(workflow).toContain('gh release create');
    expect(workflow).toContain('0BCB2A409DEA17E305A27A6B09555CABE600E984F88570AB72575CD7E93C95E6');
    expect(workflow).toContain('https://github.com/jrsoftware/issrc/releases/download/is-6_3_3/innosetup-6.3.3.exe');
  });
});
