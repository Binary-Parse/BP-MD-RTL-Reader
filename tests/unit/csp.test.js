/**
 * csp.test.js — T-B4 strict Content-Security-Policy, static assertions on index.html.
 * The XSS-relevant lock is script-src 'self' with NO 'unsafe-inline'/'unsafe-eval', which
 * requires that index.html contain no inline script (theme-boot + app module externalized).
 */
import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { appResponseHeaders } from '../../src/main/protocol.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8');

function cspContent() {
  const m = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/);
  return m ? m[1] : null;
}

describe('strict CSP (T-B4)', () => {
  test('a CSP meta is declared', () => {
    expect(cspContent()).toBeTruthy();
  });

  test('script-src is self-only — no unsafe-inline / unsafe-eval (the XSS lock)', () => {
    const csp = cspContent();
    const scriptSrc = csp.match(/script-src ([^;]+)/)[1];
    expect(scriptSrc).toContain("'self'");
    expect(scriptSrc).not.toContain('unsafe-inline');
    expect(scriptSrc).not.toContain('unsafe-eval');
    expect(scriptSrc).not.toMatch(/https?:/); // no remote scripts
  });

  test('default-src and object-src are locked down', () => {
    const csp = cspContent();
    expect(csp).toMatch(/default-src 'self'/);
    expect(csp).toMatch(/object-src 'none'/);
    expect(csp).toMatch(/base-uri 'self'/);
  });

  test('frame-ancestors is NOT declared here — it is served as an app:// response header', () => {
    // W3C CSP3 §3.3: "Neither are the report-uri, frame-ancestors, and sandbox
    // directives." Declaring it in <meta> does nothing except make Chromium log
    // "The Content Security Policy directive 'frame-ancestors' is ignored when
    // delivered via a <meta> element." The real policy now rides on the app://
    // document response — see appResponseHeaders in src/main/protocol.js.
    expect(cspContent()).not.toMatch(/frame-ancestors/);
    expect(appResponseHeaders('text/html; charset=utf-8')['content-security-policy'])
      .toBe("frame-ancestors 'none'");
  });

  test("style-src KEEPS 'unsafe-inline' (KaTeX math emits inline style= — load-bearing concession)", () => {
    // Pin the deliberate concession: dropping it would silently break rendered math.
    const styleSrc = cspContent().match(/style-src ([^;]+)/)[1];
    expect(styleSrc).toContain("'unsafe-inline'");
    expect(styleSrc).not.toMatch(/https?:/); // …but never a REMOTE stylesheet host
  });

  test('img-src allows local, data, and bpmd — not file:', () => {
    const imgSrc = cspContent().match(/img-src ([^;]+)/)[1];
    expect(imgSrc).toContain('bpmd:');
    expect(imgSrc).toContain('data:');
    expect(imgSrc).not.toMatch(/\bfile:/);
  });

  test('no network-fetching directive permits remote http(s) (local-first / SC2)', () => {
    const csp = cspContent();
    for (const dir of ['img-src', 'font-src', 'connect-src', 'default-src']) {
      const m = csp.match(new RegExp(`${dir} ([^;]+)`));
      if (m) expect(m[1], `${dir} must not allow remote`).not.toMatch(/https?:/);
    }
  });

  test('index.html contains NO inline <script> (every script is externalized via src=)', () => {
    // A <script> without a src= attribute that has a non-empty body would be inline → blocked.
    const inline = html.match(/<script\b(?![^>]*\bsrc=)[^>]*>\s*\S[\s\S]*?<\/script>/);
    expect(inline, `inline script found: ${inline && inline[0].slice(0, 80)}`).toBeNull();
  });

  test('require-trusted-types-for script is declared', () => {
    expect(cspContent()).toMatch(/require-trusted-types-for 'script'/);
  });

  test('trusted-types boot module exists on disk', () => {
    expect(html).toMatch(/<script type="module" src="trusted-types-boot\.js"><\/script>/);
    expect(existsSync(path.join(root, 'src/renderer/trusted-types-boot.js'))).toBe(true);
  });

  test('the externalized scripts exist on disk (theme-boot + app module)', () => {
    expect(html).toMatch(/<script src="theme-boot\.js"><\/script>/);
    expect(html).toMatch(/<script type="module" src="app\.js"><\/script>/);
    expect(existsSync(path.join(root, 'src/renderer/theme-boot.js'))).toBe(true);
    expect(existsSync(path.join(root, 'src/renderer/app.js'))).toBe(true);
  });
});
