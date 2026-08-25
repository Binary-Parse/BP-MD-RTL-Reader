/**
 * tree.test.js — T-F1 pure folder-tree builder.
 */
import { describe, test, expect } from 'vitest';
import { buildFileTree, flattenTree, buildForest } from '../../src/renderer/components/tree.js';

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

  // B2 (multi-folder workspaces): a forest's root nodes must expand/collapse the same
  // way a directory does — proves flattenTree's new 'root' clause without needing buildForest.
  test('a root-type node behaves like a dir: expands by default, hides children when collapsed', () => {
    const forest = {
      name: '', path: '', type: 'dir',
      children: [{ type: 'root', id: 'cap-a', name: 'Alpha', path: '@cap-a', children: [
        { type: 'file', name: 'note.md', path: '@cap-a/note.md', fileIdx: 0 },
      ] }],
    };
    const open = flattenTree(forest).map(n => `${n.type}:${n.name}@${n.depth}`);
    expect(open).toEqual(['root:Alpha@0', 'file:note.md@1']);
    const collapsed = flattenTree(forest, new Set(['@cap-a'])).map(n => n.name);
    expect(collapsed).toEqual(['Alpha']);
  });

  // B4: the renderer needs the vault id on a root row to wire its close button.
  test('a root row carries its vaultId, so the renderer can wire a close affordance to it', () => {
    const forest = {
      name: '', path: '', type: 'dir',
      children: [{ type: 'root', id: 'cap-a', name: 'Alpha', path: '@cap-a', children: [] }],
    };
    expect(flattenTree(forest)[0].id).toBe('cap-a');
  });
});

describe('buildForest', () => {
  test('groups entries by vaultId into named roots, each with its own dir/file tree', () => {
    const forest = buildForest(
      [
        { relPath: 'a/one.md', fileIdx: 0, vaultId: 'cap-a' },
        { relPath: 'two.md', fileIdx: 1, vaultId: 'cap-a' },
        { relPath: 'three.md', fileIdx: 2, vaultId: 'cap-b' },
      ],
      new Map([['cap-a', 'Alpha'], ['cap-b', 'Beta']]),
    );
    expect(forest.children.map((r) => `${r.type}:${r.name}`)).toEqual(['root:Alpha', 'root:Beta']);
    const alpha = forest.children.find((r) => r.id === 'cap-a');
    expect(alpha.path).toBe('@cap-a');
    expect(alpha.children.map((c) => `${c.type}:${c.name}`)).toEqual(['dir:a', 'file:two.md']);
  });

  test('descendant paths are prefixed with @<vaultId>/, so two folders sharing a subfolder name never collide', () => {
    const forest = buildForest(
      [
        { relPath: 'notes/todo.md', vaultId: 'cap-a' },
        { relPath: 'notes/todo.md', vaultId: 'cap-b' },
      ],
      new Map([['cap-a', 'A'], ['cap-b', 'B']]),
    );
    const rootA = forest.children.find((r) => r.id === 'cap-a');
    const rootB = forest.children.find((r) => r.id === 'cap-b');
    const dirPath = (root) => root.children.find((c) => c.name === 'notes').path;
    expect(dirPath(rootA)).toBe('@cap-a/notes');
    expect(dirPath(rootB)).toBe('@cap-b/notes');
    expect(dirPath(rootA)).not.toBe(dirPath(rootB));
  });

  test('roots sort alphabetically by display name', () => {
    const forest = buildForest(
      [{ relPath: 'x.md', vaultId: 'cap-z' }, { relPath: 'y.md', vaultId: 'cap-a' }],
      new Map([['cap-z', 'Zebra'], ['cap-a', 'Alpha']]),
    );
    expect(forest.children.map((r) => r.name)).toEqual(['Alpha', 'Zebra']);
  });

  test('falls back to the raw id as the display name when roots has no entry for it', () => {
    const forest = buildForest([{ relPath: 'x.md', vaultId: 'cap-orphan' }], new Map());
    expect(forest.children[0].name).toBe('cap-orphan');
  });

  test('entries with no vaultId (loose files) are not folded into any root', () => {
    const forest = buildForest(
      [{ relPath: 'a.md', vaultId: 'cap-a' }, { relPath: 'loose.md' }],
      new Map([['cap-a', 'A']]),
    );
    expect(forest.children).toHaveLength(1);
    expect(forest.children[0].id).toBe('cap-a');
  });

  test('an empty vault (no entries yet) still renders as a root with no children', () => {
    const forest = buildForest([], new Map([['cap-empty', 'Empty']]));
    expect(forest.children).toEqual([{ type: 'root', id: 'cap-empty', name: 'Empty', path: '@cap-empty', children: [] }]);
  });
});
