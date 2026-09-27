import { describe, expect, test, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  pinMatches,
  chainSpkiPins,
  isGithubApiUrl,
  createPinnedGithubFetch,
  DEFAULT_CERT_PINS,
} from '../../src/main/github-tls.js';

// Throwaway self-signed fixtures (never trusted for anything but these tests). Their SPKI
// SHA-256 hashes are pinned in the constants below, so pin matching can be exercised with
// real DER input end-to-end — the 1.3.0 incident was a pin that looked fine and matched
// nothing, which string-only mocks cannot catch.
const CERT_A_B64 = 'LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tDQpNSUlEQ1RDQ0FmR2dBd0lCQWdJVVd1MGl0VVJhTTZTZjRHckc1L2V0TUpmSE1md3dEUVlKS29aSWh2Y05BUUVMDQpCUUF3RkRFU01CQUdBMVVFQXd3SlptbDRkSFZ5WlMxaE1CNFhEVEkyTURreU1qQXlOVFF5T1ZvWERUSTJNRGt5DQpNekF5TlRReU9Wb3dGREVTTUJBR0ExVUVBd3dKWm1sNGRIVnlaUzFoTUlJQklqQU5CZ2txaGtpRzl3MEJBUUVGDQpBQU9DQVE4QU1JSUJDZ0tDQVFFQTN2OENvN09ueHBrS3RVMzhhYzFlQ1RvNldDZWpSSGpoNWEyeHptWmpCNS9BDQpFamYyRlJtN2txTVhibFpKYnMvYnZJMTEza0p2ZG41dnlKMGRKem1sWTBhY29tbS9obVczTGkzRjNKeVJpTWdjDQpUZ0VscHZSNXpPOW4wN3ZGNGFRYUFzMFVaS2xDQTBGTXYxTVZZVko5V2Z3RC9DaG1lUkVtZ2hXc0tRbCtMaVFlDQp3cXo4ZEVkdHA1aXdaNktDQVdXZ0VYY0NDbGJFaW1XM3cwaDJZS0tsY2Y5VkNkMXZaL1dlRFplK2QzcUVZa2h6DQpRQTFzTjlqU296d3RmZy9CMGRHUEc1WmNvMVFmYzM4dTJpZWxHQzFORHN4UGQwdWNsdU9LMk1qckdaZ0NQR0Q2DQpibTBZL3Q0aWk5bHliTFNlVHRuSTRDRW9nZ2YzSkdiQkV5L0pkMlFCcVFJREFRQUJvMU13VVRBZEJnTlZIUTRFDQpGZ1FVNzcra2NaYy8xSTlHbnB4THBOMG8ycEhTazM0d0h3WURWUjBqQkJnd0ZvQVU3NytrY1pjLzFJOUducHhMDQpwTjBvMnBIU2szNHdEd1lEVlIwVEFRSC9CQVV3QXdFQi96QU5CZ2txaGtpRzl3MEJBUXNGQUFPQ0FRRUFyREFCDQp6bVYrdXRqSjl3OEczU01XdGhNQTdmMllGM2R3VHg1VHVueDd6K3NocEx0MXVudXhRNmRsenZqUVlqYUlsOFE5DQpoWHRSaENIcGpVTmJXTmVwRkhKZ29EUEt0VHN2azE4N1hSMHg3M3dwd08xSGF6WmIrUWw3Y2ZQb0NkaHNVZU5QDQpQYU5XV3BWNnRYNUpQV3dmSGlVbHFTRXdqd09uQWNhcGI0aXM1dExad3UzVkhQOWpJZE5BRS9YaVVqUFk1ak83DQptNHI5Rno4WDRqUEhxY1JGMEZsOWU4WmlubmxyNzVqTlhCeThBV2FGMG1ZazIzZWY3TG15cHNUWHZhYnZTb1VlDQpjbC8xWGRHenJhWnVFNjMzL0NBZmRDdE04MElaRDk3M2k5Nzh0ZklzV1MxdHNobmN4a1VIcnVjenNtMVREN1Q2DQo2SjQ2dklKc0ZBY1JMK1N1Q2c9PQ0KLS0tLS1FTkQgQ0VSVElGSUNBVEUtLS0tLQ0K';
const CERT_A_PIN = '994925e4a9f21419d1110734ce41d2419f02612b88e26aa98b5b0759e90c5a9e';
const CERT_B_B64 = 'LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tDQpNSUlEQ1RDQ0FmR2dBd0lCQWdJVWUwSWZ5M0FiWEZ2V3lxdHZkMkg4c0ptckM5NHdEUVlKS29aSWh2Y05BUUVMDQpCUUF3RkRFU01CQUdBMVVFQXd3SlptbDRkSFZ5WlMxaU1CNFhEVEkyTURreU1qQXlOVFF6TlZvWERUSTJNRGt5DQpNekF5TlRRek5Wb3dGREVTTUJBR0ExVUVBd3dKWm1sNGRIVnlaUzFpTUlJQklqQU5CZ2txaGtpRzl3MEJBUUVGDQpBQU9DQVE4QU1JSUJDZ0tDQVFFQTFuNW1TNWtFT09hTXp1NlAzV2s1UFdJMnRrRnYwYWVwUHRXVXJpQ1F2cjBqDQpkYzZSYkZOT1J0elFsMXRaZyt2cXRxejRkNDJWUHpyOXpxTXZsdlIxZXhJS2tZZkVNaU03Sno0ZzJoTXpBbWIxDQpadkZ0WHd5UUdEUWVQc0lWR3Q1RWd4dGd0NDZkWHFxckZ0UXZXQkZlUXRONEVoUEpuNE1rZnhzZVNGa0Y1T0RJDQpnNmpKcXYreExNVTVkK1J3NWNIb042U2VVT1JTYzk2M001N2RrRWJBdUw3emVJU0ZzSEVxNHp4TGxZS3FrdjVMDQpLSURmalZaNHhsVG1DWkFvdDZRS0xMWS9aYitpNkZPbW45WTJwVlZXUkthL3RBN3VxRThhMnloN2xUcXRJaHI4DQp4SWVpMVIrelhpYkVHYlk3anp3Rlh5bFlpRG9KTjJ5ZENzOXFTV1hMYVFJREFRQUJvMU13VVRBZEJnTlZIUTRFDQpGZ1FVbFFsNWRWMHZ4Ymh3VjFPQk9DNDh0ZmJnYW4wd0h3WURWUjBqQkJnd0ZvQVVsUWw1ZFYwdnhiaHdWMU9CDQpPQzQ4dGZiZ2FuMHdEd1lEVlIwVEFRSC9CQVV3QXdFQi96QU5CZ2txaGtpRzl3MEJBUXNGQUFPQ0FRRUFIM0V0DQpLTTgyMGZiaDZHcHFWZnB5c3BUcmtZUk5EdjhMd21GSU5QQ3d0anBGTGNZMTJZWVJKakppcnVHbzcwcjF6R2VlDQpBbEZRQ214NC9UT3BId1hHZUpEMG1GRXB6dGpkdU5rQk1kWGpnbVk0Y0Y5eE5xQmE2emtOYmc3RlRrSmVhMmlRDQpKMzdURE5Nc0c5SVVTSy9NOUljVmxRbC9UT1oxdW9HVnVtUG5VSndqTlY2TGZZdjRUQXhZZFdMcGJoMEpSSVNBDQpXQVYrNTJzMHl2T25Ndm9HTERvS1A3UmZhUHNtR2ZFZ2tqVkdnbkpxaE1PNUdGK1phaDVuUTJJeW1pdzZUbDE3DQpJTmVlNXR3eFd1K0JVRG9tWmFNd0lpMnN6ZTkydXpjVk5iTGhvSzVqVE1kZFlnU01DSEFjKzhocnFkM3dYWFczDQo5NHZiVlVjOHhMTFlvaG9JalE9PQ0KLS0tLS1FTkQgQ0VSVElGSUNBVEUtLS0tLQ0K';
const CERT_B_PIN = '3d33094b60eb875ccac70fffb8b0f463c8dcd47e541e0ccba8c8ef9fee1a3b73';

function certFixture(b64, fingerprint) {
  return { raw: Buffer.from(b64, 'base64'), fingerprint256: fingerprint };
}

/** A presented chain: leaf A issued (in the fixture's eyes) by CA B. */
function chainFixture() {
  return {
    ...certFixture(CERT_A_B64, 'aa:01'),
    issuerCertificate: certFixture(CERT_B_B64, 'aa:02'),
  };
}

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

  test('pins are SPKI hashes: matching is over the public key, colons ignored', () => {
    const certA = certFixture(CERT_A_B64, 'aa:01');
    expect(pinMatches(certA, [CERT_A_PIN])).toBe(true);
    expect(pinMatches(certA, [CERT_A_PIN.replace(/(..)/g, '$1:').replace(/:$/, '')])).toBe(true);
    expect(pinMatches(certA, [CERT_B_PIN])).toBe(false);
    expect(pinMatches(certA, ['9999999999999999999999999999999999999999999999999999999999999999'])).toBe(false);
  });

  // SEC-06 (T7.1): the pin list is an ARRAY so a rotation is a one-line addition. Matching
  // succeeds on ANY entry, in any position — and a certificate matching none is still refused.
  test('accepts a certificate matching any pin, including from the second entry', () => {
    const rotation = [CERT_A_PIN, CERT_B_PIN];
    expect(pinMatches(certFixture(CERT_A_B64, 'aa:01'), rotation)).toBe(true);
    expect(pinMatches(certFixture(CERT_B_B64, 'aa:02'), rotation)).toBe(true);
    expect(pinMatches(certFixture(CERT_A_B64, 'aa:01'), [CERT_B_PIN])).toBe(false);
  });

  test('a pin on the ISSUING CA accepts a leaf issued by it (rotation runway)', () => {
    const chain = chainFixture();
    expect(chainSpkiPins(chain)).toEqual([CERT_A_PIN, CERT_B_PIN]);
    expect(pinMatches(chain, [CERT_B_PIN])).toBe(true);
  });

  test('the chain walk terminates on a self-referencing issuer', () => {
    const leaf = certFixture(CERT_A_B64, 'aa:01');
    leaf.issuerCertificate = leaf; // hostile/mocked cycle
    expect(chainSpkiPins(leaf)).toEqual([CERT_A_PIN]);
  });

  test('a broken certificate in the chain degrades to the pins that do parse', () => {
    const broken = { raw: Buffer.from('not a certificate'), fingerprint256: 'aa:03' };
    broken.issuerCertificate = certFixture(CERT_B_B64, 'aa:02');
    expect(chainSpkiPins(broken)).toEqual([CERT_B_PIN]);
  });

  test('a response whose leaf matches only the SECOND pin is accepted by the live fetch', async () => {
    const requestFn = (_opts, cb) => {
      const res = new EventEmitter();
      res.socket = { getPeerCertificate: () => certFixture(CERT_B_B64, 'bb:bb') };
      res.statusCode = 200;
      queueMicrotask(() => {
        cb(res);
        res.emit('data', Buffer.from('{"tag_name":"v1.2.3"}'));
        res.emit('end');
      });
      return { on: vi.fn(), end: vi.fn(), destroy: vi.fn() };
    };
    const fetchFn = createPinnedGithubFetch({ requestFn, pins: [CERT_A_PIN, CERT_B_PIN] });
    const response = await fetchFn('https://api.github.com/repos/x/y/releases/latest');
    expect(response.ok).toBe(true);
    expect(await response.json()).toEqual({ tag_name: 'v1.2.3' });
  });

  test('the shipped pin array holds only real 64-hex SPKI hashes — never a placeholder', () => {
    expect(Array.isArray(DEFAULT_CERT_PINS)).toBe(true);
    expect(DEFAULT_CERT_PINS.length).toBeGreaterThan(0);
    for (const pin of DEFAULT_CERT_PINS) {
      // A placeholder would fail this shape check, which is the point: a bogus entry cannot
      // strengthen anything, it only hides a broken rotation (matching is fail-closed).
      expect(pin).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  test('bootstrap defaults update traffic to the pinned GitHub fetch', () => {
    const main = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../src/main/index.js'), 'utf8');
    expect(main).toContain('fetchFn = createPinnedGithubFetch()');
  });

  test('rejects a response whose certificate chain is not pinned', async () => {
    const requestFn = (_opts, cb) => {
      const res = new EventEmitter();
      res.socket = { getPeerCertificate: () => certFixture(CERT_B_B64, '00:11:22') };
      res.statusCode = 200;
      res.resume = vi.fn();
      queueMicrotask(() => cb(res));
      return { on: vi.fn(), end: vi.fn(), destroy: vi.fn() };
    };
    const fetchFn = createPinnedGithubFetch({ requestFn, pins: [CERT_A_PIN] });
    await expect(fetchFn('https://api.github.com/repos/x/y/releases/latest')).rejects.toThrow('tls-pin-mismatch');
  });

  test('rejects an empty pin set (fail closed, never fail open)', async () => {
    const requestFn = (_opts, cb) => {
      const res = new EventEmitter();
      res.socket = { getPeerCertificate: () => certFixture(CERT_A_B64, 'aa:01') };
      res.statusCode = 200;
      res.resume = vi.fn();
      queueMicrotask(() => cb(res));
      return { on: vi.fn(), end: vi.fn(), destroy: vi.fn() };
    };
    const fetchFn = createPinnedGithubFetch({ requestFn, pins: [] });
    await expect(fetchFn('https://api.github.com/repos/x/y/releases/latest')).rejects.toThrow('tls-pin-mismatch');
  });

  test('resolves JSON when the pin matches', async () => {
    const requestFn = (_opts, cb) => {
      const res = new EventEmitter();
      res.socket = { getPeerCertificate: () => certFixture(CERT_A_B64, 'aa:bb') };
      res.statusCode = 200;
      queueMicrotask(() => {
        cb(res);
        res.emit('data', Buffer.from('{"tag_name":"v1.0.0"}'));
        res.emit('end');
      });
      return { on: vi.fn(), end: vi.fn(), destroy: vi.fn() };
    };
    const fetchFn = createPinnedGithubFetch({ requestFn, pins: [CERT_A_PIN] });
    const response = await fetchFn('https://api.github.com/repos/x/y/releases/latest');
    expect(response.ok).toBe(true);
    expect(await response.json()).toEqual({ tag_name: 'v1.0.0' });
  });

  test('a body over the size cap rejects instead of buffering, even with a valid pin', async () => {
    const requestFn = (_opts, cb) => {
      const res = new EventEmitter();
      res.socket = { getPeerCertificate: () => certFixture(CERT_A_B64, 'aa:bb') };
      res.statusCode = 200;
      queueMicrotask(() => {
        cb(res);
        res.emit('data', Buffer.from('12345678'));
        res.emit('data', Buffer.from('9'));
      });
      return { on: vi.fn(), end: vi.fn(), destroy: vi.fn() };
    };
    const fetchFn = createPinnedGithubFetch({ requestFn, pins: [CERT_A_PIN], maxResponseBytes: 8 });
    await expect(fetchFn('https://api.github.com/repos/x/y/releases/latest')).rejects.toThrow('response-too-large');
  });

  test('a body exactly at the size cap still parses (boundary)', async () => {
    let res;
    const requestFn = (_opts, cb) => {
      res = new EventEmitter();
      res.socket = { getPeerCertificate: () => certFixture(CERT_A_B64, 'aa:bb') };
      res.statusCode = 200;
      queueMicrotask(() => {
        cb(res);
        res.emit('data', Buffer.from('{"latest":0}'));
        res.emit('end');
      });
      return { on: vi.fn(), end: vi.fn(), destroy: vi.fn() };
    };
    const fetchFn = createPinnedGithubFetch({ requestFn, pins: [CERT_A_PIN], maxResponseBytes: 12 });
    const response = await fetchFn('https://api.github.com/repos/x/y/releases/latest');
    expect(response.ok).toBe(true);
    expect(await response.json()).toEqual({ latest: 0 });
  });

  test('rejects non-GitHub hosts before opening a socket', async () => {
    const requestFn = vi.fn();
    const fetchFn = createPinnedGithubFetch({ requestFn, pins: [CERT_A_PIN] });
    await expect(fetchFn('https://evil.example/latest')).rejects.toThrow('blocked-host');
    expect(requestFn).not.toHaveBeenCalled();
  });

  test('rejects a missing peer certificate', async () => {
    const requestFn = mockRequest((res, _req, cb) => {
      res.socket = {};
      res.resume = vi.fn();
      queueMicrotask(() => cb(res));
    });
    const fetchFn = createPinnedGithubFetch({ requestFn, pins: [CERT_A_PIN] });
    await expect(fetchFn('https://api.github.com/repos/x/y/releases/latest')).rejects.toThrow('tls-pin-mismatch');
  });

  test('propagates request errors', async () => {
    const requestFn = mockRequest((_res, req) => {
      queueMicrotask(() => req.emit('error', new Error('socket hang up')));
    });
    const fetchFn = createPinnedGithubFetch({ requestFn, pins: [CERT_A_PIN] });
    await expect(fetchFn('https://api.github.com/repos/x/y/releases/latest')).rejects.toThrow('socket hang up');
  });

  test('aborts an in-flight request when the caller signal fires', async () => {
    const requestFn = mockRequest(() => {});
    const fetchFn = createPinnedGithubFetch({ requestFn, pins: [CERT_A_PIN] });
    const signal = new AbortController();
    const pending = fetchFn('https://api.github.com/repos/x/y/releases/latest', { signal: signal.signal });
    signal.abort();
    await expect(pending).rejects.toThrow('aborted');
  });

  test('refuses an already-aborted signal without waiting for a response', async () => {
    const requestFn = mockRequest(() => {});
    const fetchFn = createPinnedGithubFetch({ requestFn, pins: [CERT_A_PIN] });
    const signal = new AbortController();
    signal.abort();
    await expect(fetchFn('https://api.github.com/repos/x/y/releases/latest', { signal: signal.signal }))
      .rejects.toThrow('aborted');
  });
});
