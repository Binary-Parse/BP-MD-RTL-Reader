/**
 * renderer-file-predicates.test.js — T-B10 (renderer side).
 * The renderer loads raw ES modules under the strict CSP and cannot require() the
 * CommonJS main-logic, so the drag-drop predicate lives in its own ESM module.
 * These cases mirror main-logic's file-predicates.test.js so the two stay in lockstep.
 */
import { describe, test, expect } from 'vitest';
import { isVaultFile, isDroppableFile } from '../../src/renderer/file-predicates.js';

describe('isDroppableFile (renderer)', () => {
  test('accepts .md/.markdown/.txt (case-insensitive), rejects others', () => {
    expect(isDroppableFile('a.md')).toBe(true);
    expect(isDroppableFile('a.MARKDOWN')).toBe(true);
    expect(isDroppableFile('notes.txt')).toBe(true);
    expect(isDroppableFile('a.pdf')).toBe(false);
    expect(isDroppableFile('a.md.exe')).toBe(false);
    expect(isDroppableFile(42)).toBe(false);
    expect(isDroppableFile(null)).toBe(false);
  });
});

describe('isVaultFile (renderer)', () => {
  test('accepts only .md/.markdown — .txt is droppable but NOT a vault note', () => {
    expect(isVaultFile('a.md')).toBe(true);
    expect(isVaultFile('a.markdown')).toBe(true);
    expect(isVaultFile('a.txt')).toBe(false);
    expect(isVaultFile('a.png')).toBe(false);
  });
});
