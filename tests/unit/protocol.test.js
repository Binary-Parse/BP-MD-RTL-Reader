/**
 * protocol.test.js — T-AI2 bpmd:// resolver.
 */
import { describe, test, expect } from 'vitest';
import path from 'node:path';
import { parseBpmdUrl, resolveAsset, validateAsset, resolveAppAsset, appResponseHeaders, APP_RENDERER_URL } from '../../src/main/protocol.js';

const ROOT = '/vault';

describe('parseBpmdUrl', () => {
  test('extracts the vaultId and decoded rel as separate fields', () => {
    expect(parseBpmdUrl('bpmd://vault/cap-a/sub/pic%20a.png')).toEqual({ vaultId: 'cap-a', rel: 'sub/pic a.png' });
  });
  test('null for non-bpmd', () => {
    expect(parseBpmdUrl('https://x/a.png')).toBeNull();
    expect(parseBpmdUrl(42)).toBeNull();
  });
  test('null when no vaultId/rel segment split exists', () => {
    expect(parseBpmdUrl('bpmd://vault/onlyonesegment')).toBeNull();
  });
  test('strips a literal query/fragment before resolving so cache-busted image srcs work (PROT-01)', () => {
    expect(parseBpmdUrl('bpmd://vault/cap-a/pic.png?v=2')).toEqual({ vaultId: 'cap-a', rel: 'pic.png' });
    expect(parseBpmdUrl('bpmd://vault/cap-a/pic.png#crop')).toEqual({ vaultId: 'cap-a', rel: 'pic.png' });
    expect(parseBpmdUrl('bpmd://vault/cap-a/sub/pic.png?a=1#b')).toEqual({ vaultId: 'cap-a', rel: 'sub/pic.png' });
    expect(parseBpmdUrl('bpmd://vault/cap-a/pic%3Fv%3D2')).toEqual({ vaultId: 'cap-a', rel: 'pic?v=2' });
    expect(resolveAsset('bpmd://vault/cap-a/pic.png?v=2', ROOT, path.posix)).toEqual({ path: '/vault/pic.png' });
  });
});

describe('resolveAsset', () => {
  test('resolves a vault-relative file under root', () => {
    expect(resolveAsset('bpmd://vault/cap-a/img/a.png', ROOT, path.posix))
      .toEqual({ path: '/vault/img/a.png' });
  });
  test('rejects traversal (EC-B1)', () => {
    expect(resolveAsset('bpmd://vault/cap-a/../etc/passwd', ROOT, path.posix))
      .toEqual({ error: 'unauthorized-path' });
  });
  test('rejects absolute relPath', () => {
    expect(resolveAsset('bpmd://vault/cap-a//etc/passwd', ROOT, path.posix))
      .toEqual({ error: 'unauthorized-path' });
  });
  test('rejects root itself (not a file)', () => {
    expect(resolveAsset('bpmd://vault/cap-a/.', ROOT, path.posix))
      .toEqual({ error: 'unauthorized-path' });
  });
  test('bad url / missing root', () => {
    expect(resolveAsset('https://x', ROOT, path.posix)).toEqual({ error: 'bad-url' });
    expect(resolveAsset('bpmd://vault/cap-a/a.png', '', path.posix)).toEqual({ error: 'unauthorized-path' });
  });
});

describe('validateAsset', () => {
  test('requires a canonical in-vault regular allowlisted image below the size cap', async () => {
    const fs = { promises: {
      realpath: async p => p,
      stat: async () => ({ isFile: () => true, size: 42 }),
    } };
    await expect(validateAsset('/vault/pic.png', '/vault', fs, path.posix))
      .resolves.toEqual({ path: '/vault/pic.png', type: 'image/png', size: 42 });
  });

  test('rejects symlink escapes, special files, unknown types, and oversized images', async () => {
    const makeFs = (real, stat) => ({ promises: { realpath: async p => p === '/vault' ? '/vault' : real, stat: async () => stat } });
    await expect(validateAsset('/vault/link.png', '/vault', makeFs('/outside/secret.png', { isFile: () => true, size: 1 }), path.posix))
      .resolves.toEqual({ error: 'unauthorized-path' });
    await expect(validateAsset('/vault/device.png', '/vault', makeFs('/vault/device.png', { isFile: () => false, size: 1 }), path.posix))
      .resolves.toEqual({ error: 'not-regular-file' });
    await expect(validateAsset('/vault/a.svg', '/vault', makeFs('/vault/a.svg', { isFile: () => true, size: 1 }), path.posix))
      .resolves.toEqual({ error: 'unsupported-type' });
    await expect(validateAsset('/vault/a.png', '/vault', makeFs('/vault/a.png', { isFile: () => true, size: 6 * 1024 * 1024 }), path.posix))
      .resolves.toEqual({ error: 'file-too-large' });
  });
});

// ── Mutation-hardening: kill survivors on the parser + path guard (audit F-3) ──
describe('parseBpmdUrl — guard + anchoring (mutation kills)', () => {
  test('non-string with a matching toString is still rejected (the typeof guard matters)', () => {
    // Without the `typeof url !== string` guard, regex.exec would stringify this and match.
    expect(parseBpmdUrl({ toString: () => 'bpmd://vault/x' })).toBeNull();
  });
  test('URL must START with bpmd:// (anchored ^) — a prefixed string does not match', () => {
    expect(parseBpmdUrl('zbpmd://vault/cap-a/a.png')).toBeNull();
    expect(parseBpmdUrl('x bpmd://vault/cap-a/a.png')).toBeNull();
  });
  test('case-insensitive scheme still parses', () => {
    expect(parseBpmdUrl('BPMD://VAULT/cap-a/a.png')).toEqual({ vaultId: 'cap-a', rel: 'a.png' });
  });
  test('percent-encoded traversal decodes (so the resolver can reject it)', () => {
    expect(parseBpmdUrl('bpmd://vault/cap-a/%2e%2e/secret')).toEqual({ vaultId: 'cap-a', rel: '../secret' });
  });
  test('malformed percent encoding falls back to the undecoded relative path', () => {
    expect(parseBpmdUrl('bpmd://vault/cap-a/bad%2')).toEqual({ vaultId: 'cap-a', rel: 'bad%2' });
  });
  test('a %2F inside rel cannot forge a different vaultId (id is split before decoding)', () => {
    expect(parseBpmdUrl('bpmd://vault/cap-a/x%2Fy.png')).toEqual({ vaultId: 'cap-a', rel: 'x/y.png' });
  });
});

describe('validateAsset — exact MIME and size-boundary results', () => {
  test('returns the exact MIME for every supported extension, case-insensitively', async () => {
    const expected = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
      webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon',
    };
    for (const [extension, type] of Object.entries(expected)) {
      const fs = { promises: {
        realpath: async value => value,
        stat: async () => ({ isFile: () => true, size: 5 * 1024 * 1024 }),
      } };
      await expect(validateAsset(`/vault/a.${extension.toUpperCase()}`, '/vault', fs, path.posix))
        .resolves.toEqual({ path: `/vault/a.${extension.toUpperCase()}`, type, size: 5 * 1024 * 1024 });
    }
  });
});

describe('resolveAsset — every guard branch (mutation kills)', () => {
  const P = path.posix;
  test('non-bpmd URL → bad-url (not unauthorized, not a throw)', () => {
    expect(resolveAsset('https://x/a', ROOT, P)).toEqual({ error: 'bad-url' });
    expect(resolveAsset('totally-bogus', ROOT, P)).toEqual({ error: 'bad-url' });
  });
  test('missing/!string root → unauthorized (both null and non-string)', () => {
    expect(resolveAsset('bpmd://vault/cap-a/a.png', null, P)).toEqual({ error: 'unauthorized-path' });
    expect(resolveAsset('bpmd://vault/cap-a/a.png', 42, P)).toEqual({ error: 'unauthorized-path' });
    expect(resolveAsset('bpmd://vault/cap-a/a.png', '', P)).toEqual({ error: 'unauthorized-path' });
  });
  test('absolute relPath → unauthorized (isAbsolute guard)', () => {
    expect(resolveAsset('bpmd://vault/cap-a//etc/passwd', ROOT, P)).toEqual({ error: 'unauthorized-path' });
  });
  test('".." traversal (startsWith "..") → unauthorized', () => {
    expect(resolveAsset('bpmd://vault/cap-a/../etc/passwd', ROOT, P)).toEqual({ error: 'unauthorized-path' });
    expect(resolveAsset('bpmd://vault/cap-a/a/../../etc', ROOT, P)).toEqual({ error: 'unauthorized-path' });
  });
  test('encoded ".." traversal is decoded then rejected', () => {
    expect(resolveAsset('bpmd://vault/cap-a/%2e%2e/etc/passwd', ROOT, P)).toEqual({ error: 'unauthorized-path' });
  });
  test('a file or folder whose NAME starts with dots is inside, not an escape', () => {
    expect(resolveAsset('bpmd://vault/cap-a/..notes/img.png', ROOT, P)).toEqual({ path: '/vault/..notes/img.png' });
    expect(resolveAsset('bpmd://vault/cap-a/..readme.md', ROOT, P)).toEqual({ path: '/vault/..readme.md' });
  });
  test('relPath that resolves to the root dir itself ("" back) → unauthorized', () => {
    expect(resolveAsset('bpmd://vault/cap-a/.', ROOT, P)).toEqual({ error: 'unauthorized-path' });
    expect(resolveAsset('bpmd://vault/cap-a/img/..', ROOT, P)).toEqual({ error: 'unauthorized-path' });
  });
  test('a valid NESTED file under root resolves (positive case keeps the happy path live)', () => {
    expect(resolveAsset('bpmd://vault/cap-a/a/b/c.png', ROOT, P)).toEqual({ path: '/vault/a/b/c.png' });
  });
});

describe('resolveAppAsset', () => {
  const P = path.posix;
  const APP = '/app';

  test('APP_RENDERER_URL is the exact packaged entry', () => {
    expect(APP_RENDERER_URL).toBe('app://ui/src/renderer/index.html');
  });

  test('resolves the renderer HTML with a MIME type and no realpath', () => {
    expect(resolveAppAsset('app://ui/src/renderer/index.html', APP, P))
      .toEqual({ path: '/app/src/renderer/index.html', type: 'text/html; charset=utf-8' });
    expect(resolveAppAsset('app://ui/src/renderer/app.js', APP, P))
      .toEqual({ path: '/app/src/renderer/app.js', type: 'text/javascript; charset=utf-8' });
    expect(resolveAppAsset('app://ui/resources/vendor/fonts/inter-latin-wght-normal.woff2', APP, P))
      .toEqual({ path: '/app/resources/vendor/fonts/inter-latin-wght-normal.woff2', type: 'font/woff2' });
  });

  test('rejects a host other than ui', () => {
    expect(resolveAppAsset('app://other/src/renderer/index.html', APP, P)).toEqual({ error: 'bad-url' });
  });

  test('rejects src/main, src/preload, package.json, and unknown extensions', () => {
    expect(resolveAppAsset('app://ui/src/main/index.js', APP, P)).toEqual({ error: 'unauthorized-path' });
    expect(resolveAppAsset('app://ui/src/preload/index.js', APP, P)).toEqual({ error: 'unauthorized-path' });
    expect(resolveAppAsset('app://ui/package.json', APP, P)).toEqual({ error: 'unauthorized-path' });
    expect(resolveAppAsset('app://ui/src/renderer/secret.bin', APP, P)).toEqual({ error: 'unsupported-type' });
  });

  test('rejects encoded traversal even when URL-normalized under root', () => {
    expect(resolveAppAsset('app://ui/src/%2e%2e/%2e%2e/etc/passwd', APP, P)).toEqual({ error: 'unauthorized-path' });
  });

  // audit SEC-08: the prefix/allow-list checks are textual. With an injected fs the
  // resolver must ALSO require the real paths to be contained, so a symlink planted under
  // src/renderer/ cannot serve a file from outside the app root.
  describe('realpath containment (audit SEC-08)', () => {
    // An escaping link: /app/src/renderer/leak.js really lives at /etc/leak.js.
    const escapingFs = { realpathSync: (p) => (p === '/app/src/renderer/leak.js' ? '/etc/leak.js' : p) };

    test('a target whose realpath escapes the renderer root is rejected', () => {
      expect(resolveAppAsset('app://ui/src/renderer/leak.js', APP, P, escapingFs))
        .toEqual({ error: 'unauthorized-path' });
    });

    test('a target that is a real file inside the root still resolves', () => {
      expect(resolveAppAsset('app://ui/src/renderer/app.js', APP, P, escapingFs))
        .toEqual({ path: '/app/src/renderer/app.js', type: 'text/javascript; charset=utf-8' });
      expect(resolveAppAsset('app://ui/resources/vendor/fonts/x.woff2', APP, P, escapingFs))
        .toEqual({ path: '/app/resources/vendor/fonts/x.woff2', type: 'font/woff2' });
    });

    test('a root that is itself a symlink does not false-positive its own contents', () => {
      // The packaged root may be a link: realpath(root) = /real/app, realpath(target) =
      // /real/app/src/... → still contained.
      const linkedRoot = {
        realpathSync: (p) => p.replace(/^\/app\b/, '/real/app'),
      };
      expect(resolveAppAsset('app://ui/src/renderer/index.html', APP, P, linkedRoot))
        .toEqual({ path: '/app/src/renderer/index.html', type: 'text/html; charset=utf-8' });
    });

    test('an unreadable/absent target (realpath throws) is refused, not served', () => {
      const throwing = { realpathSync: (p) => { if (p !== APP) throw new Error('ENOENT'); return p; } };
      expect(resolveAppAsset('app://ui/src/renderer/index.html', APP, P, throwing))
        .toEqual({ error: 'unauthorized-path' });
    });

    test('without an injected fs the textual 3-arg contract still holds', () => {
      expect(resolveAppAsset('app://ui/src/renderer/index.html', APP, P))
        .toEqual({ path: '/app/src/renderer/index.html', type: 'text/html; charset=utf-8' });
    });
  });
});

describe('appResponseHeaders', () => {
  // W3C CSP3 3.3: report-uri, frame-ancestors and sandbox are ignored when a policy is
  // delivered by <meta http-equiv>. The renderer's framing policy therefore has to arrive
  // as a real response header on the app:// document, not in index.html's CSP meta.
  const HTML = 'text/html; charset=utf-8';

  test('the HTML document carries frame-ancestors alongside its content type', () => {
    expect(appResponseHeaders(HTML)).toEqual({
      'content-type': HTML,
      'content-security-policy': "frame-ancestors 'none'",
    });
  });

  test('no other asset type carries a policy header', () => {
    for (const type of [
      'text/javascript; charset=utf-8',
      'text/css; charset=utf-8',
      'application/json',
      'image/svg+xml',
      'image/png',
      'font/woff',
      'font/woff2',
      'font/ttf',
      'text/plain; charset=utf-8',
    ]) {
      expect(appResponseHeaders(type), type).toEqual({ 'content-type': type });
    }
  });

  test('the gate is exact equality, not a substring match on text/', () => {
    // 'text/plain; charset=utf-8' and 'text/javascript; charset=utf-8' both contain
    // "text/", and .txt/.js are inside the app:// allow-list — a loose check would tag
    // them with a policy header they must never carry.
    expect(appResponseHeaders('text/html')).toEqual({ 'content-type': 'text/html' });
    expect(appResponseHeaders('TEXT/HTML; CHARSET=UTF-8'))
      .toEqual({ 'content-type': 'TEXT/HTML; CHARSET=UTF-8' });
  });

  test('every APP_MIME value round-trips through it without losing its content type', () => {
    for (const type of ['text/html; charset=utf-8', 'application/json', 'font/woff2']) {
      expect(appResponseHeaders(type)['content-type']).toBe(type);
    }
  });
});

// GATE-01 (2026-09-26): every validateAsset and resolveAppAsset refusal lane, and the
// response-header MIME gate.
describe('validateAsset refusal lanes (GATE-01)', () => {
  const okFs = (over = {}) => ({
    promises: {
      realpath: async (p) => p,
      stat: async () => ({ isFile: () => true, size: 10 }),
      ...over,
    },
  });
  test('a realpath failure is not-found; an escaping target is unauthorized', async () => {
    const throwing = okFs({ realpath: async () => { throw new Error('x'); } });
    expect(await validateAsset('/v/a.png', '/v', throwing, path.posix)).toEqual({ error: 'not-found' });
    const escaping = okFs({ realpath: async (p) => (p === '/v/a.png' ? '/outside/a.png' : p) });
    expect(await validateAsset('/v/a.png', '/v', escaping, path.posix)).toEqual({ error: 'unauthorized-path' });
  });
  test('a directory and an oversized file are refused', async () => {
    const dirFs = okFs({ stat: async () => ({ isFile: () => false, isDirectory: () => true, size: 5 }) });
    expect(await validateAsset('/v/a.png', '/v', dirFs, path.posix)).toEqual({ error: 'not-regular-file' });
    const bigFs = okFs({ stat: async () => ({ isFile: () => true, size: 6 * 1024 * 1024 }) });
    expect(await validateAsset('/v/a.png', '/v', bigFs, path.posix)).toEqual({ error: 'file-too-large' });
    expect(await validateAsset('/v/a.png', '/v', bigFs, path.posix, 10 * 1024 * 1024))
      .toMatchObject({ path: '/v/a.png', type: 'image/png' });
  });
  test('the root itself is not an asset', async () => {
    expect(await validateAsset('/v', '/v', okFs(), path.posix)).toEqual({ error: 'unsupported-type' });
  });
});

describe('resolveAppAsset refusal lanes (GATE-01)', () => {
  test('bad url, missing root, absolute rel, traversal, and foreign prefixes are refused', () => {
    expect(resolveAppAsset('not a url', '/app', path.posix)).toEqual({ error: 'bad-url' });
    expect(resolveAppAsset('https://ui/x.js', '/app', path.posix)).toEqual({ error: 'bad-url' });
    expect(resolveAppAsset('app://evil/src/renderer/index.html', '/app', path.posix)).toEqual({ error: 'bad-url' });
    expect(resolveAppAsset('app://ui/', '/app', path.posix)).toEqual({ error: 'bad-url' });
    expect(resolveAppAsset('app://ui/src/renderer/a.js', '', path.posix)).toEqual({ error: 'unauthorized-path' });
    expect(resolveAppAsset('app://ui//etc/passwd', '/app', path.posix)).toEqual({ error: 'unauthorized-path' });
    expect(resolveAppAsset('app://ui/../../etc/passwd', '/app', path.posix)).toEqual({ error: 'unauthorized-path' });
    expect(resolveAppAsset('app://ui/docs/README.md', '/app', path.posix)).toEqual({ error: 'unauthorized-path' });
  });
  test('with an injected fs, an unreadable or escaping realpath is refused', () => {
    const throwing = { realpathSync: () => { throw new Error('x'); } };
    expect(resolveAppAsset('app://ui/src/renderer/a.js', '/app', path.posix, throwing))
      .toEqual({ error: 'unauthorized-path' });
    const escaping = { realpathSync: (p) => (p.endsWith('a.js') ? '/elsewhere/a.js' : p) };
    expect(resolveAppAsset('app://ui/src/renderer/a.js', '/app', path.posix, escaping))
      .toEqual({ error: 'unauthorized-path' });
  });
  test('an allowed, contained asset resolves with its MIME type', () => {
    expect(resolveAppAsset('app://ui/src/renderer/index.html', '/app', path.posix))
      .toEqual({ path: '/app/src/renderer/index.html', type: 'text/html; charset=utf-8' });
    expect(resolveAppAsset('app://ui/resources/vendor/x.woff2', '/app', path.posix))
      .toEqual({ path: '/app/resources/vendor/x.woff2', type: 'font/woff2' });
  });
});

describe('appResponseHeaders MIME gate (GATE-01)', () => {
  test('only HTML responses carry frame-ancestors', () => {
    const html = appResponseHeaders('text/html; charset=utf-8');
    expect(html['content-security-policy']).toContain("frame-ancestors 'none'");
    const js = appResponseHeaders('text/javascript; charset=utf-8');
    expect(js['content-security-policy']).toBeUndefined();
    expect(js['content-type']).toBe('text/javascript; charset=utf-8');
  });
});
