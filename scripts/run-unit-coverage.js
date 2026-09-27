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

// GATE-01 (2026-09-26): modules whose direct unit tests collide with a transitive load
// (through src/main/index.js OR through each other) get their own ISOLATED shard run —
// a shared shard still lets one test file's instance overwrite another's counts.
const directShards = [
  {
    tests: [
      'tests/unit/main-logic.test.js', 'tests/unit/capabilities.test.js',
      'tests/unit/context-menu.test.js', 'tests/unit/document-store.test.js',
      'tests/unit/navigation.test.js', 'tests/unit/protocol.test.js',
      'tests/unit/settings.test.js', 'tests/unit/version.test.js',
    ],
    sources: [
      'src/main/main-logic.js', 'src/main/capabilities.js', 'src/main/context-menu.js',
      'src/main/document-store.js', 'src/main/navigation.js', 'src/main/protocol.js',
      'src/main/settings.js', 'src/main/version.js',
    ],
  },
  {
    tests: ['tests/unit/json-store.test.js'],
    sources: ['src/main/json-store.js'],
  },
  {
    tests: ['tests/unit/annotations-store.test.js'],
    sources: ['src/main/annotations-store.js'],
  },
  {
    tests: ['tests/unit/reading-stats-store.test.js'],
    sources: ['src/main/reading-stats-store.js'],
  },
  {
    tests: ['tests/unit/github-tls.test.js'],
    sources: ['src/main/github-tls.js'],
  },
  {
    tests: ['tests/unit/preload-bridge.test.js'],
    sources: ['src/preload/index.js'],
  },
  {
    tests: ['tests/unit/main-ipc-gate-coverage.test.js'],
    sources: ['src/main/ipc-controller.js'],
  },
  {
    tests: ['tests/unit/main-window-gate-coverage.test.js'],
    sources: ['src/main/window-controller.js'],
  },
  {
    tests: ['tests/unit/workspace-controller.test.js'],
    sources: ['src/renderer/components/workspace-controller.js'],
  },
];
for (const [index, shard] of directShards.entries()) {
  const shardOutput = path.join(root, 'coverage', `direct-unit-${index}`);
  fs.rmSync(shardOutput, { recursive: true, force: true });
  runVitest([
    'run', ...shard.tests, '--config', 'vitest.config.js', '--coverage',
    `--coverage.reportsDirectory=${shardOutput}`, '--coverage.reporter=json',
    '--no-file-parallelism', ...thresholdOverrides,
  ]);
  shard.dir = shardOutput;
}

const coveragePath = path.join(output, 'coverage-final.json');
if (!fs.existsSync(coveragePath)) throw new Error('Vitest did not produce coverage-final.json');
const coverage = JSON.parse(fs.readFileSync(coveragePath, 'utf8'));
if (Object.keys(coverage).length === 0) throw new Error('Vitest produced an empty coverage map');

const coverageMap = libCoverage.createCoverageMap(coverage);
for (const shard of directShards) {
  const directCoveragePath = path.join(shard.dir, 'coverage-final.json');
  if (!fs.existsSync(directCoveragePath)) throw new Error('Vitest did not produce isolated shard coverage for ' + shard.tests.join(', '));
  const directCoverage = JSON.parse(fs.readFileSync(directCoveragePath, 'utf8'));
  for (const suffix of shard.sources) {
    const file = Object.keys(directCoverage).find(candidate => candidate.replaceAll('\\', '/').endsWith(suffix));
    if (!file) throw new Error('Missing direct-module coverage for ' + suffix);
    coverageMap.merge({ [file]: directCoverage[file] });
  }
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
for (const shard of directShards) fs.rmSync(shard.dir, { recursive: true, force: true });
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
