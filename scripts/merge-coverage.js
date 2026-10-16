'use strict';

/**
 * Merge fresh, non-empty Vitest and renderer coverage from the current commit.
 * Report generation and threshold enforcement are one operation.
 */

const fs = require('fs');
const path = require('path');
const libCoverage = require('istanbul-lib-coverage');
const libReport = require('istanbul-lib-report');
const reports = require('istanbul-reports');
const { loadCoverageInput, writeCoverageMetadata } = require('./coverage-metadata');

const ROOT = process.cwd();
const NODE_COVERAGE = path.join(ROOT, 'coverage', 'node', 'coverage-final.json');
const RENDERER_COVERAGE = path.join(ROOT, 'coverage', 'renderer-report', 'coverage-final.json');
const MERGED_DIR = path.join(ROOT, 'coverage', 'merged');
// QA-M27: measured 92.37 % statements / 92.03 % functions on 2026-10-13; the floor sits about
// two points below, so a real drop fails and run-to-run noise does not. Raise it, never lower it.
// The floor lives in config/coverage-thresholds.json (`combined`); the env vars override it.
const COMBINED = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'coverage-thresholds.json'), 'utf8')).combined;
const MIN_STATEMENTS = Number(process.env.MIN_COMBINED_STMT_PCT || COMBINED.statements);
const MIN_FUNCTIONS = Number(process.env.MIN_COMBINED_FUNC_PCT || COMBINED.functions);

function mergeCoverageInputs(nodeInput, rendererInput) {
  const coverageMap = libCoverage.createCoverageMap();
  coverageMap.merge(nodeInput);
  coverageMap.merge(rendererInput);
  if (coverageMap.files().length === 0) throw new Error('Combined coverage map is empty');
  return coverageMap;
}

function enforceCombinedThresholds(coverageMap) {
  const summary = coverageMap.getCoverageSummary().toJSON();
  const statements = Number(summary.statements.pct) || 0;
  const functions = Number(summary.functions.pct) || 0;
  const failures = [];
  if (statements < MIN_STATEMENTS) {
    failures.push('statements ' + statements.toFixed(2) + '% < ' + MIN_STATEMENTS + '%');
  }
  if (functions < MIN_FUNCTIONS) {
    failures.push('functions ' + functions.toFixed(2) + '% < ' + MIN_FUNCTIONS + '%');
  }
  if (failures.length) throw new Error('Combined coverage gate failed: ' + failures.join('; '));
  return { statements, functions };
}

function main() {
  const node = loadCoverageInput(NODE_COVERAGE, 'unit');
  const renderer = loadCoverageInput(RENDERER_COVERAGE, 'renderer');
  const coverageMap = mergeCoverageInputs(node.coverage, renderer.coverage);
  const totals = enforceCombinedThresholds(coverageMap);

  fs.rmSync(MERGED_DIR, { recursive: true, force: true });
  const context = libReport.createContext({ dir: MERGED_DIR, coverageMap });
  reports.create('html').execute(context);
  reports.create('text-summary').execute(context);
  reports.create('json').execute(context);
  writeCoverageMetadata(MERGED_DIR, 'combined', {
    sourceFiles: coverageMap.files().length,
    statements: totals.statements,
    functions: totals.functions,
  });
  console.log('Merged coverage gate passed: ' + totals.statements.toFixed(2)
    + '% statements / ' + totals.functions.toFixed(2) + '% functions.');
  console.log('Merged coverage report: ' + path.join(MERGED_DIR, 'index.html'));
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { mergeCoverageInputs, enforceCombinedThresholds };
