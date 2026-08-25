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
    expect(validateRelease({ ...base, visibility: 'public', publish: true, refType: 'tag', refName: 'v1.0.2' })).toContain(
      `release tag v1.0.2 does not match package version ${pkg.version}`,
    );
    expect(validateRelease({ ...base, visibility: 'public', publish: true, refType: 'branch', refName: 'main' })).toContain(
      `publishing is allowed only from an annotated v${pkg.version} tag`,
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

});
