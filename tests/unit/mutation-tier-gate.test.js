/**
 * mutation-tier-gate.test.js — audit M30 (and the false green recorded under B7).
 *
 * Requirement: the tier gate passes only on a result that proves each file's score.
 *   - the score is Stryker's own: detected (Killed, Timeout) over detected + undetected
 *     (Survived, NoCoverage); mutants Stryker could not judge are not counted either way;
 *   - a report made from another version of a file proves nothing about the file on disk;
 *   - a file mutated only on some lines (`--mutate file:10-20`) has no file score;
 *   - an unfinished run (Pending mutants) or a file without scored mutants cannot pass;
 *   - `--allow-partial` lets tier files be absent, but not all of them.
 */
import { describe, expect, test } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { evaluateTiers, mutationScore, partlyMutatedFiles } = require('../../scripts/check-mutation-tiers.js');

const mutants = (...statuses) => statuses.map((status) => ({ status }));
const SOURCES = { 'a.js': 'const a = 1;\n', 'b.js': 'const b = 2;\n' };
const readSource = (file) => (Object.hasOwn(SOURCES, file) ? SOURCES[file] : null);
const fileResult = (file, statuses) => ({ source: SOURCES[file], mutants: mutants(...statuses) });
const tiers = { T1: { minimum: 85, files: ['a.js', 'b.js'] } };
const run = (report, options = {}) => evaluateTiers(report, tiers, { readSource, ...options });
const strong = ['Killed', 'Killed', 'Killed', 'Killed', 'Killed', 'Killed', 'Killed', 'Killed', 'Killed', 'Survived']; // 90 %

describe('mutationScore', () => {
  test('a mutant that timed out counts as detected, under the name Stryker writes', () => {
    expect(mutationScore(mutants('Killed', 'Timeout', 'Survived', 'NoCoverage'))).toBe(50);
    expect(mutationScore(mutants('Timeout', 'Timeout'))).toBe(100);
  });

  test('"TimedOut" is not a Stryker status and is not counted', () => {
    expect(mutationScore(mutants('TimedOut', 'Killed', 'Survived'))).toBe(50);
  });

  test('mutants Stryker could not judge are left out of the score, as Stryker does', () => {
    expect(mutationScore(mutants('Killed', 'Survived', 'RuntimeError', 'CompileError', 'Ignored'))).toBe(50);
    expect(mutationScore(mutants('RuntimeError', 'CompileError', 'Survived'))).toBe(0);
  });

  test('survivors and uncovered mutants are undetected', () => {
    expect(mutationScore(mutants('Killed', 'Killed', 'Killed', 'NoCoverage'))).toBe(75);
    expect(mutationScore(mutants('Survived', 'NoCoverage'))).toBe(0);
  });
});

describe('evaluateTiers', () => {
  test('passes when every tier file is reported, current and at its tier', () => {
    const result = run({ files: { 'a.js': fileResult('a.js', strong), 'b.js': fileResult('b.js', strong) } });
    expect(result.failures).toEqual([]);
    expect(result.results).toEqual([
      { tier: 'T1', file: 'a.js', minimum: 85, score: 90 },
      { tier: 'T1', file: 'b.js', minimum: 85, score: 90 },
    ]);
  });

  test('a score at the minimum passes and one below it fails', () => {
    const at = { T1: { minimum: 50, files: ['a.js'] } };
    expect(evaluateTiers({ files: { 'a.js': fileResult('a.js', ['Killed', 'Survived']) } }, at, { readSource }).failures).toEqual([]);
    expect(run({ files: { 'a.js': fileResult('a.js', ['Killed', 'Survived']), 'b.js': fileResult('b.js', strong) } }).failures)
      .toEqual(['T1 a.js: 50.00% < 85%']);
  });

  test('a full run fails for a tier file with no result', () => {
    expect(run({ files: { 'a.js': fileResult('a.js', strong) } }).failures).toEqual(['T1 missing mutation result: b.js']);
    expect(run({}).failures).toEqual(['T1 missing mutation result: a.js', 'T1 missing mutation result: b.js']);
  });

  test('--allow-partial lets a tier file be absent, but not all of them', () => {
    expect(run({ files: { 'a.js': fileResult('a.js', strong) } }, { allowPartial: true }).failures).toEqual([]);
    expect(run({ files: {} }, { allowPartial: true }).failures).toEqual(['the report holds no result for any tier file']);
    expect(run({ files: { 'other.js': { source: 'x', mutants: mutants('Killed') } } }, { allowPartial: true }).failures)
      .toEqual(['the report holds no result for any tier file']);
  });

  test('a report made from another version of the file fails, with or without --allow-partial', () => {
    const stale = { files: { 'a.js': { source: 'const a = 0;\n', mutants: mutants(...strong) }, 'b.js': fileResult('b.js', strong) } };
    const message = 'T1 a.js: the report was made from another version of this file — run Stryker again';
    expect(run(stale).failures).toEqual([message]);
    expect(run(stale, { allowPartial: true }).failures).toEqual([message]);
  });

  test('line endings alone do not make a report stale', () => {
    const crlf = { files: { 'a.js': { source: 'const a = 1;\r\n', mutants: mutants(...strong) }, 'b.js': fileResult('b.js', strong) } };
    expect(run(crlf).failures).toEqual([]);
  });

  test('a result without the source text, or for a file that is gone, fails', () => {
    expect(run({ files: { 'a.js': { mutants: mutants(...strong) }, 'b.js': fileResult('b.js', strong) } }).failures)
      .toEqual(['T1 a.js: the report was made from another version of this file — run Stryker again']);
    const gone = { T1: { minimum: 85, files: ['gone.js'] } };
    expect(evaluateTiers({ files: { 'gone.js': { source: 'x', mutants: mutants(...strong) } } }, gone, { readSource }).failures)
      .toEqual(['T1 gone.js: the report was made from another version of this file — run Stryker again']);
  });

  test('a file mutated only on some lines has no file score', () => {
    const report = {
      config: { mutate: ['a.js:10-20', 'a.js:30-30', 'b.js'] },
      files: { 'a.js': fileResult('a.js', strong), 'b.js': fileResult('b.js', strong) },
    };
    const message = 'T1 a.js: only some lines were mutated (--mutate a.js:10-20) — run Stryker on the whole file';
    expect(run(report).failures).toEqual([message]);
    expect(run(report, { allowPartial: true }).failures).toEqual([message]);
  });

  test('partlyMutatedFiles reads line and column ranges and ignores whole-file patterns', () => {
    expect([...partlyMutatedFiles({ mutate: ['src/a.js:1-2', 'src/b.js', 'src/c.js:3:1-4:9', '!src/d.js', 'src/**/*.js'] })])
      .toEqual([['src/a.js', 'src/a.js:1-2'], ['src/c.js', 'src/c.js:3:1-4:9']]);
    expect(partlyMutatedFiles(undefined).size).toBe(0);
    expect(partlyMutatedFiles({}).size).toBe(0);
    expect(partlyMutatedFiles({ mutate: 'src/a.js:1-2' }).size).toBe(0);
  });

  test('an unfinished run fails', () => {
    const report = { files: { 'a.js': fileResult('a.js', [...strong, 'Pending', 'Pending']), 'b.js': fileResult('b.js', strong) } };
    expect(run(report).failures).toEqual(['T1 a.js: 2 mutants were never run (Pending) — the Stryker run did not finish']);
    const one = { files: { 'a.js': fileResult('a.js', [...strong, 'Pending']), 'b.js': fileResult('b.js', strong) } };
    expect(run(one).failures).toEqual(['T1 a.js: 1 mutant was never run (Pending) — the Stryker run did not finish']);
  });

  test('a file without one scored mutant fails instead of passing at 100 %', () => {
    for (const statuses of [[], ['Ignored'], ['RuntimeError', 'CompileError']]) {
      const report = { files: { 'a.js': fileResult('a.js', statuses), 'b.js': fileResult('b.js', strong) } };
      expect(run(report).failures).toEqual(['T1 a.js: no scored mutants — nothing proves this file']);
    }
    const noList = { files: { 'a.js': { source: SOURCES['a.js'] }, 'b.js': fileResult('b.js', strong) } };
    expect(run(noList).failures).toEqual(['T1 a.js: no scored mutants — nothing proves this file']);
  });

  test('a file that fails a check is not listed among the scored results', () => {
    const stale = { files: { 'a.js': { source: 'old', mutants: mutants(...strong) }, 'b.js': fileResult('b.js', strong) } };
    expect(run(stale).results.map((r) => r.file)).toEqual(['b.js']);
  });

  test('reads the file on disk when no reader is given', () => {
    const real = { T3: { minimum: 60, files: ['scripts/check-mutation-tiers.js'] } };
    const report = { files: { 'scripts/check-mutation-tiers.js': { source: 'not the file', mutants: mutants(...strong) } } };
    expect(evaluateTiers(report, real).failures)
      .toEqual(['T3 scripts/check-mutation-tiers.js: the report was made from another version of this file — run Stryker again']);
    const none = { T3: { minimum: 60, files: ['scripts/does-not-exist.js'] } };
    expect(evaluateTiers({ files: { 'scripts/does-not-exist.js': { source: 'x', mutants: mutants(...strong) } } }, none).failures)
      .toHaveLength(1);
  });
});
