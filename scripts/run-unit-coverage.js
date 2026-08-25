'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const libCoverage = require('istanbul-lib-coverage');
const libReport = require('istanbul-lib-report');
const reports = require('istanbul-reports');
const { writeCoverageMetadata } = require('./coverage-metadata');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'coverage', 'node');
const directOutput = path.join(root, 'coverage', 'direct-unit');
const thresholds = JSON.parse(fs.readFileSync(path.join(root, 'config', 'coverage-thresholds.json'), 'utf8')).unit;
fs.rmSync(output, { recursive: true, force: true });
fs.rmSync(directOutput, { recursive: true, force: true });

const vitestManifestPath = require.resolve('vitest/package.json');
const vitestManifest = require(vitestManifestPath);
const vitestCli = path.join(path.dirname(vitestManifestPath), vitestManifest.bin.vitest);
const thresholdOverrides = [
  '--coverage.thresholds.statements=0', '--coverage.thresholds.branches=0',
  '--coverage.thresholds.functions=0', '--coverage.thresholds.lines=0',
];

function runVitest(arguments_) {
  const result = spawnSync(process.execPath, [vitestCli, ...arguments_], {
    cwd: root, stdio: 'inherit', shell: false,
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

// Run the complete suite first. Thresholds are enforced after the isolated
// CommonJS shard is merged, not disabled: Vitest 4 otherwise overwrites direct
// module coverage with the lower-hit instance loaded transitively by src/main/index.js.
runVitest([
  'run', '--config', 'vitest.config.js', '--coverage', '--no-file-parallelism',
  ...thresholdOverrides,
]);

const directTests = [
  'tests/unit/main-logic.test.js', 'tests/unit/capabilities.test.js',
  'tests/unit/context-menu.test.js', 'tests/unit/document-store.test.js',
  'tests/unit/navigation.test.js', 'tests/unit/protocol.test.js',
  'tests/unit/settings.test.js', 'tests/unit/version.test.js',
];
runVitest([
  'run', ...directTests, '--config', 'vitest.config.js', '--coverage',
  '--coverage.reportsDirectory=' + directOutput, '--coverage.reporter=json',
  '--no-file-parallelism', ...thresholdOverrides,
]);

const coveragePath = path.join(output, 'coverage-final.json');
if (!fs.existsSync(coveragePath)) throw new Error('Vitest did not produce coverage-final.json');
const directCoveragePath = path.join(directOutput, 'coverage-final.json');
if (!fs.existsSync(directCoveragePath)) throw new Error('Vitest did not produce isolated CommonJS coverage');
const coverage = JSON.parse(fs.readFileSync(coveragePath, 'utf8'));
const directCoverage = JSON.parse(fs.readFileSync(directCoveragePath, 'utf8'));
if (Object.keys(coverage).length === 0) throw new Error('Vitest produced an empty coverage map');

const directSources = [
  'src/main/main-logic.js', 'src/main/capabilities.js', 'src/main/context-menu.js',
  'src/main/document-store.js', 'src/main/navigation.js', 'src/main/protocol.js',
  'src/main/settings.js', 'src/main/version.js',
];
const coverageMap = libCoverage.createCoverageMap(coverage);
for (const suffix of directSources) {
  const file = Object.keys(directCoverage).find(candidate => candidate.replaceAll('\\', '/').endsWith(suffix));
  if (!file) throw new Error('Missing direct-module coverage for ' + suffix);
  coverageMap.merge({ [file]: directCoverage[file] });
}

const summary = coverageMap.getCoverageSummary().toJSON();
const failures = [];
for (const metric of ['statements', 'branches', 'functions', 'lines']) {
  if (summary[metric].pct < thresholds[metric]) {
    failures.push(metric + ' ' + summary[metric].pct + '% < ' + thresholds[metric] + '%');
  }
}
if (failures.length) throw new Error('Unit coverage gate failed: ' + failures.join('; '));

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
const context = libReport.createContext({ dir: output, coverageMap });
for (const reporter of ['text', 'json', 'html', 'lcovonly']) reports.create(reporter).execute(context);
fs.rmSync(directOutput, { recursive: true, force: true });
writeCoverageMetadata(output, 'unit', {
  sourceFiles: coverageMap.files().length,
  statements: summary.statements.pct,
  branches: summary.branches.pct,
  functions: summary.functions.pct,
  lines: summary.lines.pct,
});
console.log('Unit coverage gate passed: ' + summary.statements.pct + '% statements / '
  + summary.branches.pct + '% branches / ' + summary.functions.pct + '% functions / '
  + summary.lines.pct + '% lines.');
