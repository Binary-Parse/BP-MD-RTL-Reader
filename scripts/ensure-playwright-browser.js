#!/usr/bin/env node
'use strict';
/**
 * v1.2: `playwright install chromium` used to run on EVERY `npm install` — even for
 * someone who only wants the unit tests and will never run the browser e2e lane
 * (a ~120 MB download per machine). Now the default install is light:
 *   - CI keeps its opt-out via PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD (and installs the
 *     browser itself in the e2e job);
 *   - humans/CI fetch the browser explicitly via `npm run browser:install`.
 *
 * Only the pinned local devDependency's own CLI is executed — never `npx`, which
 * would resolve the LATEST playwright from the registry and run it inside a
 * package lifecycle hook. An install without devDependencies simply skips.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

if (process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD === '1' || process.env.CI) {
  process.exit(0);
}

const localCli = path.join(__dirname, '..', 'node_modules', 'playwright', 'cli.js');
if (!fs.existsSync(localCli)) process.exit(0);

const result = spawnSync(process.execPath, [localCli, 'install', 'chromium'], {
  stdio: 'inherit',
});
process.exit(result.status == null ? 1 : result.status);
