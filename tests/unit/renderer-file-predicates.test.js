/**
 * renderer-file-predicates.test.js — T-B10 (renderer side).
 * The renderer loads raw ES modules under the strict CSP and cannot require() the
 * CommonJS main-logic, so the drag-drop predicate lives in its own ESM module.
 * (Vault membership is decided by vaultId, not extension, so the renderer has no
 * isVaultFile.)
 */
import { describe, test, expect } from 'vitest';
import { isDroppableFile } from '../../src/renderer/file-predicates.js';

describe('isDroppableFile (renderer)', () => {
  test('accepts .md/.markdown/.txt (case-insensitive), rejects others', () => {
    expect(isDroppableFile('a.md')).toBe(true);
    expect(isDroppableFile('a.MARKDOWN')).toBe(true);
    expect(isDroppableFile('notes.txt')).toBe(true);
    expect(isDroppableFile('a.pdf')).toBe(false);
    expect(isDroppableFile('a.md.exe')).toBe(false);
    expect(isDroppableFile(42)).toBe(false);
    expect(isDroppableFile(null)).toBe(false);
    // type guard: a non-string that COERCES to a matching name is still rejected
    expect(isDroppableFile(['a.txt'])).toBe(false);
  });
});
