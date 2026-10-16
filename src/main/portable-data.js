'use strict';

/**
 * portable-data.js — D12: the portable Windows build keeps its data beside the .exe.
 *
 * electron-builder's portable stub sets PORTABLE_EXECUTABLE_DIR to the folder the .exe sits in;
 * the installer build, a dev run and Linux leave it unset and keep the usual userData folder.
 *
 * The first portable run COPIES the user's data from the usual folder once — never moves it,
 * because an installed copy of the app may share that folder — and writes a marker so the copy
 * never repeats. Nothing here may stop the app from starting: a folder that cannot be written
 * (a read-only stick, a protected directory) keeps the usual folder and logs why.
 */

const DATA_DIR_NAME = 'BP-MD-RTL-Reader-data';
const MIGRATED_MARKER = '.migrated-from-appdata';
// What the app itself stores. Chromium's caches are left behind; "Local Storage" holds the
// folder-tree collapse state and the pre-paint theme mirror.
const MIGRATED_ENTRIES = [
  'settings.json', 'capabilities.json', 'annotations.json', 'reading-stats.json',
  'recovery', 'logs', 'Local Storage',
];

/** The portable data folder, or null when this is not the portable Windows build. Windows paths. */
function resolvePortableDataDir({ env = process.env, platform = process.platform } = {}) {
  const path = require('path').win32;
  const exeDir = env && env.PORTABLE_EXECUTABLE_DIR;
  if (platform !== 'win32' || typeof exeDir !== 'string' || !path.isAbsolute(exeDir)) return null;
  return path.join(exeDir, DATA_DIR_NAME);
}

/** Creates `dir` and proves a file can be written there. */
function probeWritable(fs, path, dir) {
  const probe = path.join(dir, `.write-probe-${process.pid}`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(probe, '');
    fs.unlinkSync(probe);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Copies the allowlisted entries of `fromDir` into `toDir` once. An entry already in `toDir`
 * is kept. Returns the names copied; a failed entry is skipped, not fatal.
 */
function migrateFromAppData({ fs, path, fromDir, toDir, log = () => {} }) {
  const marker = path.join(toDir, MIGRATED_MARKER);
  if (!fromDir || fromDir === toDir || fs.existsSync(marker)) return [];
  const copied = [];
  for (const name of MIGRATED_ENTRIES) {
    const from = path.join(fromDir, name);
    const to = path.join(toDir, name);
    try {
      if (!fs.existsSync(from) || fs.existsSync(to)) continue;
      fs.cpSync(from, to, { recursive: true, errorOnExist: false, force: false });
      copied.push(name);
    } catch (err) {
      log(`portable data: could not copy ${name}: ${err && err.message}`);
    }
  }
  try { fs.writeFileSync(marker, `${JSON.stringify({ from: fromDir, copied })}\n`); } catch (_) { /* next run copies again; kept entries are skipped */ }
  return copied;
}

/**
 * Points Electron's userData at the portable folder. Call it before anything reads userData
 * (crashReporter, the stores, the log). Returns the folder in use, or null when unchanged.
 */
function applyPortableDataDir({ app, fs, env, platform, path = require('path'), log = () => {} }) {
  const dir = resolvePortableDataDir({ env, platform });
  if (!dir) return null;
  if (!probeWritable(fs, path, dir)) {
    log(`portable data: ${dir} is not writable; using the usual userData folder`);
    return null;
  }
  migrateFromAppData({ fs, path, fromDir: app.getPath('userData'), toDir: dir, log });
  app.setPath('userData', dir);
  return dir;
}

module.exports = { DATA_DIR_NAME, MIGRATED_ENTRIES, MIGRATED_MARKER, resolvePortableDataDir, migrateFromAppData, applyPortableDataDir };
