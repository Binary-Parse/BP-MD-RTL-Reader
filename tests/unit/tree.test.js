/**
 * tree.test.js — T-F1 pure folder-tree builder.
 */
import { describe, test, expect } from 'vitest';
import { buildFileTree, flattenTree } from '../../src/renderer/tree.js';

describe('buildFileTree', () => {
  test('flat files → root children', () => {
    const t = buildFileTree([{ relPath: 'b.md' }, { relPath: 'a.md' }]);
    expect(t.children.map(c => c.name)).toEqual(['a.md', 'b.md']);
    expect(t.children.every(c => c.type === 'file')).toBe(true);
  });

  test('nested paths create directories', () => {
    const t = buildFileTree([
      { relPath: 'essays/on-reading.md', fileIdx: 0 },
      { relPath: 'essays/quiet.md', fileIdx: 1 },
      { relPath: 'root.md', fileIdx: 2 },
    ]);
    const names = t.children.map(c => `${c.type}:${c.name}`);
    expect(names).toEqual(['dir:essays', 'file:root.md']); // dirs before files
    const essays = t.children.find(c => c.name === 'essays');
    expect(essays.children.map(c => c.name)).toEqual(['on-reading.md', 'quiet.md']);
  });

  test('deep nesting + fileIdx preserved', () => {
    const t = buildFileTree([{ relPath: 'a/b/c.md', fileIdx: 7 }]);
    const c = t.children[0].children[0].children[0];
    expect(c).toMatchObject({ type: 'file', name: 'c.md', fileIdx: 7, path: 'a/b/c.md' });
  });

  test('backslash paths normalized', () => {
    const t = buildFileTree([{ relPath: 'sub\\x.md' }]);
    expect(t.children[0].type).toBe('dir');
    expect(t.children[0].name).toBe('sub');
  });
});

describe('flattenTree', () => {
  test('respects collapsed dirs', () => {
    const t = buildFileTree([{ relPath: 'd/x.md' }, { relPath: 'd/y.md' }, { relPath: 'z.md' }]);
    const open = flattenTree(t).map(n => `${n.type}:${n.name}@${n.depth}`);
    expect(open).toEqual(['dir:d@0', 'file:x.md@1', 'file:y.md@1', 'file:z.md@0']);
    const collapsed = flattenTree(t, new Set(['d'])).map(n => n.name);
    expect(collapsed).toEqual(['d', 'z.md']); // children of d hidden
  });
});
