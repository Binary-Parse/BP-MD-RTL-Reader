#!/usr/bin/env node
'use strict';
/**
 * v1.2: `playwright install chromium` used to run on EVERY `npm install` — even for
 * someone who only wants the unit tests and will never run the browser e2e lane
 * (a ~120 MB download per machine). Now the default install is light:
 *   - CI keeps its opt-out via PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD (and installs the
 *     browser itself in the e2e job);
 *   - humans/CI fetch the browser explicitly via `npm run browser:install`.
 */
const { spawnSync } = require('node:child_process');

if (process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD === '1' || process.env.CI) {
  process.exit(0);
}

const result = spawnSync('npx', ['playwright', 'install', 'chromium'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
process.exit(result.status == null ? 1 : result.status);
