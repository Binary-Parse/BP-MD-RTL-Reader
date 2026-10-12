'use strict';

/**
 * audit-deps.js — the dependency-advisory gate (audit B8).
 *
 * `npm audit` alone cannot be the gate: an advisory with no patched release keeps it red for
 * ever, and `--audit-level` hides the low ones without anyone having looked at them. This gate
 * passes only when every advisory npm reports is listed in config/audit-acceptance.json with a
 * reason, and the list holds nothing else:
 *   - an advisory that is not listed fails;
 *   - a listed advisory npm no longer reports fails (remove the entry);
 *   - an advisory whose severity rose above the reviewed one fails;
 *   - a "dev" entry fails when that package is inside the vendored bundles, i.e. shipped;
 *   - a "shipped" entry may only be of low severity.
 *
 * Usage: node scripts/audit-deps.js     (run from the repository root; needs the npm registry)
 */
const { execSync } = require('child_process');
const fs = require('fs');

const SEVERITY_RANK = new Map([['info', 0], ['low', 1], ['moderate', 2], ['high', 3], ['critical', 4]]);
const rank = (severity) => (SEVERITY_RANK.has(severity) ? SEVERITY_RANK.get(severity) : 4);

/** The advisory id (GHSA-…) at the end of an advisory URL. */
function advisoryId(url) {
  return String(url || '').split('/').pop();
}

/** Every distinct advisory in an `npm audit --json` report: id → {id, package, severity}. */
function reportedAdvisories(report) {
  const found = new Map();
  for (const entry of Object.values((report && report.vulnerabilities) || {})) {
    for (const via of entry.via || []) {
      if (!via || typeof via !== 'object') continue; // a string names a dependency, not an advisory
      const id = advisoryId(via.url);
      const known = found.get(id);
      if (!known || rank(via.severity) > rank(known.severity)) {
        found.set(id, { id, package: via.name, severity: via.severity });
      }
    }
  }
  return found;
}

/** Package names that have a section in the bundled licence file, i.e. are shipped. */
function shippedPackages(licenseText) {
  const names = new Set();
  for (const line of String(licenseText || '').split(/\r?\n/)) {
    const at = line.lastIndexOf('@');
    const dash = line.indexOf(' — ');
    if (at > 0 && dash > at && !line.slice(0, at).includes(' ')) names.add(line.slice(0, at));
  }
  return names;
}

/**
 * Compare the report with the acceptance list.
 * @returns {string[]} one message per problem; empty means the gate passes.
 */
function evaluateAudit(report, acceptance, shipped = new Set()) {
  const errors = [];
  const reported = reportedAdvisories(report);
  const accepted = new Map();
  for (const entry of (acceptance && acceptance.accepted) || []) {
    const where = `acceptance entry ${entry.advisory || '(no advisory id)'}`;
    if (!entry.advisory || !entry.package) { errors.push(`${where}: "advisory" and "package" are required`); continue; }
    if (accepted.has(entry.advisory)) { errors.push(`${where}: listed twice`); continue; }
    accepted.set(entry.advisory, entry);
    if (typeof entry.reason !== 'string' || entry.reason.trim().length < 20) errors.push(`${where}: needs a reason`);
    if (!SEVERITY_RANK.has(entry.severity)) errors.push(`${where}: unknown severity "${entry.severity}"`);
    if (entry.scope !== 'dev' && entry.scope !== 'shipped') errors.push(`${where}: scope must be "dev" or "shipped"`);
    if (entry.scope === 'dev' && shipped.has(entry.package)) {
      errors.push(`${where}: ${entry.package} is inside the vendored bundles, so it is shipped, not dev-only`);
    }
    if (entry.scope === 'shipped' && rank(entry.severity) > rank('low')) {
      errors.push(`${where}: a shipped package may only carry an accepted advisory of low severity`);
    }
  }
  for (const advisory of reported.values()) {
    const entry = accepted.get(advisory.id);
    if (!entry) {
      errors.push(`${advisory.id} (${advisory.package}, ${advisory.severity}) is not accepted: fix it or add it to config/audit-acceptance.json with a reason`);
      continue;
    }
    if (entry.package !== advisory.package) errors.push(`${advisory.id}: reported for ${advisory.package}, accepted for ${entry.package}`);
    if (rank(advisory.severity) > rank(entry.severity)) {
      errors.push(`${advisory.id}: severity is now ${advisory.severity}, reviewed as ${entry.severity}`);
    }
  }
  for (const id of accepted.keys()) {
    if (!reported.has(id)) errors.push(`${id}: accepted but no longer reported — remove it from config/audit-acceptance.json`);
  }
  return errors;
}

/**
 * The environment for the nested npm. Under `npm run` the parent exports its whole merged
 * configuration as npm_config_* variables, and npm rejects some of those (a user-level
 * allow-scripts, for one) when they arrive that way; the nested npm reads the same
 * configuration files itself, so they are dropped.
 */
function npmEnvironment(env) {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !/^npm_config_/i.test(name)));
}

function runNpmAudit() {
  try {
    return execSync('npm audit --json', {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, env: npmEnvironment(process.env),
    });
  } catch (error) {
    // npm audit exits 1 when it finds anything; the report is still on stdout.
    if (error && typeof error.stdout === 'string' && error.stdout.trim().startsWith('{')) return error.stdout;
    throw error;
  }
}

function main() {
  const report = JSON.parse(runNpmAudit());
  if (!report || report.error || !report.vulnerabilities || typeof report.vulnerabilities !== 'object') {
    const why = report && report.error && report.error.summary;
    throw new Error(`npm audit returned no report: ${why || 'is the npm registry reachable?'}`);
  }
  const acceptance = JSON.parse(fs.readFileSync('config/audit-acceptance.json', 'utf8'));
  const shipped = shippedPackages(fs.readFileSync('resources/vendor/THIRD-PARTY-LICENSES.txt', 'utf8'));
  const errors = evaluateAudit(report, acceptance, shipped);
  if (errors.length) {
    console.error('Dependency audit gate failed:');
    for (const message of errors) console.error(` - ${message}`);
    process.exit(1);
  }
  const count = reportedAdvisories(report).size;
  console.log(`Dependency audit gate passed: ${count} reported ${count === 1 ? 'advisory' : 'advisories'}, all reviewed in config/audit-acceptance.json.`);
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exit(1); }
}

module.exports = { evaluateAudit, reportedAdvisories, shippedPackages, advisoryId, npmEnvironment };
