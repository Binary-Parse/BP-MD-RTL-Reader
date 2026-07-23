// @ts-check
const pwTest = require('@playwright/test');
const { defineConfig, devices } = pwTest;
const path = require('path');
const fs = require('fs');

// ---------------------------------------------------------------------------
// Full-suite renderer coverage collection (audit finding #11).
//
// Previously the renderer V8 coverage report reflected ONLY
// tests/e2e/coverage-collector.spec.js (~63 % stmt / ~33 % func) because that was
// the single spec wired into `test:e2e:coverage`. Every other spec imports the
// stock `test` from '@playwright/test' and never calls page.coverage, so their
// exercise of src/renderer/index.html never reached the Istanbul report.
//
// To capture the WHOLE e2e suite without editing 25+ spec files, we install an
// `auto: true` coverage fixture and graft it onto the cached '@playwright/test'
// module export. Because this config module is evaluated by every Playwright
// worker BEFORE that worker loads its spec files, the spec's
// `require('@playwright/test')` / `import { test }` resolves to the *patched*
// `test` (verified for both CJS-require and ESM-import specs). The fixture
// starts V8 coverage before the test body and writes one JSON file per test
// into coverage/renderer/, which scripts/generate-renderer-coverage.js merges.
//
// Gated behind COLLECT_RENDERER_COVERAGE so normal `test:e2e` runs are
// untouched (no per-test coverage overhead, identical behaviour).
// ---------------------------------------------------------------------------
if (process.env.COLLECT_RENDERER_COVERAGE) {
  const COVERAGE_DIR = path.join(process.cwd(), 'coverage', 'renderer');

  const patchedTest = pwTest.test.extend({
    _rendererCoverage: [async ({ page }, use, testInfo) => {
      let started = false;
      try {
        // resetOnNavigation:false keeps coverage across the spec's own
        // page.goto()/reloads so we count everything the test executes.
        await page.coverage.startJSCoverage({ resetOnNavigation: false });
        started = true;
      } catch (err) {
        // A spec that manages its own coverage (coverage-collector.spec.js)
        // will already have JSCoverage enabled — skip rather than crash.
        started = false;
      }

      await use();

      if (!started) return;
      let coverage;
      try {
        coverage = await page.coverage.stopJSCoverage();
      } catch (err) {
        return;
      }
      // Keep first-party renderer scripts (src/renderer/*.js — app.js + its ES-module imports).
      // The strict CSP externalised all JS out of index.html, so filtering on 'src/renderer/index.html'
      // captured nothing; the report script maps each entry back to its real source file.
      const entries = (coverage || []).filter(
        (e) => e && typeof e.url === 'string' && e.url.includes('/src/renderer/')
      );
      if (entries.length === 0) return;

      fs.mkdirSync(COVERAGE_DIR, { recursive: true });
      // Unique, collision-free name: worker + parallel index + sanitized title.
      const safeTitle = String(testInfo.title).replace(/[^a-z0-9]/gi, '_').slice(0, 60);
      const fileName = `e2e_w${testInfo.workerIndex}_p${testInfo.parallelIndex}_${testInfo.testId}_${safeTitle}.json`;
      fs.writeFileSync(
        path.join(COVERAGE_DIR, fileName),
        JSON.stringify(entries)
      );
    }, { auto: true }],
  });

  // Replace the export on the cached module object so later requires/imports
  // (i.e. the spec files) receive the coverage-instrumented `test`.
  Object.defineProperty(pwTest, 'test', {
    value: patchedTest,
    configurable: true,
    writable: true,
  });
}

module.exports = defineConfig({
  testDir: './tests/e2e',
  // Browser and integration specs share this tree; the real-Electron lane is
  // isolated below so it runs only through playwright.electron.config.js.

  testIgnore: ['**/electron/**'],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',

  expect: {
    toHaveScreenshot: {
      // 5000 px out of ~1.3M (1440×900) ≈ 0.4 % tolerance — absorbs
      // sub-pixel font-hinting noise between CI runners / local dev
      // (observed CI diffs: 2790–4641 px = 0.21–0.36 %). A real layout
      // shift moves tens of thousands of pixels, so this is still tight.
      maxDiffPixels: 5000,
      threshold: 0.2
    }
  },

  use: {
    viewport: { width: 1440, height: 900 },
    headless: true,
    launchOptions: {
      args: ['--allow-file-access-from-files']
    }
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ]
});
