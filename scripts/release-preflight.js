'use strict';

const fs = require('fs');
const path = require('path');
const { assertReleaseVersion } = require('./release-artifacts.js');

const ROOT = path.resolve(__dirname, '..');
const EXPECTED_REPOSITORY = 'Binary-Parse/BP-MD-RTL-Reader';

function isVersionHeader(line, version) {
  const prefix = `## [${version}]`;
  const suffix = line.slice(prefix.length);
  return line.startsWith(prefix) && (
    suffix === '' || suffix.startsWith(' - ') || suffix.startsWith(' — ') || suffix.startsWith(' – ')
  );
}

function extractReleaseNotes(changelog, version) {
  let collecting = false;
  const noteLines = [];
  for (const line of changelog.split(/\r?\n/)) {
    if (!collecting) {
      collecting = isVersionHeader(line, version);
      continue;
    }
    if (line.startsWith('## [')) break;
    noteLines.push(line);
  }
  if (!collecting) throw new Error(`CHANGELOG.md has no [${version}] section.`);
  const notes = noteLines.join('\n').trim();
  if (!notes) throw new Error(`CHANGELOG.md [${version}] section is empty.`);
  return notes;
}

function validateRelease(options) {
  const errors = [];
  const expectedTag = `v${options.packageVersion}`;
  try {
    assertReleaseVersion(options.packageVersion);
  } catch {
    errors.push(`package version ${options.packageVersion} is not a stable SemVer release`);
  }
  if (options.repository !== EXPECTED_REPOSITORY) {
    errors.push(`repository ${options.repository} does not match ${EXPECTED_REPOSITORY}`);
  }
  try {
    extractReleaseNotes(options.changelog, options.packageVersion);
  } catch (error) {
    errors.push(error.message);
  }
  const sectionCount = options.changelog.split(/\r?\n/)
    .filter(line => isVersionHeader(line, options.packageVersion)).length;
  if (sectionCount !== 1) errors.push(`CHANGELOG.md must contain exactly one [${options.packageVersion}] section`);

  if (options.publish) {
    if (options.visibility !== 'public') errors.push('publishing requires a public repository');
    if (options.refType !== 'tag') errors.push(`publishing is allowed only from an annotated ${expectedTag} tag`);
    if (options.refName !== expectedTag) {
      errors.push(`release tag ${options.refName} does not match package version ${options.packageVersion}`);
    }
  }
  return errors;
}

function parseArgs(argv) {
  let writeNotes = '';
  const argumentsIterator = argv[Symbol.iterator]();
  for (const argument of argumentsIterator) {
    if (argument === '--write-notes') writeNotes = argumentsIterator.next().value || '';
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return { writeNotes };
}

function main(argv = process.argv.slice(2), environment = process.env) {
  const args = parseArgs(argv);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const changelog = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
  const options = {
    packageVersion: pkg.version,
    changelog,
    repository: environment.GITHUB_REPOSITORY || '',
    visibility: environment.REPOSITORY_VISIBILITY || '',
    publish: environment.RELEASE_PUBLISH === 'true',
    refType: environment.GITHUB_REF_TYPE || '',
    refName: environment.GITHUB_REF_NAME || '',
  };
  const errors = validateRelease(options);
  if (errors.length) throw new Error(`Release preflight failed:\n - ${errors.join('\n - ')}`);
  if (args.writeNotes) {
    const target = path.resolve(args.writeNotes);
    fs.writeFileSync(target, `${extractReleaseNotes(changelog, pkg.version)}\n`, { encoding: 'utf8', flag: 'wx' });
    console.log(`Wrote release notes to ${target}.`);
  }
  console.log(`Release preflight passed for ${pkg.version} (publish=${options.publish}).`);
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = {
  EXPECTED_REPOSITORY,
  extractReleaseNotes,
  isVersionHeader,
  main,
  parseArgs,
  validateRelease,
};
