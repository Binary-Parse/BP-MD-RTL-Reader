import { describe, expect, test, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  pinMatches,
  isGithubApiUrl,
  createPinnedGithubFetch,
  DEFAULT_CERT_PINS,
} from '../../src/main/github-tls.js';

function mockRequest(setup) {
  return (_opts, cb) => {
    const res = new EventEmitter();
    const req = new EventEmitter();
    req.end = vi.fn();
    req.destroy = vi.fn((err) => req.emit('error', err || new Error('destroyed')));
    setup(res, req, cb);
    return req;
  };
}

describe('GitHub TLS pin', () => {
  test('accepts only https api.github.com URLs', () => {
    expect(isGithubApiUrl('https://api.github.com/repos/x/y/releases/latest')).toBe(true);
    expect(isGithubApiUrl('http://api.github.com/x')).toBe(false);
    expect(isGithubApiUrl('https://evil.example/x')).toBe(false);
    expect(isGithubApiUrl('https://api.github.com.evil.example/x')).toBe(false);
    expect(isGithubApiUrl('not a url')).toBe(false);
  });

  test('compares SHA-256 fingerprints without colons', () => {
    expect(pinMatches('B4:2B:6A:E8', ['b42b6ae8'])).toBe(true);
    expect(pinMatches('aaaa', DEFAULT_CERT_PINS)).toBe(false);
  });

  test('bootstrap defaults update traffic to the pinned GitHub fetch', () => {
    const main = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../src/main/index.js'), 'utf8');
    expect(main).toContain('fetchFn = createPinnedGithubFetch()');
  });

  test('rejects a response whose leaf certificate is not pinned', async () => {
    const requestFn = (_opts, cb) => {
      const res = new EventEmitter();
      res.socket = { getPeerCertificate: () => ({ fingerprint256: '00:11:22' }) };
      res.statusCode = 200;
      res.resume = vi.fn();
      queueMicrotask(() => cb(res));
      return { on: vi.fn(), end: vi.fn(), destroy: vi.fn() };
    };
    const fetchFn = createPinnedGithubFetch({ requestFn, pins: ['deadbeef'] });
    await expect(fetchFn('https://api.github.com/repos/x/y/releases/latest')).rejects.toThrow('tls-pin-mismatch');
  });

  test('resolves JSON when the pin matches', async () => {
    const requestFn = (_opts, cb) => {
      const res = new EventEmitter();
      res.socket = { getPeerCertificate: () => ({ fingerprint256: 'aa:bb' }) };
      res.statusCode = 200;
      queueMicrotask(() => {
        cb(res);
        res.emit('data', Buffer.from('{"tag_name":"v1.0.0"}'));
        res.emit('end');
      });
      return { on: vi.fn(), end: vi.fn(), destroy: vi.fn() };
    };
    const fetchFn = createPinnedGithubFetch({ requestFn, pins: ['aabb'] });
    const response = await fetchFn('https://api.github.com/repos/x/y/releases/latest');
    expect(response.ok).toBe(true);
    expect(await response.json()).toEqual({ tag_name: 'v1.0.0' });
  });

  test('rejects non-GitHub hosts before opening a socket', async () => {
    const requestFn = vi.fn();
    const fetchFn = createPinnedGithubFetch({ requestFn, pins: ['aabb'] });
    await expect(fetchFn('https://evil.example/latest')).rejects.toThrow('blocked-host');
    expect(requestFn).not.toHaveBeenCalled();
  });

  test('rejects a missing peer certificate', async () => {
    const requestFn = mockRequest((res, _req, cb) => {
      res.socket = {};
      res.resume = vi.fn();
      queueMicrotask(() => cb(res));
    });
    const fetchFn = createPinnedGithubFetch({ requestFn, pins: ['aabb'] });
    await expect(fetchFn('https://api.github.com/repos/x/y/releases/latest')).rejects.toThrow('tls-pin-mismatch');
  });

  test('propagates request errors', async () => {
    const requestFn = mockRequest((_res, req) => {
      queueMicrotask(() => req.emit('error', new Error('socket hang up')));
    });
    const fetchFn = createPinnedGithubFetch({ requestFn, pins: ['aabb'] });
    await expect(fetchFn('https://api.github.com/repos/x/y/releases/latest')).rejects.toThrow('socket hang up');
  });

  test('aborts an in-flight request when the caller signal fires', async () => {
    const requestFn = mockRequest(() => {});
    const fetchFn = createPinnedGithubFetch({ requestFn, pins: ['aabb'] });
    const signal = new AbortController();
    const pending = fetchFn('https://api.github.com/repos/x/y/releases/latest', { signal: signal.signal });
    signal.abort();
    await expect(pending).rejects.toThrow('aborted');
  });

  test('refuses an already-aborted signal without waiting for a response', async () => {
    const requestFn = mockRequest(() => {});
    const fetchFn = createPinnedGithubFetch({ requestFn, pins: ['aabb'] });
    const signal = new AbortController();
    signal.abort();
    await expect(fetchFn('https://api.github.com/repos/x/y/releases/latest', { signal: signal.signal }))
      .rejects.toThrow('aborted');
  });
});
