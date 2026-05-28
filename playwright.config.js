// @ts-check
const { defineConfig, devices } = require('@playwright/test');
const path = require('path');

module.exports = defineConfig({
  testDir: './tests',
  // Only Vitest unit tests are excluded — Playwright integration tests
  // (tests/integration/*.test.js) target marqam.html via file:// like the
  // rest of the E2E sweep, so they belong in test:e2e.
  testIgnore: ['**/unit/**'],
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
