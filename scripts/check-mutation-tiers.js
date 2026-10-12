'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_REPORT = path.join(ROOT, 'reports', 'mutation', 'mutation.json');
const DEFAULT_TIERS = path.join(ROOT, 'config', 'mutation-tiers.json');
// Stryker's own score: detected over detected + undetected. The status names are the ones
// Stryker writes ("Timeout", not "TimedOut" — audit M30). A mutant Stryker could not judge
// (RuntimeError, CompileError, Ignored) is in neither set.
const DETECTED = new Set(['Killed', 'Timeout']);
const COUNTED = new Set([...DETECTED, 'Survived', 'NoCoverage']);

function mutationScore(mutants) {
  const counted = mutants.filter((mutant) => COUNTED.has(mutant.status));
  const detected = counted.filter((mutant) => DETECTED.has(mutant.status)).length;
  return counted.length ? (detected / counted.length) * 100 : 100;
}

/** Files a run mutated only in part (`--mutate file:10-20`): file → the pattern that says so. */
function partlyMutatedFiles(config) {
  const partial = new Map();
  const patterns = config && Array.isArray(config.mutate) ? config.mutate : [];
  for (const pattern of patterns) {
    const text = String(pattern);
    const colon = text.indexOf(':');
    if (colon > 0 && text.slice(colon + 1).includes('-') && !partial.has(text.slice(0, colon))) {
      partial.set(text.slice(0, colon), text);
    }
  }
  return partial;
}

function readSourceFromDisk(file) {
  try { return fs.readFileSync(path.join(ROOT, file), 'utf8'); } catch (_) { return null; }
}

const sameText = (left, right) => typeof left === 'string' && typeof right === 'string'
  && left.replace(/\r\n/g, '\n') === right.replace(/\r\n/g, '\n');

/** Why this file's result proves nothing about the file on disk, or '' when it does. */
function unusableReason(file, result, partial, readSource) {
  if (!sameText(result.source, readSource(file))) {
    return 'the report was made from another version of this file — run Stryker again';
  }
  if (partial.has(file)) {
    return 'only some lines were mutated (--mutate ' + partial.get(file) + ') — run Stryker on the whole file';
  }
  const mutants = result.mutants || [];
  const pending = mutants.filter((mutant) => mutant.status === 'Pending').length;
  if (pending) {
    return pending + (pending === 1 ? ' mutant was' : ' mutants were') + ' never run (Pending) — the Stryker run did not finish';
  }
  if (!mutants.some((mutant) => COUNTED.has(mutant.status))) return 'no scored mutants — nothing proves this file';
  return '';
}

function evaluateTiers(report, tiers, { allowPartial = false, readSource = readSourceFromDisk } = {}) {
  const failures = [];
  const results = [];
  const reportFiles = report.files || {};
  const partial = partlyMutatedFiles(report.config);
  let reported = 0;
  for (const [tier, policy] of Object.entries(tiers)) {
    for (const file of policy.files) {
      const result = reportFiles[file];
      if (!result) {
        if (!allowPartial) failures.push(tier + ' missing mutation result: ' + file);
        continue;
      }
      reported += 1;
      const reason = unusableReason(file, result, partial, readSource);
      if (reason) {
        failures.push(tier + ' ' + file + ': ' + reason);
        continue;
      }
      const score = mutationScore(result.mutants);
      results.push({ tier, file, minimum: policy.minimum, score });
      if (score < policy.minimum) {
        failures.push(tier + ' ' + file + ': ' + score.toFixed(2) + '% < ' + policy.minimum + '%');
      }
    }
  }
  if (allowPartial && reported === 0) failures.push('the report holds no result for any tier file');
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

module.exports = { mutationScore, evaluateTiers, partlyMutatedFiles };
