/**
 * main-update-check.test.js — T-Q6 opt-in `update:check` IPC handler. Privacy-preserving:
 * only an explicit user action triggers it; it sends no identifiers and never auto-downloads.
 * Drives the real bootstrap with an injected fetch.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { bootstrap } from '../../main.js';
import { buildMockElectron, buildMockFs, buildMockProc } from './main-harness.js';

const getHandle = (electron, name) => electron.ipcMain.handle.mock.calls.find((c) => c[0] === name)?.[1];
const okJson = (body) => ({ ok: true, json: () => Promise.resolve(body) });

function boot(fetchFn) {
  const electron = buildMockElectron();
  electron.app.getVersion.mockReturnValue('1.0.0');
  bootstrap({ electron, fs: buildMockFs(), proc: buildMockProc(['node', 'main.js']), fetchFn });
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

  test('no fetch available → { error: "unsupported" } (no crash)', async () => {
    await setup(null); // null is NOT replaced by the destructuring default (only undefined is)
    expect(await handler()).toEqual({ error: 'unsupported', current: '1.0.0' });
  });
});
