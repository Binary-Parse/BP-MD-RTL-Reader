'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { validateReleaseEntries } = require('./release-artifacts.js');
const PACKAGE_VERSION = require('../package.json').version;

const ROOT = path.resolve(__dirname, '..');
const CHECKSUM_FILE = 'SHA256SUMS.txt';

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function releaseEntries(directory) {
  if (!fs.existsSync(directory)) throw new Error(`Release directory does not exist: ${directory}`);
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.name !== CHECKSUM_FILE)
    .map(entry => entry.isFile() ? entry.name : `${entry.name}/`);
}

function validationError(errors) {
  return new Error(`Release artifact validation failed:\n - ${errors.join('\n - ')}`);
}

function writeChecksums(directory, version) {
  const entries = releaseEntries(directory);
  const errors = validateReleaseEntries(entries, version);
  if (errors.length) throw validationError(errors);

  const lines = entries.slice().sort().map(name => `${sha256(path.join(directory, name))}  ${name}`);
  const checksumPath = path.join(directory, CHECKSUM_FILE);
  fs.writeFileSync(checksumPath, `${lines.join('\n')}\n`, { encoding: 'utf8', flag: 'w' });
  return checksumPath;
}

function parseChecksumManifest(content) {
  const records = [];
  const errors = [];
  for (const line of content.split(/\r?\n/).filter(Boolean)) {
    const match = /^([0-9a-f]{64})  ([^/\\]+)$/.exec(line);
    if (!match) {
      errors.push(`invalid checksum line ${JSON.stringify(line)}`);
      continue;
    }
    records.push({ hash: match[1], name: match[2] });
  }
  return { records, errors };
}

function verifyChecksums(directory, version) {
  const entries = releaseEntries(directory);
  const errors = validateReleaseEntries(entries, version);
  const checksumPath = path.join(directory, CHECKSUM_FILE);
  if (!fs.existsSync(checksumPath)) return [...errors, `missing ${CHECKSUM_FILE}`];

  const manifestContent = fs.readFileSync(checksumPath, 'utf8');
  const parsed = parseChecksumManifest(manifestContent);
  errors.push(...parsed.errors);
  errors.push(...validateReleaseEntries(parsed.records.map(record => record.name), version));

  const canonicalContent = `${entries.slice().sort()
    .map(name => `${sha256(path.join(directory, name))}  ${name}`)
    .join('\n')}\n`;
  if (manifestContent !== canonicalContent) errors.push(`${CHECKSUM_FILE} is not canonical`);

  const manifestHashes = new Map(parsed.records.map(record => [record.name, record.hash]));
  for (const name of entries) {
    const expectedHash = manifestHashes.get(name);
    if (expectedHash && sha256(path.join(directory, name)) !== expectedHash) {
      errors.push(`checksum mismatch ${name}`);
    }
  }
  return [...new Set(errors)];
}

function parseArgs(argv) {
  const result = {
    check: false,
    directory: path.join(ROOT, 'dist', 'release'),
    version: PACKAGE_VERSION,
  };
  const argumentsIterator = argv[Symbol.iterator]();
  for (const argument of argumentsIterator) {
    if (argument === '--check') result.check = true;
    else if (argument === '--directory') result.directory = path.resolve(argumentsIterator.next().value || '');
    else if (argument === '--version') result.version = argumentsIterator.next().value || '';
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return result;
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.check) {
    const errors = verifyChecksums(options.directory, options.version);
    if (errors.length) throw validationError(errors);
    console.log(`Verified ${CHECKSUM_FILE} for ${releaseEntries(options.directory).length} release artifact(s).`);
    return;
  }
  const checksumPath = writeChecksums(options.directory, options.version);
  console.log(`Wrote ${checksumPath}.`);
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = {
  CHECKSUM_FILE,
  main,
  parseArgs,
  parseChecksumManifest,
  releaseEntries,
  sha256,
  verifyChecksums,
  writeChecksums,
};
