/**
 * version.test.js — T-Q6 pure version comparison for the opt-in update check.
 */
import { describe, test, expect } from 'vitest';
import { compareVersions, parse } from '../../src/main/version.js';

describe('compareVersions (T-Q6)', () => {
  test('orders dotted numeric versions', () => {
    expect(compareVersions('1.2.3', '1.2.4')).toBe(-1);
    expect(compareVersions('1.3.0', '1.2.9')).toBe(1);
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });
  test('supports a leading v and SemVer prerelease precedence', () => {
    expect(compareVersions('v1.2.0', '1.2.0')).toBe(0);
    expect(compareVersions('1.2.0-beta.1', '1.2.0')).toBe(-1);
    expect(compareVersions('1.2.0-beta.2', '1.2.0-beta.11')).toBe(-1);
    expect(compareVersions('1.2.0+build.9', '1.2.0+build.1')).toBe(0);
    expect(compareVersions('V2.0.0', 'v1.0.0')).toBe(1);
  });
  test('rejects malformed versions instead of coercing them', () => {
    expect(compareVersions('1.2', '1.2.0')).toBeNull();
    expect(compareVersions('', '0.0.0')).toBeNull();
    expect(compareVersions('1.x.3', '1.0.3')).toBeNull();
    expect(compareVersions('01.2.3', '1.2.3')).toBeNull();
  });
  test('parse returns a structured valid SemVer or null', () => {
    expect(parse('v1.2.3-rc.2')).toMatchObject({ major: 1, minor: 2, patch: 3, prerelease: ['rc', 2] });
    expect(parse(null)).toBeNull();
  });

  test('covers every SemVer prerelease precedence rule and strict identifier validation', () => {
    expect(parse('1.0.0-01')).toBeNull();
    expect(parse('1.2.3-alpha+build.7')).toEqual({
      major: 1, minor: 2, patch: 3, prerelease: ['alpha'], build: ['build', '7'],
    });
    expect(compareVersions('1.0.0', '1.0.0-rc.1')).toBe(1);
    expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBe(-1);
    expect(compareVersions('1.0.0-alpha', '1.0.0-alpha.1')).toBe(-1);
    expect(compareVersions('1.0.0-alpha.1', '1.0.0-alpha')).toBe(1);
    expect(compareVersions('1.0.0-1', '1.0.0-alpha')).toBe(-1);
    expect(compareVersions('1.0.0-alpha', '1.0.0-1')).toBe(1);
    expect(compareVersions('1.0.0-beta', '1.0.0-alpha')).toBe(1);
    expect(compareVersions('1.0.0-alpha', '1.0.0-beta')).toBe(-1);
    expect(compareVersions('1.0.0-alpha', '1.0.0-alpha')).toBe(0);
  });
});
