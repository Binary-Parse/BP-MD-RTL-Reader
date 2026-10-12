import { describe, test, expect } from 'vitest';
import { nextUntitledName } from '../../src/renderer/file-predicates.js';

// audit H10: Ctrl+N named the new note `Untitled-<count of open "Untitled*" files>.md`. After
// closing the first note the count and the surviving names disagreed, so the new tab reused an
// open name: a false "file changed on disk" conflict, and "Reload" wiped the typed text.
// The name is now the FIRST FREE one: Untitled.md, Untitled-1.md, Untitled-2.md, ...
describe('nextUntitledName (audit H10)', () => {
  test.each([
    [[], 'Untitled.md'],
    [['Untitled-1.md'], 'Untitled.md'],
    [['Untitled.md'], 'Untitled-1.md'],
    [['Untitled.md', 'Untitled-2.md'], 'Untitled-1.md'],
    [['Untitled.md', 'Untitled-1.md', 'Untitled-2.md'], 'Untitled-3.md'],
    [['Untitled-2.md', 'Untitled-1.md', 'Untitled.md'], 'Untitled-3.md'],
    [['Untitled-1.md', 'Untitled-2.md'], 'Untitled.md'],
  ])('%j -> %s', (names, expected) => {
    expect(nextUntitledName(names)).toBe(expected);
  });

  test('new, new, close the first, new: three distinct names in a row', () => {
    const open = [];
    open.push(nextUntitledName(open)); // Untitled.md
    open.push(nextUntitledName(open)); // Untitled-1.md
    expect(open).toEqual(['Untitled.md', 'Untitled-1.md']);
    open.splice(open.indexOf('Untitled.md'), 1); // the first tab is closed
    const third = nextUntitledName(open);
    expect(third).toBe('Untitled.md');
    expect(open).not.toContain(third);
    open.push(third);
    expect(new Set(open).size).toBe(2);
    expect(nextUntitledName(open)).toBe('Untitled-2.md');
  });

  test('names are compared case-insensitively (Windows and macOS file systems)', () => {
    expect(nextUntitledName(['UNTITLED.MD'])).toBe('Untitled-1.md');
    expect(nextUntitledName(['untitled.md', 'untitled-1.MD'])).toBe('Untitled-2.md');
  });

  test('other files, look-alikes and junk entries do not take a name', () => {
    expect(nextUntitledName(['notes.md', 'Untitled notes.md', 'Untitled-x.md', 'Untitled.txt', 'my-Untitled.md'])).toBe('Untitled.md');
    expect(nextUntitledName([null, undefined, 42, {}, ''])).toBe('Untitled.md');
  });

  test('accepts any iterable of names, not only arrays', () => {
    expect(nextUntitledName(new Set(['Untitled.md']))).toBe('Untitled-1.md');
    expect(nextUntitledName(new Map([['Untitled.md', 1]]).keys())).toBe('Untitled-1.md');
  });

  test('missing input behaves like no open notes', () => {
    expect(nextUntitledName()).toBe('Untitled.md');
    expect(nextUntitledName(null)).toBe('Untitled.md');
  });

  test('a long run of taken names resolves quickly', () => {
    const names = ['Untitled.md', ...Array.from({ length: 5000 }, (_, i) => `Untitled-${i + 1}.md`)];
    const t0 = performance.now();
    expect(nextUntitledName(names)).toBe('Untitled-5001.md');
    expect(performance.now() - t0).toBeLessThan(500);
  });
});
