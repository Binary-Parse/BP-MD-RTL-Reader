/**
 * main-update-check.test.js — T-Q6 opt-in `update:check` IPC handler. Privacy-preserving:
 * only an explicit user action triggers it; it sends no identifiers and never auto-downloads.
 * Drives the real bootstrap with an injected fetch.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { bootstrap } from '../../src/main/index.js';
import { buildMockElectron, buildMockFs, buildMockProc } from './main-harness.js';

const getHandle = (electron, name) => electron.ipcMain.handle.mock.calls.find((c) => c[0] === name)?.[1];
const okJson = (body) => ({ ok: true, json: () => Promise.resolve(body) });

function boot(fetchFn) {
  const electron = buildMockElectron();
  electron.app.getVersion.mockReturnValue('1.0.0');
  bootstrap({ electron, fs: buildMockFs(), proc: buildMockProc(['node', 'src/main/index.js']), fetchFn });
  return electron;
}

describe('update:check (T-Q6)', () => {
  let electron, handler;
  async function setup(fetchFn) {
    electron = boot(fetchFn);
    await new Promise((r) => setTimeout(r, 50)); // handlers register inside whenReady()
    handler = getHandle(electron, 'update:check');
  }

  test('the handler is registered', async () => {
    await setup(vi.fn());
    expect(typeof handler).toBe('function');
  });

  test('a newer release → { updateAvailable: true } with the release url', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(okJson({ tag_name: 'v1.2.0', html_url: 'https://x/releases/1.2.0' })));
    await setup(fetchFn);
    const r = await handler();
    expect(r).toEqual({ current: '1.0.0', latest: '1.2.0', updateAvailable: true, url: 'https://x/releases/1.2.0' });
    // privacy: a single GET, no body/identifiers — just an Accept + UA header.
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [, opts] = fetchFn.mock.calls[0];
    expect(opts.body).toBeUndefined();
  });

  test('same/older release → { updateAvailable: false }', async () => {
    await setup(vi.fn(() => Promise.resolve(okJson({ tag_name: 'v1.0.0' }))));
    expect((await handler()).updateAvailable).toBe(false);
    await setup(vi.fn(() => Promise.resolve(okJson({ tag_name: '0.9.0' }))));
    expect((await handler()).updateAvailable).toBe(false);
  });

  test('network failure → { error: "network" } (never throws to the renderer)', async () => {
    await setup(vi.fn(() => Promise.reject(new Error('offline'))));
    expect(await handler()).toEqual({ error: 'network', current: '1.0.0' });
  });

  test('non-ok HTTP → { error: "http" }', async () => {
    await setup(vi.fn(() => Promise.resolve({ ok: false, status: 503 })));
    expect(await handler()).toEqual({ error: 'http', current: '1.0.0' });
  });

  test('malformed body / no version → typed errors', async () => {
    await setup(vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.reject(new Error('bad json')) })));
    expect((await handler()).error).toBe('parse');
    await setup(vi.fn(() => Promise.resolve(okJson({}))));
    expect((await handler()).error).toBe('no-version');
  });

  test('malformed release version → typed invalid-version error', async () => {
    await setup(vi.fn(() => Promise.resolve(okJson({ tag_name: 'release-latest' }))));
    expect(await handler()).toEqual({ error: 'invalid-version', current: '1.0.0' });
  });

  test('no fetch available → { error: "unsupported" } (no crash)', async () => {
    await setup(null); // null is NOT replaced by the destructuring default (only undefined is)
    expect(await handler()).toEqual({ error: 'unsupported', current: '1.0.0' });
  });

  // L23 + L369: the exact GitHub releases URL + the precise request headers.
  test('GETs the exact releases manifest URL with Accept + User-Agent headers', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(okJson({ tag_name: 'v1.0.0' })));
    await setup(fetchFn);
    await handler();
    const [url, opts] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/Binary-Parse/BP-MD-RTL-Reader/releases/latest');
    expect(opts.headers).toEqual({ Accept: 'application/vnd.github+json', 'User-Agent': 'BP-MD-RTL-Reader' });
  });

  // L376: `.replace(/^v/i, '')` strips ONLY a LEADING v. A tag whose FIRST 'v' is
  // NOT at position 0 must be left untouched — kills the `/^v/i` → `/v/i` mutant,
  // which (un-anchored) would strip that interior 'v'.
  test('a tag with NO leading v but an interior v is left untouched (anchor required)', async () => {
    await setup(vi.fn(() => Promise.resolve(okJson({ tag_name: '2.0.0-rev1' }))));
    // `/^v/i`: no leading v → unchanged '2.0.0-rev1'. `/v/i`: would strip the v in "rev".
    expect((await handler()).latest).toBe('2.0.0-rev1');
  });
  // Plus the common leading-v case still works.
  test('a leading v IS stripped', async () => {
    await setup(vi.fn(() => Promise.resolve(okJson({ tag_name: 'v3.1.0' }))));
    expect((await handler()).latest).toBe('3.1.0');
  });

  // L378: `(data && data.html_url) || ''` — a release with NO html_url yields url:''.
  test('release with no html_url → url is the empty string (not undefined)', async () => {
    await setup(vi.fn(() => Promise.resolve(okJson({ tag_name: 'v2.0.0' }))));
    const r = await handler();
    expect(r.updateAvailable).toBe(true);
    expect(r.url).toBe('');
  });

  // L378: compareVersions(...) > 0 — an EQUAL version is not "available" (boundary).
  test('exactly-equal version → updateAvailable:false (kills the > 0 boundary mutant)', async () => {
    await setup(vi.fn(() => Promise.resolve(okJson({ tag_name: 'v1.0.0', html_url: 'https://x' }))));
    const r = await handler();
    expect(r.updateAvailable).toBe(false);
    expect(r.url).toBe('https://x');
  });
});
