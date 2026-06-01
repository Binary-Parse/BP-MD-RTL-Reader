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
