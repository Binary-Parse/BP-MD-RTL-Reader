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
});
