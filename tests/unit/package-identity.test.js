/**
 * Rebrand guard (Marqam → BP MD RTL Reader).
 *
 * Pins the packaging identity in package.json so a regression that reverts the
 * product name / appId / publisher metadata is caught by the unit suite. These
 * assertions go RED against the pre-rebrand package.json (name "marqam",
 * productName "Marqam", appId "com.marqam.app", no author/license).
 */
import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8'));

describe('package.json identity — BP MD RTL Reader rebrand', () => {
  test('npm package name is the bpmdrtlreader slug', () => {
    expect(pkg.name).toBe('bpmdrtlreader');
  });

  test('build.productName is the display name', () => {
    expect(pkg.build.productName).toBe('BP MD RTL Reader');
  });

  test('build.appId is the reverse-DNS Binary Parse id', () => {
    expect(pkg.build.appId).toBe('com.binaryparse.bpmdrtlreader');
  });

  test('nsis.shortcutName is the display name', () => {
    expect(pkg.build.nsis.shortcutName).toBe('BP MD RTL Reader');
  });

  test('publisher (author) and license are declared as Binary Parse / MIT', () => {
    expect(String(pkg.author || '')).toContain('Binary Parse');
    expect(pkg.license).toBe('MIT');
  });

  test('no stale "marqam" survives in any identity field', () => {
    expect(pkg.name.toLowerCase()).not.toContain('marqam');
    expect(pkg.build.appId.toLowerCase()).not.toContain('marqam');
    expect(pkg.build.productName.toLowerCase()).not.toContain('marqam');
    expect(String(pkg.build.nsis.guid).toLowerCase()).not.toContain('marqam');
  });
});
