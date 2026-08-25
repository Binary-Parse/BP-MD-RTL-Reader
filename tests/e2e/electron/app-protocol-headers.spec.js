/**
 * app-protocol-headers.spec.js — the app:// response headers, asserted against the real
 * protocol.handle in a live main process.
 *
 * Why this lane and not tests/e2e: every browser spec loads the renderer as
 * file:///…/src/renderer/index.html, so no response header exists there at all. Only a
 * real Electron app goes through registerAppProtocol, which means this is the only place
 * the framing policy can actually be observed.
 *
 * W3C CSP3 §3.3 excludes frame-ancestors from <meta> delivery, so it is served here
 * instead — and only on the HTML document, never on vendor scripts, styles or fonts.
 */
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

test.describe('app:// response headers @electron', () => {
  let electronApp;
  let page;
  let tempRoot;

  test.beforeEach(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bpmd-app-headers-'));
    const profile = path.join(tempRoot, 'profile');
    fs.mkdirSync(profile);
    electronApp = await electron.launch({
      args: ['--user-data-dir=' + profile, ROOT],
      env: {
        ...process.env,
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
        ELECTRON_ENABLE_LOGGING: '0',
      },
    });
    page = await electronApp.firstWindow();
    await page.locator('#app').waitFor({ state: 'visible' });
  });

  test.afterEach(async () => {
    if (electronApp) {
      if (page && !page.isClosed()) {
        await page.evaluate(() => window.electronAPI.closeWindow());
      }
      await electronApp.close();
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('the renderer document is served with frame-ancestors as a real header', async () => {
    const res = await electronApp.evaluate(async ({ net }) =>
      net.fetch('app://ui/src/renderer/index.html').then((r) => ({
        status: r.status,
        csp: r.headers.get('content-security-policy'),
        type: r.headers.get('content-type'),
      })));
    expect(res.status).toBe(200);
    expect(res.type).toBe('text/html; charset=utf-8');
    expect(res.csp).toBe("frame-ancestors 'none'");
  });

  test('no non-HTML asset carries a policy header', async () => {
    const headers = await electronApp.evaluate(async ({ net }) =>
      Promise.all([
        'app://ui/src/renderer/app.js',
        'app://ui/src/renderer/styles/base.css',
      ].map((url) => net.fetch(url).then((r) => ({
        url,
        status: r.status,
        csp: r.headers.get('content-security-policy'),
        type: r.headers.get('content-type'),
      })))));
    for (const h of headers) {
      expect(h.status, h.url).toBe(200);
      expect(h.csp, h.url).toBeNull();
    }
    expect(headers[0].type).toBe('text/javascript; charset=utf-8');
    expect(headers[1].type).toBe('text/css; charset=utf-8');
  });

  test('the loaded window really is the app:// document, not file://', async () => {
    // Guards the premise: if the window ever fell back to file://, the header above
    // would still pass while protecting nothing the user actually sees.
    expect(await page.evaluate(() => location.origin)).toBe('app://ui');
  });
});
