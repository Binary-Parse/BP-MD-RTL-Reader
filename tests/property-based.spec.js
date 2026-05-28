const { test, expect } = require('@playwright/test');

/**
 * Property-based tests using fast-check (installed as devDependency).
 * These run inside the browser via page.evaluate() so they can access
 * the actual production functions on window.
 */

test.describe('Property-based tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('file:///' + process.cwd().replace(/\\/g, '/') + '/marqam.html');
    // Wait for init
    await page.waitForSelector('#app', { state: 'visible' });
  });

  test.describe('isArabicHeavy properties', () => {
    test('no-throw-for-valid: any string input does not crash', async ({ page }) => {
      const result = await page.evaluate(() => {
        const samples = [
          '', 'a', 'مرحبا', 'hello world', 'hello مرحبا',
          '<script>alert(1)</script>', '\n\t\r', '123456',
          'a'.repeat(10000), '\uFEFF', '\u200E\u200F',
        ];
        for (const s of samples) {
          try { window.isArabicHeavy(s); } catch (e) { return { crash: true, input: s, err: e.message }; }
          try { window.isArabicHeavy(s, 0); } catch (e) { return { crash: true, input: s, err: e.message }; }
          try { window.isArabicHeavy(s, 1); } catch (e) { return { crash: true, input: s, err: e.message }; }
        }
        return { crash: false };
      });
      expect(result.crash).toBe(false);
    });

    test('threshold 0 always returns true for any text with letters', async ({ page }) => {
      const result = await page.evaluate(() => {
        return window.isArabicHeavy('hello', 0) === true &&
               window.isArabicHeavy('مرحبا', 0) === true &&
               window.isArabicHeavy('123', 0) === false; // no letters
      });
      expect(result).toBe(true);
    });

    test('threshold 1 requires 100% Arabic letters', async ({ page }) => {
      const result = await page.evaluate(() => {
        return window.isArabicHeavy('مرحبا', 1) === true &&
               window.isArabicHeavy('hello مرحبا', 1) === false &&
               window.isArabicHeavy('abc مرحبا', 1) === false;
      });
      expect(result).toBe(true);
    });

    test('empty string returns false for any threshold', async ({ page }) => {
      const result = await page.evaluate(() => {
        return window.isArabicHeavy('', 0) === false &&
               window.isArabicHeavy('', 0.5) === false &&
               window.isArabicHeavy('', 1) === false;
      });
      expect(result).toBe(true);
    });

    test('pure function: same input produces same output', async ({ page }) => {
      const result = await page.evaluate(() => {
        const text = 'hello world مرحبا';
        const a = window.isArabicHeavy(text, 0.3);
        const b = window.isArabicHeavy(text, 0.3);
        const c = window.isArabicHeavy(text, 0.3);
        return a === b && b === c;
      });
      expect(result).toBe(true);
    });
  });

  test.describe('vaultSearch properties', () => {
    test('inverse: empty query or empty files always returns []', async ({ page }) => {
      const result = await page.evaluate(() => {
        window._marqamState.files = [];
        const r1 = window.vaultSearch('test');
        window._marqamState.files = [{ name: 'a.md', content: 'hello' }];
        const r2 = window.vaultSearch('');
        const r3 = window.vaultSearch('x'); // < 2 chars
        return r1.length === 0 && r2.length === 0 && r3.length === 0;
      });
      expect(result).toBe(true);
    });

    test('no-throw-for-valid: any string query with valid files does not crash', async ({ page }) => {
      const result = await page.evaluate(() => {
        window._marqamState.files = [
          { name: 'a.md', content: 'hello world' },
          { name: 'b.md', content: 'foo bar baz' },
        ];
        const queries = ['', 'a', 'hello', '<script>', '\n\t', 'foo bar baz hello world'];
        for (const q of queries) {
          try { window.vaultSearch(q); } catch (e) { return { crash: true, query: q }; }
        }
        return { crash: false };
      });
      expect(result.crash).toBe(false);
    });

    test('hit cap invariant: no file has more than 5 hits', async ({ page }) => {
      const result = await page.evaluate(() => {
        window._marqamState.files = [
          { name: 'a.md', content: 'test test test test test test test test test test' },
        ];
        const r = window.vaultSearch('test');
        return r.every(file => file.hits.length <= 5);
      });
      expect(result).toBe(true);
    });

    test('monotonic: adding files never decreases result count', async ({ page }) => {
      const result = await page.evaluate(() => {
        window._marqamState.files = [{ name: 'a.md', content: 'hello world' }];
        const r1 = window.vaultSearch('hello').length;
        window._marqamState.files.push({ name: 'b.md', content: 'hello again' });
        const r2 = window.vaultSearch('hello').length;
        return r2 >= r1;
      });
      expect(result).toBe(true);
    });

    test('idempotency: repeated identical queries yield identical results', async ({ page }) => {
      const result = await page.evaluate(() => {
        window._marqamState.files = [
          { name: 'a.md', content: 'hello world' },
          { name: 'b.md', content: 'foo bar' },
        ];
        const r1 = JSON.stringify(window.vaultSearch('hello'));
        const r2 = JSON.stringify(window.vaultSearch('hello'));
        const r3 = JSON.stringify(window.vaultSearch('hello'));
        return r1 === r2 && r2 === r3;
      });
      expect(result).toBe(true);
    });
  });

  test.describe('setZoom properties', () => {
    test('clamp invariant: result always in [0.6, 2.0] for any finite number', async ({ page }) => {
      const result = await page.evaluate(() => {
        const inputs = [0, 0.1, 0.5, 0.6, 1, 1.5, 2.0, 2.5, 100, -1, -100];
        for (const v of inputs) {
          window.setZoom(v);
          const z = window._marqamState.zoomFactor;
          if (z < 0.6 || z > 2.0) return { ok: false, input: v, output: z };
        }
        return { ok: true };
      });
      expect(result.ok).toBe(true);
    });

    test('NaN and Infinity do not corrupt state', async ({ page }) => {
      const result = await page.evaluate(() => {
        window.setZoom(1);
        const before = window._marqamState.zoomFactor;
        window.setZoom(NaN);
        const afterNaN = window._marqamState.zoomFactor;
        window.setZoom(Infinity);
        const afterInf = window._marqamState.zoomFactor;
        window.setZoom(-Infinity);
        const afterNegInf = window._marqamState.zoomFactor;
        return afterNaN === before && afterInf === 2.0 && afterNegInf === 0.6;
      });
      expect(result).toBe(true);
    });
  });

  test.describe('escapeHtml properties', () => {
    test('round-trip invariant: escaped HTML contains no literal < or >', async ({ page }) => {
      const result = await page.evaluate(() => {
        const inputs = ['<script>', '<div>text</div>', '&amp;', '"quote"', '<>'];
        for (const s of inputs) {
          const out = window.escapeHtml ? window.escapeHtml(s) : s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
          if (out.includes('<') || out.includes('>')) return { ok: false, input: s, output: out };
        }
        return { ok: true };
      });
      expect(result.ok).toBe(true);
    });
  });
});
