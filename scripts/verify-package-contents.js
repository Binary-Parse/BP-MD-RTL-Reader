'use strict';

const fs = require('fs');
const path = require('path');
const asar = require('@electron/asar');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const REQUIRED = [
  'LICENSE',
  'THIRD-PARTY-NOTICES.md',
  'assets/vendor/THIRD-PARTY-LICENSES.txt',
  'assets/vendor/vendor-manifest.json',
  'assets/vendor/fonts/LICENSES.md',
  'assets/vendor/fonts/OFL-1.1.txt',
];
const FORBIDDEN_PREFIXES = ['.git/', 'coverage/', 'reports/', 'tests/', 'AUDIT_REPORT.md'];

function walk(directory, name) {
  if (!fs.existsSync(directory)) return [];
  const found = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...walk(full, name));
    else if (entry.name === name) found.push(full);
  }
  return found;
}

function normalizeEntries(entries) {
  return entries.map(entry => entry.replace(/^[/\\]+/, '').replaceAll('\\', '/'));
}

function verifyPackageEntries(entries) {
  const normalized = normalizeEntries(entries);
  const files = new Set(normalized);
  const failures = [];
  for (const required of REQUIRED) {
    if (!files.has(required)) failures.push('missing ' + required);
  }
  for (const file of normalized) {
    if (FORBIDDEN_PREFIXES.some(prefix => file === prefix || file.startsWith(prefix))) {
      failures.push('forbidden packaged path ' + file);
    }
  }
  return failures;
}

function main() {
  const archives = walk(DIST, 'app.asar');
  if (archives.length === 0) throw new Error('No packaged app.asar found under ' + DIST);
  const failures = [];
  for (const archive of archives) {
    const archiveFailures = verifyPackageEntries(asar.listPackage(archive));
    if (archiveFailures.length) {
      failures.push(path.relative(ROOT, archive) + ': ' + archiveFailures.join(', '));
    } else {
      console.log('Verified package contents: ' + path.relative(ROOT, archive));
    }
  }
  if (failures.length) throw new Error('Package-content verification failed:\n - ' + failures.join('\n - '));
  console.log('Verified ' + archives.length + ' packaged application archive(s).');
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { REQUIRED, FORBIDDEN_PREFIXES, normalizeEntries, verifyPackageEntries, walk };
