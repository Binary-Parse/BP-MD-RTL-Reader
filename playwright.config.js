// @ts-check
const { defineConfig, devices } = require('@playwright/test');
const path = require('path');

module.exports = defineConfig({
  testDir: './tests',
  testIgnore: ['**/unit/**', '**/integration/**'],
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
