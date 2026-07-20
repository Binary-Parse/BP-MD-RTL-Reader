'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BASELINE_PATH = path.join(ROOT, 'config', 'security-lint-baseline.json');
const PATTERNS = [
  'main.js', 'preload.js', 'src/**/*.js', 'scripts/**/*.{js,mjs}',
  '*.config.js', '*.config.mjs', 'index.html',
];

function normalizeFile(filePath) {
  return path.relative(ROOT, filePath).replaceAll('\\', '/');
}

function collectFindings(results) {
  return results.flatMap(result => result.messages.map(message => ({
    file: normalizeFile(result.filePath),
    line: message.line || 0,
    column: message.column || 0,
    severity: message.severity || 0,
    rule: message.ruleId || 'fatal/config',
    fatal: !!message.fatal || !message.ruleId,
  })));
}

function fingerprint(findings) {
  const records = findings.map(finding => [
    finding.file, finding.line, finding.column, finding.severity, finding.rule,
  ].join(':')).sort();
  return crypto.createHash('sha256').update(records.join('\n')).digest('hex');
}

function countByRule(findings) {
  const counts = {};
  for (const finding of findings) counts[finding.rule] = (counts[finding.rule] || 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function compareBaseline(findings, baseline) {
  const failures = [];
  const fatal = findings.filter(finding => finding.fatal);
  if (fatal.length) failures.push(`${fatal.length} fatal/config lint finding(s)`);
  if (findings.length !== baseline.expectedTotal) {
    failures.push(`finding count ${findings.length} does not match reviewed ${baseline.expectedTotal}`);
  }
  const actualFingerprint = fingerprint(findings);
  if (actualFingerprint !== baseline.fingerprintSha256) {
    failures.push(`fingerprint ${actualFingerprint} does not match reviewed ${baseline.fingerprintSha256}`);
  }
  const actualRules = countByRule(findings);
  if (JSON.stringify(actualRules) !== JSON.stringify(baseline.countsByRule)) {
    failures.push(`rule counts changed: ${JSON.stringify(actualRules)}`);
  }
  return failures;
}

async function main() {
  const { ESLint } = await import('eslint');
  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  const eslint = new ESLint({ cwd: ROOT });
  const results = await eslint.lintFiles(PATTERNS);
  const findings = collectFindings(results);
  const failures = compareBaseline(findings, baseline);
  if (failures.length) {
    const formatter = await eslint.loadFormatter('stylish');
    console.error(await formatter.format(results));
    throw new Error('Security lint baseline mismatch:\n - ' + failures.join('\n - '));
  }
  console.log(`Security lint gate passed: ${findings.length} exact reviewed findings; 0 new or moved findings.`);
  console.log(`Rules: ${JSON.stringify(countByRule(findings))}`);
}

if (require.main === module) {
  main().catch(error => { console.error(error.message); process.exit(1); });
}

module.exports = { PATTERNS, collectFindings, fingerprint, countByRule, compareBaseline };
