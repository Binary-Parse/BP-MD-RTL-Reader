// @ts-check
const { defineConfig } = require('@playwright/test');

// QA-L2: the app exposes its window.* test hooks only to a test run; electron.launch()
// passes this environment on to the app it starts.
process.env.BPMD_TEST = '1';

module.exports = defineConfig({
  testDir: './tests/e2e/electron',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  timeout: 30_000,
});
