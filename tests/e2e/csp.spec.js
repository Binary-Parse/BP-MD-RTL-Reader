// @ts-check
/**
 * csp.spec.js — T-B4: the strict CSP is actually ENFORCED at runtime (an injected inline
 * script does not execute) AND the app + vendored libs + math/mermaid still work under it.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_PATH = path.resolve(__dirname, '../../src/renderer/index.html');
const INDEX_URL = `file:///${INDEX_PATH.replace(/\\/g, '/')}`;

test.describe('[T-B4] strict CSP', () => {
  test('app + all vendored libs load under script-src self (no CSP violations on boot)', async ({ page }) => {
    const violations = [];
    page.on('console', (m) => { if (/content security policy/i.test(m.text())) violations.push(m.text()); });
    page.on('pageerror', (e) => { if (/content security policy/i.test(String(e))) violations.push(String(e)); });

    await page.goto(INDEX_URL);
    await page.waitForSelector('#app', { state: 'visible' });

    const libs = await page.evaluate(() => ({
      app: typeof window.parseMarkdown,
      marked: typeof window.marked,
      dompurify: typeof window.DOMPurify,
      katex: typeof window.katex,
      hljs: typeof window.hljs,
    }));
    expect(libs.app).toBe('function');     // the externalized app module ran
    expect(libs.marked).not.toBe('undefined');
    expect(libs.dompurify).not.toBe('undefined');
    expect(libs.katex).toBe('object');
    expect(libs.hljs).toBe('object');
    expect(violations, `CSP violations on boot: ${violations.join(' | ')}`).toEqual([]);
  });

  test('inline script injection is refused before script-src is even consulted', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app');
    const result = await page.evaluate(() => new Promise((resolve) => {
      window.__cspProbe = false;
      let refusal = null;
      const s = document.createElement('script');
      // `require-trusted-types-for 'script'` makes .textContent / .text / appendChild(Text)
      // ALL Trusted-Types sinks on <script> — WPT's own regression suite
      // (trusted-types/block-text-node-insertion-into-script-element.html) expects every
      // one of those routes to be blocked. Our 'default' policy implements createHTML and
      // createScriptURL but deliberately NOT createScript, so the assignment throws here
      // and script-src 'self' never gets a chance to run. That is strictly stronger than
      // a CSP violation, so the throw IS the assertion.
      try { s.textContent = 'window.__cspProbe = true;'; }
      catch (e) { refusal = String(e && e.message); }
      document.head.appendChild(s);
      setTimeout(() => resolve({ executed: window.__cspProbe, refusal }), 60);
    }));
    expect(result.executed).toBe(false);
    expect(result.refusal).toMatch(/TrustedScript/);
  });

  test('CSP refuses REMOTE script, img and fetch (the SC2 0-network lock)', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app');
    const result = await page.evaluate(async () => {
      const violations = [];
      document.addEventListener('securitypolicyviolation', (e) => violations.push(e.violatedDirective));
      window.__remoteScript = false;
      // Remote <script>. The app's own 'default' createScriptURL
      // (trusted-types-policy.js) rejects any non-vendor URL by THROWING, which happens
      // before script-src can emit a securitypolicyviolation event — so the refusal, not
      // the violation, is what proves the lock held.
      let ttRefusedScript = false;
      const s = document.createElement('script');
      try { s.src = 'https://example.invalid/x.js'; document.head.appendChild(s); }
      catch (_) { ttRefusedScript = true; }
      // Remote <img> — must be refused by img-src (no http(s)).
      const img = document.createElement('img');
      img.src = 'https://example.invalid/beacon.gif';
      document.body.appendChild(img);
      // Remote fetch — must be refused by connect-src 'self'.
      let fetchRejected = false;
      try { await fetch('https://example.invalid/x'); } catch (_) { fetchRejected = true; }
      await new Promise((r) => setTimeout(r, 150));
      return { violations, ttRefusedScript, remoteScriptRan: window.__remoteScript, fetchRejected };
    });
    expect(result.remoteScriptRan).toBe(false);
    expect(result.ttRefusedScript).toBe(true);
    expect(result.violations.some((d) => /img-src/.test(d))).toBe(true);
    expect(result.violations.some((d) => /connect-src/.test(d))).toBe(true);
    expect(result.fetchRejected).toBe(true);
  });

  test('math (KaTeX inline styles) + mermaid render under the strict CSP', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app');
    await page.evaluate(() => {
      window._appState.files = [{ name: 'c.md', path: 'c.md', content: '$x^2+1$\n\n```mermaid\ngraph TD; A-->B\n```\n', dirty: false }];
      window.renderFile(0);
    });
    // style-src keeps 'unsafe-inline' precisely so KaTeX's inline-styled math is not blocked.
    await expect(page.locator('#noteContent .math-inline .katex')).toHaveCount(1);
    await expect(page.locator('#noteContent .mermaid svg')).toHaveCount(1, { timeout: 15000 });
  });
});
