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
      maxDiffPixels: 100,
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
