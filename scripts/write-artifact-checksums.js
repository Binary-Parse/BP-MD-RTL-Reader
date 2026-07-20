'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const RELEASE_EXTENSIONS = ['.exe', '.dmg', '.zip', '.appimage', '.deb'];

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function main() {
  const artifacts = walk(DIST)
    .filter(file => RELEASE_EXTENSIONS.includes(path.extname(file).toLowerCase()))
    .sort();
  if (!artifacts.length) throw new Error('No release artifacts found under ' + DIST);
  const lines = artifacts.map(file => sha256(file) + '  ' + path.relative(DIST, file).replaceAll('\\', '/'));
  fs.writeFileSync(path.join(DIST, 'SHA256SUMS.txt'), lines.join('\n') + '\n');
  console.log('Wrote checksums for ' + artifacts.length + ' release artifact(s).');
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { RELEASE_EXTENSIONS, sha256, walk };
