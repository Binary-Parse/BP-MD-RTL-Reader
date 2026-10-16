'use strict';

const fs = require('fs');
const path = require('path');
const { assertReleaseVersion } = require('./release-artifacts.js');
const { verifyChecksums } = require('./write-artifact-checksums.js');
const { checkScans } = require('./security-scans.js');

const ROOT = path.resolve(__dirname, '..');
const EXPECTED_REPOSITORY = 'Binary-Parse/BP-MD-RTL-Reader';

// T14: BUILD.md runs this script by hand, where GITHUB_REPOSITORY is not exported. Default
// to the repository package.json declares so the documented local invocation works, while an
// explicit environment value (CI, or a wrong remote) still wins and is still checked.
function repositorySlugFromPackage() {
  try {
    const url = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).repository.url;
    const match = url.match(/github\.com[/:]([^/]+\/[^/.]+?)(?:\.git)?$/);
    return match ? match[1] : '';
  } catch (_) {
    return '';
  }
}

/** The advisory ids reviewed in config/audit-acceptance.json (see scripts/audit-deps.js). */
function acceptedAdvisoryIds() {
  const acceptance = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'audit-acceptance.json'), 'utf8'));
  return (acceptance.accepted || []).map((entry) => entry.advisory);
}

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

  // audit CMP-05 / GATE-02 / B9 / M39: the SBOM and the OSV report must describe the lockfile
  // that is on disk. `npm run scan:deps` records the lockfile's SHA-256 beside them; a missing
  // report, a missing record, another lockfile or a report changed afterwards all fail here.
  if (!options.skipSbomStaleness && options.lockfilePath) {
    for (const problem of checkScans({
      lockfilePath: options.lockfilePath,
      sbomPath: options.sbomPath,
      osvPath: options.osvPath,
      manifestPath: options.scanManifestPath,
      acceptedAdvisories: options.acceptedAdvisories,
    })) {
      errors.push(`${problem}, or pass --skip-sbom-staleness with a note in the release report`);
    }
  }

  // The dist/release artifacts themselves: preflight runs against a populated release
  // directory unless --skip-artifact-check marks the run as deliberately pre-build, and a
  // populated one must be exactly the public allowlist with SHA256SUMS.txt matching bytes.
  if (!options.skipArtifactCheck) {
    try {
      errors.push(...verifyChecksums(options.releaseDir, options.packageVersion));
    } catch (error) {
      errors.push(`${error.message} — build the release per docs/RELEASING.md or pass --skip-artifact-check`);
    }
  }
  return errors;
}

function parseArgs(argv) {
  let skipSbomStaleness = false;
  let skipArtifactCheck = false;
  const argumentsIterator = argv[Symbol.iterator]();
  for (const argument of argumentsIterator) {
    if (argument === '--skip-sbom-staleness') skipSbomStaleness = true;
    else if (argument === '--skip-artifact-check') skipArtifactCheck = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return { skipSbomStaleness, skipArtifactCheck };
}

function main(argv = process.argv.slice(2), environment = process.env) {
  const args = parseArgs(argv);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const changelog = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
  const options = {
    packageVersion: pkg.version,
    changelog,
    repository: environment.GITHUB_REPOSITORY || repositorySlugFromPackage(),
    // audit CMP-05: the local scan artifacts and the lockfile they were produced from.
    sbomPath: path.join(ROOT, '.secreports', 'sbom.json'),
    osvPath: path.join(ROOT, '.secreports', 'osv-scanner.txt'),
    scanManifestPath: path.join(ROOT, '.secreports', 'scan-manifest.json'),
    acceptedAdvisories: acceptedAdvisoryIds(),
    lockfilePath: path.join(ROOT, 'package-lock.json'),
    skipSbomStaleness: args.skipSbomStaleness,
    releaseDir: path.join(ROOT, 'dist', 'release'),
    skipArtifactCheck: args.skipArtifactCheck,
  };
  const errors = validateRelease(options);
  if (errors.length) throw new Error(`Release preflight failed:\n - ${errors.join('\n - ')}`);
  console.log(`Release preflight passed for ${pkg.version}.`);
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
