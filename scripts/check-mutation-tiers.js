'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_REPORT = path.join(ROOT, 'reports', 'mutation', 'mutation.json');
const DEFAULT_TIERS = path.join(ROOT, 'config', 'mutation-tiers.json');
const DETECTED = new Set(['Killed', 'TimedOut', 'RuntimeError', 'CompileError']);
const COUNTED = new Set([...DETECTED, 'Survived', 'NoCoverage']);

function mutationScore(mutants) {
  const counted = mutants.filter((mutant) => COUNTED.has(mutant.status));
  const detected = counted.filter((mutant) => DETECTED.has(mutant.status)).length;
  return counted.length ? (detected / counted.length) * 100 : 100;
}

function evaluateTiers(report, tiers, { allowPartial = false } = {}) {
  const failures = [];
  const results = [];
  const reportFiles = report.files || {};
  for (const [tier, policy] of Object.entries(tiers)) {
    for (const file of policy.files) {
      const result = reportFiles[file];
      if (!result) {
        if (!allowPartial) failures.push(tier + ' missing mutation result: ' + file);
        continue;
      }
      const score = mutationScore(result.mutants || []);
      results.push({ tier, file, minimum: policy.minimum, score });
      if (score < policy.minimum) {
        failures.push(tier + ' ' + file + ': ' + score.toFixed(2) + '% < ' + policy.minimum + '%');
      }
    }
  }
  return { failures, results };
}

function main() {
  const allowPartial = process.argv.includes('--allow-partial');
  const reportPath = process.env.MUTATION_REPORT || DEFAULT_REPORT;
  if (!fs.existsSync(reportPath)) throw new Error('Mutation report not found: ' + reportPath);
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const tiers = JSON.parse(fs.readFileSync(DEFAULT_TIERS, 'utf8'));
  const { failures, results } = evaluateTiers(report, tiers, { allowPartial });
  for (const result of results) {
    console.log(result.tier + ' ' + result.file + ': ' + result.score.toFixed(2)
      + '% (min ' + result.minimum + '%)');
  }
  if (failures.length) throw new Error('Mutation tier gate failed:\n - ' + failures.join('\n - '));
  console.log('Mutation tier gate passed for ' + results.length + ' reported file(s).');
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { mutationScore, evaluateTiers };
