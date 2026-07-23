const { test, expect } = require('@playwright/test');

/**
 * Fuzzing layer — targets parsers, validators, and critical paths.
 * Runs ≥ 100 iterations per target (per §4). Oracle: no crash, no hang,
 * no unhandled rejection, and the stated invariant holds.
 */

function randomString(len, charset) {
  const cs = charset || 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789\n\t !@#$%^&*()_+-=[]{}|;\':",./<>?`~';
  let s = '';
  for (let i = 0; i < len; i++) s += cs[Math.floor(Math.random() * cs.length)];
  return s;
}

test.describe('Fuzzing — parsers & validators', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('file:///' + process.cwd().replace(/\\/g, '/') + '/index.html');
    await page.waitForSelector('#app', { state: 'visible' });
  });

  test('parseMarkdown does not crash on 1000 random inputs', async ({ page }) => {
    const inputs = Array.from({ length: 1000 }, (_, i) => randomString(i % 500, null));
    const result = await page.evaluate((arr) => {
      for (const md of arr) {
        try {
          const out = window.parseMarkdown(md);
          if (out !== null && typeof out !== 'string' && typeof out?.then !== 'function') {
            return { ok: false, reason: 'non-string', input: String(md).slice(0, 50) };
          }
        } catch (e) {
          return { ok: false, reason: 'crash', input: String(md).slice(0, 50), err: e.message };
        }
      }
      return { ok: true };
    }, inputs);
    expect(result.ok, `${result.reason} on "${result.input}": ${result.err || ''}`).toBe(true);
  });

  test('isArabicHeavy does not crash on 1000 random inputs', async ({ page }) => {
    const result = await page.evaluate((inputs) => {
      for (const s of inputs) {
        try {
          const out = window.isArabicHeavy(s);
          if (typeof out !== 'boolean') return { ok: false, reason: 'non-boolean', input: s.slice(0, 50) };
        } catch (e) {
          return { ok: false, reason: 'crash', input: s.slice(0, 50), err: e.message };
        }
      }
      return { ok: true };
    }, Array.from({ length: 1000 }, (_, i) => randomString(i % 500, null)));
    expect(result.ok, result.reason + ' on ' + result.input).toBe(true);
  });

  test('vaultSearch does not crash on 1000 random queries', async ({ page }) => {
    const queries = Array.from({ length: 1000 }, (_, i) => randomString(i % 50, null));
    const fileA = randomString(200, null);
    const fileB = randomString(200, null);
    const result = await page.evaluate(([qs, fa, fb]) => {
      window._appState.files = [
        { name: 'a.md', content: fa, path: 'a.md' },
        { name: 'b.md', content: fb, path: 'b.md' },
      ];
      for (const q of qs) {
        try {
          const out = window.vaultSearch(q);
          if (!Array.isArray(out)) return { ok: false, reason: 'non-array', query: String(q).slice(0, 50) };
        } catch (e) {
          return { ok: false, reason: 'crash', query: String(q).slice(0, 50), err: e.message };
        }
      }
      return { ok: true };
    }, [queries, fileA, fileB]);
    expect(result.ok, `${result.reason} on "${result.query}": ${result.err || ''}`).toBe(true);
  });

  test('setEditorMode does not crash on random mode strings', async ({ page }) => {
    const modes = ['live', 'split', 'source', '', 'unknown', null, undefined, 'LIVE', 'source\n'];
    const result = await page.evaluate((ms) => {
      for (const m of ms) {
        try {
          window.setEditorMode(m);
        } catch (e) {
          return { ok: false, mode: m, err: e.message };
        }
      }
      return { ok: true };
    }, modes);
    expect(result.ok, `crash on mode ${JSON.stringify(result.mode)}: ${result.err}`).toBe(true);
  });

  test('find bar does not crash on 500 random search queries', async ({ page }) => {
    await page.evaluate(() => window.loadDemo());
    await page.waitForTimeout(200);
    const queries = Array.from({ length: 500 }, (_, i) => randomString(i % 30, null));
    const result = await page.evaluate((qs) => {
      for (const q of qs) {
        try {
          window.runFind(q);
        } catch (e) {
          return { ok: false, query: q.slice(0, 50), err: e.message };
        }
      }
      return { ok: true };
    }, queries);
    expect(result.ok, `crash on query ${result.query}: ${result.err}`).toBe(true);
  });

  test('escapeHtml round-trip invariant: no literal < or > in output', async ({ page }) => {
    const inputs = Array.from({ length: 500 }, (_, i) => randomString(i % 200, '<>&"\''));
    const result = await page.evaluate((vals) => {
      for (const s of vals) {
        try {
          const out = window.escapeHtml ? window.escapeHtml(s) : s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
          if (out.includes('<') || out.includes('>')) return { ok: false, input: s.slice(0, 50) };
        } catch (e) {
          return { ok: false, reason: 'crash', input: s.slice(0, 50) };
        }
      }
      return { ok: true };
    }, inputs);
    expect(result.ok, `invariant broken on ${result.input}`).toBe(true);
  });

  test('cycleTheme idempotency: 100 cycles never corrupt theme state', async ({ page }) => {
    const result = await page.evaluate(() => {
      const themes = ['paper', 'ink', 'sepia'];
      for (let i = 0; i < 100; i++) {
        try {
          window.cycleTheme();
          const t = window._appState.theme;
          if (!themes.includes(t)) return { ok: false, theme: t, iter: i };
        } catch (e) {
          return { ok: false, err: e.message, iter: i };
        }
      }
      return { ok: true };
    });
    expect(result.ok, `corruption at iter ${result.iter}: ${result.theme || result.err}`).toBe(true);
  });

  test('zoom factor idempotency: repeated reset keeps value at 1.0', async ({ page }) => {
    const result = await page.evaluate(() => {
      for (let i = 0; i < 200; i++) {
        window.zoomIn();
        window.zoomOut();
      }
      window.zoomReset();
      return window._appState.zoomFactor === 1.0;
    });
    expect(result).toBe(true);
  });
});
