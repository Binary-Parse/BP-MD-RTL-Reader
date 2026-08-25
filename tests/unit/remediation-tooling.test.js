import { afterEach, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { evaluateTiers, mutationScore } = require('../../scripts/check-mutation-tiers.js');
const { writeCoverageMetadata, loadCoverageInput } = require('../../scripts/coverage-metadata.js');
const { loadExpectedFiles, collectSourceFiles } = require('../../scripts/generate-renderer-coverage.js');
const { verifyPackageEntries, REQUIRED } = require('../../scripts/verify-package-contents.js');
const { fingerprint, countByRule, compareBaseline } = require('../../scripts/run-security-lint.js');
const {
  unmaskNodeModules, scannedBytes, partitionFindings,
} = require('../../scripts/audit-secrets-fulltree.js');

const temporary = [];
afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
  delete process.env.GITHUB_SHA;
});

describe('remediation build and test gates', () => {
  test('mutation score counts survivors and no-coverage mutants as undetected', () => {
    const mutants = ['Killed', 'TimedOut', 'Survived', 'NoCoverage'].map(status => ({ status }));
    expect(mutationScore(mutants)).toBe(50);
  });

  test('tier evaluation fails missing full-run files and below-tier scores', () => {
    const tiers = { T1: { minimum: 85, files: ['secure.js', 'missing.js'] } };
    const report = {
      files: { 'secure.js': { mutants: [{ status: 'Killed' }, { status: 'Survived' }] } }
    };
    const result = evaluateTiers(report, tiers);
    expect(result.failures).toEqual([
      'T1 secure.js: 50.00% < 85%',
      'T1 missing mutation result: missing.js'
    ]);
  });

  test('renderer coverage manifest exactly matches every renderer JavaScript source', () => {
    expect(loadExpectedFiles()).toEqual(collectSourceFiles(path.resolve('src/renderer')));
  });

  test('coverage inputs require current-commit metadata and non-empty data', () => {
    process.env.GITHUB_SHA = 'test-commit';
    const directory = mkdtempSync(path.join(tmpdir(), 'bpmd-coverage-'));
    temporary.push(directory);
    const coveragePath = path.join(directory, 'coverage-final.json');
    writeFileSync(coveragePath, JSON.stringify({ '/source.js': { path: '/source.js' } }));
    writeCoverageMetadata(directory, 'unit', { sourceFiles: 1 });
    expect(loadCoverageInput(coveragePath, 'unit').metadata.commit).toBe('test-commit');
    const metadataPath = path.join(directory, 'run-metadata.json');
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
    metadata.commit = 'stale-commit';
    writeFileSync(metadataPath, JSON.stringify(metadata));
    expect(() => loadCoverageInput(coveragePath, 'unit')).toThrow(/Stale coverage commit/);
  });

  test('package verification requires license inventory and rejects test payloads', () => {
    expect(verifyPackageEntries(REQUIRED.map(file => '\\' + file.replaceAll('/', '\\')))).toEqual([]);
    expect(verifyPackageEntries([...REQUIRED, 'tests/fixture.js'])).toEqual([
      'forbidden packaged path tests/fixture.js'
    ]);
  });

  test('mutation tiers cover the configured mutation scope exactly once', () => {
    const stryker = JSON.parse(readFileSync(path.resolve('stryker.config.json'), 'utf8'));
    const tiers = JSON.parse(readFileSync(path.resolve('config/mutation-tiers.json'), 'utf8'));
    const tierFiles = Object.values(tiers).flatMap(tier => tier.files);
    expect(new Set(tierFiles).size).toBe(tierFiles.length);
    expect(tierFiles.slice().sort()).toEqual(stryker.mutate.slice().sort());
    expect(stryker.tsconfigFile).toBe('config/stryker-javascript-project-no-tsconfig.json');
  });

  test('security lint baseline rejects new or moved findings', () => {
    const findings = [{ file: 'a.js', line: 1, column: 2, severity: 1, rule: 'security/example', fatal: false }];
    const baseline = {
      expectedTotal: 1,
      fingerprintSha256: fingerprint(findings),
      countsByRule: countByRule(findings),
    };
    expect(compareBaseline(findings, baseline)).toEqual([]);
    expect(compareBaseline([...findings, { ...findings[0], line: 2 }], baseline)).not.toEqual([]);
    expect(compareBaseline([{ ...findings[0], line: 3 }], baseline)).not.toEqual([]);
  });

  test('full-tree secret audit drops only the node_modules allowlist entry', () => {
    const config = [
      '[allowlist]',
      '  paths = [',
      "    '''(?:^|/)node_modules(?:/.*)?$''',",
      "    '''(?:^|/)gradlew$''',",
      '  ]',
    ].join('\n');
    const stripped = unmaskNodeModules(config);
    expect(stripped.removed).toBe(1);
    expect(stripped.body).not.toMatch(/node_modules/);
    expect(stripped.body).toMatch(/gradlew/);
  });

  test('full-tree secret audit reads the scanned byte count so an empty scan fails closed', () => {
    expect(scannedBytes('INF scanned ~393264906 bytes (393.26 MB) in 20.8s')).toBe(393264906);
    expect(scannedBytes('INF scanned ~0 bytes (0) in 7.5ms')).toBe(0);
    expect(scannedBytes('no byte count in this output')).toBeNull();
  });

  test('full-tree secret audit gates on first-party findings only', () => {
    const { firstParty, thirdParty } = partitionFindings([
      { File: 'node_modules/pkijs/build/index.js' },
      { File: 'node_modules\\@peculiar\\webcrypto\\build\\webcrypto.js' },
      { File: 'src/main/index.js' },
    ]);
    expect(firstParty.map((f) => f.File)).toEqual(['src/main/index.js']);
    expect(thirdParty).toHaveLength(2);
  });
});
