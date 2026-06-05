/**
 * protocol.test.js — T-AI2 bpmd:// resolver.
 */
import { describe, test, expect } from 'vitest';
import path from 'node:path';
import { parseBpmdUrl, resolveAsset } from '../../src/main/protocol.js';

const ROOT = '/vault';

describe('parseBpmdUrl', () => {
  test('extracts decoded relPath', () => {
    expect(parseBpmdUrl('bpmd://vault/sub/pic%20a.png')).toBe('sub/pic a.png');
  });
  test('null for non-bpmd', () => {
    expect(parseBpmdUrl('https://x/a.png')).toBeNull();
    expect(parseBpmdUrl(42)).toBeNull();
  });
});

describe('resolveAsset', () => {
  test('resolves a vault-relative file under root', () => {
    expect(resolveAsset('bpmd://vault/img/a.png', ROOT, path.posix))
      .toEqual({ path: '/vault/img/a.png' });
  });
  test('rejects traversal (EC-B1)', () => {
    expect(resolveAsset('bpmd://vault/../etc/passwd', ROOT, path.posix))
      .toEqual({ error: 'unauthorized-path' });
  });
  test('rejects absolute relPath', () => {
    expect(resolveAsset('bpmd://vault//etc/passwd', ROOT, path.posix))
      .toEqual({ error: 'unauthorized-path' });
  });
  test('rejects root itself (not a file)', () => {
    expect(resolveAsset('bpmd://vault/.', ROOT, path.posix))
      .toEqual({ error: 'unauthorized-path' });
  });
  test('bad url / missing root', () => {
    expect(resolveAsset('https://x', ROOT, path.posix)).toEqual({ error: 'bad-url' });
    expect(resolveAsset('bpmd://vault/a.png', '', path.posix)).toEqual({ error: 'unauthorized-path' });
  });
});

// ── Mutation-hardening: kill survivors on the parser + path guard (audit F-3) ──
describe('parseBpmdUrl — guard + anchoring (mutation kills)', () => {
  test('non-string with a matching toString is still rejected (the typeof guard matters)', () => {
    // Without the `typeof url !== string` guard, regex.exec would stringify this and match.
    expect(parseBpmdUrl({ toString: () => 'bpmd://vault/x' })).toBeNull();
  });
  test('URL must START with bpmd:// (anchored ^) — a prefixed string does not match', () => {
    expect(parseBpmdUrl('zbpmd://vault/a.png')).toBeNull();
    expect(parseBpmdUrl('x bpmd://vault/a.png')).toBeNull();
  });
  test('case-insensitive scheme still parses', () => {
    expect(parseBpmdUrl('BPMD://VAULT/a.png')).toBe('a.png');
  });
  test('percent-encoded traversal decodes (so the resolver can reject it)', () => {
    expect(parseBpmdUrl('bpmd://vault/%2e%2e/secret')).toBe('../secret');
  });
});

describe('resolveAsset — every guard branch (mutation kills)', () => {
  const P = path.posix;
  test('non-bpmd URL → bad-url (not unauthorized, not a throw)', () => {
    expect(resolveAsset('https://x/a', ROOT, P)).toEqual({ error: 'bad-url' });
    expect(resolveAsset('totally-bogus', ROOT, P)).toEqual({ error: 'bad-url' });
  });
  test('missing/!string root → unauthorized (both null and non-string)', () => {
    expect(resolveAsset('bpmd://vault/a.png', null, P)).toEqual({ error: 'unauthorized-path' });
    expect(resolveAsset('bpmd://vault/a.png', 42, P)).toEqual({ error: 'unauthorized-path' });
    expect(resolveAsset('bpmd://vault/a.png', '', P)).toEqual({ error: 'unauthorized-path' });
  });
  test('absolute relPath → unauthorized (isAbsolute guard)', () => {
    expect(resolveAsset('bpmd://vault//etc/passwd', ROOT, P)).toEqual({ error: 'unauthorized-path' });
  });
  test('".." traversal (startsWith "..") → unauthorized', () => {
    expect(resolveAsset('bpmd://vault/../etc/passwd', ROOT, P)).toEqual({ error: 'unauthorized-path' });
    expect(resolveAsset('bpmd://vault/a/../../etc', ROOT, P)).toEqual({ error: 'unauthorized-path' });
  });
  test('encoded ".." traversal is decoded then rejected', () => {
    expect(resolveAsset('bpmd://vault/%2e%2e/etc/passwd', ROOT, P)).toEqual({ error: 'unauthorized-path' });
  });
  test('relPath that resolves to the root dir itself ("" back) → unauthorized', () => {
    expect(resolveAsset('bpmd://vault/.', ROOT, P)).toEqual({ error: 'unauthorized-path' });
    expect(resolveAsset('bpmd://vault/img/..', ROOT, P)).toEqual({ error: 'unauthorized-path' });
  });
  test('a valid NESTED file under root resolves (positive case keeps the happy path live)', () => {
    expect(resolveAsset('bpmd://vault/a/b/c.png', ROOT, P)).toEqual({ path: '/vault/a/b/c.png' });
  });
});
