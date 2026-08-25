/**
 * regen-security-baseline.cjs — refresh config/security-lint-baseline.json after an edit
 * that only SHIFTS lines in an already-reviewed file.
 *
 * run-security-lint.js has no --update mode by design: the fingerprint covers
 * file:line:column:severity:rule, so any edit above a finding invalidates it and a human
 * has to look. The hazard is that "just regenerate it" also silently absorbs a genuinely
 * new finding, or a same-rule swap that leaves the aggregates untouched.
 *
 * So this refuses to write unless the finding SET is unchanged apart from position:
 * same total, same countsByRule, and the same per-file/per-rule histogram. Anything else
 * exits non-zero and prints the delta for review. Pass --accept to override deliberately.
 */
const { ESLint } = require('eslint');
const fs = require('fs');
const { execSync } = require('child_process');
const { PATTERNS, collectFindings, fingerprint, countByRule } = require('./run-security-lint.js');

const BASELINE = 'config/security-lint-baseline.json';

function histogram(findings) {
  const h = {};
  for (const f of findings) {
    const k = `${f.file}|${f.rule}`;
    h[k] = (h[k] || 0) + 1;
  }
  return h;
}

(async () => {
  const accept = process.argv.includes('--accept');
  const prev = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  const findings = collectFindings(await new ESLint({ cwd: process.cwd() }).lintFiles(PATTERNS));

  const problems = [];
  if (findings.length !== prev.expectedTotal) {
    problems.push(`total ${prev.expectedTotal} -> ${findings.length}`);
  }
  const rules = countByRule(findings);
  for (const k of new Set([...Object.keys(rules), ...Object.keys(prev.countsByRule)])) {
    if ((rules[k] || 0) !== (prev.countsByRule[k] || 0)) {
      problems.push(`rule ${k}: ${prev.countsByRule[k] || 0} -> ${rules[k] || 0}`);
    }
  }
  // Per-file/per-rule catches a same-rule swap across files, which the aggregates cannot.
  const histPath = 'config/security-lint-histogram.json';
  const hist = histogram(findings);
  if (fs.existsSync(histPath)) {
    const before = JSON.parse(fs.readFileSync(histPath, 'utf8'));
    for (const k of new Set([...Object.keys(hist), ...Object.keys(before)])) {
      if ((hist[k] || 0) !== (before[k] || 0)) {
        problems.push(`${k}: ${before[k] || 0} -> ${hist[k] || 0}`);
      }
    }
  }

  if (problems.length && !accept) {
    console.error('REFUSING to regenerate — the finding set changed, not just its positions:');
    for (const p of problems) console.error('  ' + p);
    console.error('\nReview each one. Re-run with --accept only once you have.');
    process.exit(1);
  }
  if (problems.length) {
    console.log('Accepting a reviewed change to the finding set:');
    for (const p of problems) console.log('  ' + p);
  }

  fs.writeFileSync(BASELINE, JSON.stringify({
    schemaVersion: 1,
    reviewedAtCommit: execSync('git rev-parse --short HEAD').toString().trim(),
    expectedTotal: findings.length,
    fingerprintSha256: fingerprint(findings),
    countsByRule: rules,
  }, null, 2) + '\n');
  fs.writeFileSync(histPath, JSON.stringify(hist, null, 2) + '\n');
  console.log(`Baseline refreshed: ${findings.length} findings, positions only.`);
})();
