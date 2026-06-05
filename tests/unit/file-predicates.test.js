/**
 * file-predicates.test.js — T-B10 shared file-type predicates.
 */
import { describe, test, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { isVaultFile, isDroppableFile } = require('../../src/main-logic.js');

describe('isVaultFile', () => {
  test('accepts .md/.markdown (case-insensitive), rejects .txt/others', () => {
    expect(isVaultFile('a.md')).toBe(true);
    expect(isVaultFile('a.MARKDOWN')).toBe(true);
    expect(isVaultFile('a.txt')).toBe(false);
    expect(isVaultFile('a.png')).toBe(false);
    expect(isVaultFile(42)).toBe(false);
  });
});

describe('isDroppableFile', () => {
  test('accepts .md/.markdown/.txt, rejects others', () => {
    expect(isDroppableFile('a.md')).toBe(true);
    expect(isDroppableFile('a.txt')).toBe(true);
    expect(isDroppableFile('a.markdown')).toBe(true);
    expect(isDroppableFile('a.pdf')).toBe(false);
  });
});
