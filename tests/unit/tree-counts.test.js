import { describe, test, expect } from 'vitest';
import { buildFileTree, buildForest, treeFileCounts } from '../../src/renderer/components/tree.js';

describe('treeFileCounts', () => {
  test('counts every file under each folder, keyed by path', () => {
    const tree = buildFileTree([
      { name: 'a.md', relPath: 'essays/a.md' },
      { name: 'b.md', relPath: 'essays/b.md' },
      { name: 'c.md', relPath: 'essays/deep/c.md' },
      { name: 'd.md', relPath: 'd.md' },
    ]);
    const counts = treeFileCounts(tree);
    expect(counts.get('essays')).toBe(3);
    expect(counts.get('essays/deep')).toBe(1);
    expect(counts.has('d.md')).toBe(false);
  });

  test('counts a whole root in a forest, including nested folders', () => {
    const forest = buildForest([
      { name: 'a.md', relPath: 'x/a.md', vaultId: 'v1' },
      { name: 'b.md', relPath: 'b.md', vaultId: 'v1' },
      { name: 'c.md', relPath: 'c.md', vaultId: 'v2' },
    ], new Map([['v1', 'One'], ['v2', 'Two']]));
    const counts = treeFileCounts(forest);
    expect(counts.get('@v1')).toBe(2);
    expect(counts.get('@v2')).toBe(1);
    expect(counts.get('@v1/x')).toBe(1);
  });

  test('an empty tree has no counts', () => {
    expect(treeFileCounts(buildFileTree([])).size).toBe(0);
  });
});
