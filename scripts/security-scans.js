'use strict';

/**
 * security-scans.js — the SBOM and the OSV report, and the proof of what they were made from
 * (audit B9, M39).
 *
 *   npm run scan:deps     run syft and osv-scanner, then record in .secreports/scan-manifest.json
 *                         the SHA-256 of package-lock.json and of both reports
 *
 * Release preflight calls checkScans(): it passes only when both reports and the manifest
 * exist, the manifest names the package-lock.json that is on disk now, neither report was
 * changed after the scan, and every advisory the OSV report names has been reviewed in
 * config/audit-acceptance.json. File dates are not used: a checkout, a copy or `touch` changes
 * them without changing a byte.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const RERUN = 'run `npm run scan:deps`';

function readOrNull(fsApi, file, encoding) {
  try { return fsApi.readFileSync(file, encoding); } catch (_) { return null; }
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

/** The advisory ids (GHSA-…, CVE-…) an osv-scanner markdown report links to, each once. */
function osvAdvisoryIds(reportText) {
  const ids = new Set();
  for (const match of String(reportText || '').matchAll(/https:\/\/osv\.dev\/([\w-]+)/g)) ids.add(match[1]);
  return [...ids];
}

/** True for a CycloneDX document that lists at least one component. */
function isUsableSbom(bytes) {
  try {
    const sbom = JSON.parse(bytes.toString('utf8'));
    return sbom.bomFormat === 'CycloneDX' && Array.isArray(sbom.components) && sbom.components.length > 0;
  } catch (_) {
    return false;
  }
}

function buildManifest({ lockBytes, sbomBytes, osvBytes, tools = {}, now = new Date() }) {
  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    lockfileSha256: sha256(lockBytes),
    sbomSha256: sha256(sbomBytes),
    osvSha256: sha256(osvBytes),
    tools,
  };
}

/**
 * @param {{fs?: object, lockfilePath: string, sbomPath: string, osvPath: string,
 *          manifestPath: string, acceptedAdvisories?: string[]}} options
 * @returns {string[]} one message per problem; empty means the scans describe this lockfile.
 */
function checkScans({ fs: fsApi = fs, lockfilePath, sbomPath, osvPath, manifestPath, acceptedAdvisories = [] }) {
  const errors = [];
  const lockBytes = readOrNull(fsApi, lockfilePath);
  const sbomBytes = readOrNull(fsApi, sbomPath);
  const osvBytes = readOrNull(fsApi, osvPath);
  const manifestText = readOrNull(fsApi, manifestPath, 'utf8');
  for (const [file, content] of [[lockfilePath, lockBytes], [sbomPath, sbomBytes], [osvPath, osvBytes], [manifestPath, manifestText]]) {
    if (content === null) errors.push(`${file} is missing — ${RERUN}`);
  }
  if (errors.length) return errors;

  let manifest;
  try { manifest = JSON.parse(manifestText); } catch (_) { manifest = null; }
  if (!manifest || typeof manifest !== 'object') return [`${manifestPath} is not valid JSON — ${RERUN}`];

  if (manifest.lockfileSha256 !== sha256(lockBytes)) {
    errors.push(`the SBOM and the OSV report were made from a different ${path.basename(lockfilePath)} — ${RERUN}`);
  }
  if (manifest.sbomSha256 !== sha256(sbomBytes)) errors.push(`${sbomPath} changed after the scan — ${RERUN}`);
  if (manifest.osvSha256 !== sha256(osvBytes)) errors.push(`${osvPath} changed after the scan — ${RERUN}`);
  if (!isUsableSbom(sbomBytes)) errors.push(`${sbomPath} is not a CycloneDX document with components — ${RERUN}`);

  const accepted = new Set(acceptedAdvisories);
  for (const id of osvAdvisoryIds(osvBytes.toString('utf8'))) {
    if (!accepted.has(id)) errors.push(`${osvPath} reports ${id}, which is not reviewed in config/audit-acceptance.json`);
  }
  return errors;
}

function toolVersion(command, args) {
  try { return execFileSync(command, args, { encoding: 'utf8' }).trim().split(/\r?\n/)[0]; } catch (_) { return 'unknown'; }
}

function main() {
  const reports = path.join(ROOT, '.secreports');
  const sbomPath = path.join(reports, 'sbom.json');
  const osvPath = path.join(reports, 'osv-scanner.txt');
  fs.mkdirSync(reports, { recursive: true });

  execFileSync('syft', ['.', '-o', `cyclonedx-json=${sbomPath}`], { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] });

  let osvReport;
  try {
    // The lockfile the manifest records, named directly: osv-scanner 2.4's directory walk found
    // no package source on Windows (it visited one inode of the folder) and failed the scan.
    osvReport = execFileSync('osv-scanner', ['scan', 'source', '--lockfile', 'package-lock.json', '--format', 'markdown'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  } catch (error) {
    // osv-scanner exits 1 when it finds a vulnerability; the report is still on stdout.
    if (!error || error.status !== 1 || typeof error.stdout !== 'string') throw error;
    osvReport = error.stdout;
  }
  fs.writeFileSync(osvPath, osvReport);

  const manifest = buildManifest({
    lockBytes: fs.readFileSync(path.join(ROOT, 'package-lock.json')),
    sbomBytes: fs.readFileSync(sbomPath),
    osvBytes: fs.readFileSync(osvPath),
    tools: { syft: toolVersion('syft', ['--version']), osvScanner: toolVersion('osv-scanner', ['--version']) },
  });
  fs.writeFileSync(path.join(reports, 'scan-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const ids = osvAdvisoryIds(osvReport);
  console.log(`Scans recorded for package-lock.json ${manifest.lockfileSha256.slice(0, 12)}…; OSV names ${ids.length} advisor${ids.length === 1 ? 'y' : 'ies'}${ids.length ? `: ${ids.join(', ')}` : ''}.`);
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exit(1); }
}

module.exports = { buildManifest, checkScans, isUsableSbom, osvAdvisoryIds, sha256 };
