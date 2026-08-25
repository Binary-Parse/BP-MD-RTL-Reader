#!/usr/bin/env node
'use strict';

/**
 * Full-tree secret scan (local audit only; CI does not run this).
 *
 * `gitleaks dir .` looks clean on this repo for the wrong reason: gitleaks'
 * default config carries a global allowlist that skips node_modules outright,
 * so a scan of 37,820 files reads 0 bytes and still exits 0. "Found nothing to
 * scan" is not the same as "found nothing", and the exit code cannot tell them
 * apart.
 *
 * This script closes that gap:
 *   1. fetches the default config for the pinned gitleaks version and verifies
 *      its SHA-256 before use, the way .github/workflows/ci.yml verifies the
 *      gitleaks binary itself;
 *   2. removes the node_modules entry from the global allowlist;
 *   3. runs the scan and FAILS if it read zero bytes, so a silently skipped
 *      tree can never be reported as clean again.
 *
 * The stripped config is written to a temp dir, never committed: pinning 3,200
 * lines of upstream rules into this repo would go stale on every gitleaks
 * release.
 *
 * Usage: node scripts/audit-secrets-fulltree.js [targetDir]
 */

const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const GITLEAKS_VERSION = '8.30.1';
const CONFIG_URL = `https://raw.githubusercontent.com/gitleaks/gitleaks/v${GITLEAKS_VERSION}/config/gitleaks.toml`;

// Refresh alongside GITLEAKS_VERSION. A mismatch aborts rather than scanning
// with unverified rules.
const CONFIG_SHA256 = process.env.GITLEAKS_CONFIG_SHA256
  || 'e163e53b9e7e8a8511e77271e2b323ed057759542a6d988258afe3a1fa329caf';

/** The default global-allowlist entry that hides node_modules from the scan. */
const NODE_MODULES_ALLOWLIST = /^\s*'''\(\?:\^\|\/\)node_modules\(\?:\/\.\*\)\?\$''',?\s*$/;

function fetchDefaultConfig() {
  return execFileSync('curl', ['-sSL', '--fail', CONFIG_URL], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
}

function verify(body) {
  const digest = crypto.createHash('sha256').update(body).digest('hex');
  if (CONFIG_SHA256 && digest !== CONFIG_SHA256) {
    throw new Error(`gitleaks config SHA-256 mismatch: expected ${CONFIG_SHA256}, got ${digest}`);
  }
  return digest;
}

/** Drop the node_modules allowlist path; return the body and whether it moved. */
function unmaskNodeModules(body) {
  const lines = body.split('\n');
  const kept = lines.filter((line) => !NODE_MODULES_ALLOWLIST.test(line));
  return { body: kept.join('\n'), removed: lines.length - kept.length };
}

/** Bytes gitleaks reports reading, or null when the line is absent. */
function scannedBytes(output) {
  const match = /scanned ~(\d+) bytes/.exec(output);
  return match ? Number(match[1]) : null;
}

/**
 * Split findings into code this repository owns and code it merely installs.
 *
 * Not a suppression: every finding is still counted and printed. Only the exit
 * code distinguishes them, because a hit inside node_modules is upstream's file
 * — untracked here, absent from build.files, and reinstalled from the lockfile.
 * Crypto libraries such as @peculiar/webcrypto and pkijs carry PEM header
 * constants by nature, so gating on them would pin the audit red forever and
 * bury the first-party finding that actually matters.
 */
function partitionFindings(findings) {
  const thirdParty = findings.filter((f) => /(?:^|[\\/])node_modules[\\/]/.test(String(f.File)));
  const firstParty = findings.filter((f) => !/(?:^|[\\/])node_modules[\\/]/.test(String(f.File)));
  return { firstParty, thirdParty };
}

function main() {
  const target = process.argv[2] || '.';
  const raw = fetchDefaultConfig();
  const digest = verify(raw);
  const { body, removed } = unmaskNodeModules(raw);

  if (removed === 0) {
    throw new Error(
      'node_modules allowlist entry not found in the default gitleaks config — '
      + 'upstream changed its shape, so this script would scan with the tree still masked.',
    );
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitleaks-fulltree-'));
  const configPath = path.join(dir, 'gitleaks.toml');
  fs.writeFileSync(configPath, body, 'utf8');

  process.stdout.write(`gitleaks ${GITLEAKS_VERSION} default config sha256=${digest}\n`);
  process.stdout.write(`removed ${removed} allowlist line(s) masking node_modules\n`);

  const reportPath = path.join(dir, 'report.json');
  let output = '';
  try {
    output = execFileSync(
      'gitleaks',
      ['dir', target, '--config', configPath, '--redact', '--no-banner',
        '--report-format', 'json', '--report-path', reportPath],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (error) {
    output = `${error.stdout || ''}${error.stderr || ''}`;
  }

  let findings = [];
  try {
    findings = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } catch (_) {
    fs.rmSync(dir, { recursive: true, force: true });
    process.stdout.write(output);
    process.stderr.write('gitleaks produced no readable report — treating as ERROR.\n');
    process.exit(2);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  process.stdout.write(output);

  // The whole point: a scan that read nothing is an error, never a pass.
  const bytes = scannedBytes(output);
  if (bytes === null) {
    process.stderr.write('gitleaks did not report a scanned byte count — treating as ERROR.\n');
    process.exit(2);
  }
  if (bytes === 0) {
    process.stderr.write(`gitleaks scanned 0 bytes of ${target} — nothing was read, so this is ERROR, not clean.\n`);
    process.exit(2);
  }

  const { firstParty, thirdParty } = partitionFindings(findings);
  process.stdout.write(`scanned ${bytes} bytes of ${target}\n`);
  process.stdout.write(`findings: ${firstParty.length} first-party, ${thirdParty.length} in node_modules\n`);

  for (const finding of firstParty) {
    process.stdout.write(`  FIRST-PARTY ${finding.RuleID} ${finding.File}:${finding.StartLine}\n`);
  }
  if (thirdParty.length > 0) {
    process.stdout.write(
      `  ${thirdParty.length} finding(s) live in installed packages — reported, not gated. `
      + 'Review them, but they are upstream files: untracked here and excluded from build.files.\n',
    );
  }

  process.exit(firstParty.length > 0 ? 1 : 0);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(2);
  }
}

module.exports = {
  unmaskNodeModules, scannedBytes, partitionFindings, NODE_MODULES_ALLOWLIST,
};
