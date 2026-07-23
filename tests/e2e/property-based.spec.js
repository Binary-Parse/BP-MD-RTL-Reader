const { test, expect } = require('@playwright/test');
const fc = require('fast-check');

test.describe('Property-based renderer contracts', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('file:///' + process.cwd().replace(/\\/g, '/') + '/index.html');
    await page.locator('#app').waitFor({ state: 'visible' });
    await expect.poll(() => page.evaluate(() => ({
      arabic: typeof window.isArabicHeavy,
      escape: typeof window.escapeHtml,
      zoom: typeof window.setZoom,
    }))).toEqual({ arabic: 'function', escape: 'function', zoom: 'function' });
  });

  test('isArabicHeavy never throws and always returns a boolean for generated strings and thresholds', async ({ page }) => {
    await fc.assert(fc.asyncProperty(
      fc.array(fc.string({ maxLength: 200 }), { minLength: 1, maxLength: 30 }),
      fc.array(fc.double({ noNaN: true }), { minLength: 1, maxLength: 10 }),
      async (samples, thresholds) => {
        const result = await page.evaluate(({ samples: values, thresholds: limits }) => {
          for (const value of values) {
            for (const threshold of limits) {
              const output = window.isArabicHeavy(value, threshold);
              if (typeof output !== 'boolean') return { value, threshold, output };
            }
          }
          return null;
        }, { samples, thresholds });
        if (result) throw new Error('Non-boolean isArabicHeavy result: ' + JSON.stringify(result));
      },
    ), { numRuns: 30 });
  });

  test('production escapeHtml removes every literal HTML delimiter from generated input', async ({ page }) => {
    await fc.assert(fc.asyncProperty(
      fc.array(fc.string({ maxLength: 300 }), { minLength: 1, maxLength: 40 }),
      async (samples) => {
        const failure = await page.evaluate((values) => {
          for (const value of values) {
            const output = window.escapeHtml(value);
            if (/[<>"]/.test(output)) return { value, output };
          }
          return null;
        }, samples);
        if (failure) throw new Error('Unescaped production output: ' + JSON.stringify(failure));
      },
    ), { numRuns: 30 });
  });

  test('setZoom clamps every generated numeric input to the documented interval', async ({ page }) => {
    await fc.assert(fc.asyncProperty(
      fc.array(fc.double({ noNaN: true }), { minLength: 1, maxLength: 40 }),
      async (values) => {
        const failure = await page.evaluate((inputs) => {
          for (const input of inputs) {
            window.setZoom(input);
            const actual = window._appState.zoomFactor;
            const expected = Math.max(0.6, Math.min(2, input));
            if (actual !== expected) return { input, actual, expected };
          }
          return null;
        }, values);
        if (failure) throw new Error('Zoom clamp mismatch: ' + JSON.stringify(failure));
      },
    ), { numRuns: 30 });
  });
});
