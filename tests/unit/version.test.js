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
  test('ignores a leading v and a pre-release suffix', () => {
    expect(compareVersions('v1.2.0', '1.2.0')).toBe(0);
    expect(compareVersions('1.2.0-beta.1', '1.2.0')).toBe(0); // pre-release suffix dropped
    expect(compareVersions('V2.0.0', 'v1.0.0')).toBe(1);
  });
  test('handles uneven segment counts + garbage gracefully', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('1.2.1', '1.2')).toBe(1);
    expect(compareVersions('', '0.0.0')).toBe(0);
    expect(compareVersions('1.x.3', '1.0.3')).toBe(0); // non-numeric → 0
  });
  test('parse extracts the numeric release triple', () => {
    expect(parse('v1.2.3-rc.2')).toEqual([1, 2, 3]);
    expect(parse(null)).toEqual([0]);
  });
});
