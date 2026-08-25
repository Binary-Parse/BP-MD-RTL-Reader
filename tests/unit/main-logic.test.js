/**
 * Unit tests for src/main/main-logic.js — pure business logic extracted from src/main/index.js.
 * These tests exercise EVERY branch to survive mutation testing.
 */

import { describe, test, expect, vi } from 'vitest';
import pathModule from 'path';

// Static import so v8 coverage instruments main-logic.js correctly.
// (Previously: `const mainLogic = await import('../../src/main/main-logic.js')`
//  caused v8 to under-count statement/branch coverage by ~10 pp even
//  though mutation score on this file is 100 %.)
import {
  parseFileArg,
  shouldResetChrome,
  isAuthorizedPath,
  isNetworkPath,
  collectAuthorizedFolders,
  collectAuthorizedFiles,
  isTooManyFiles,
  isOversizedFile,
  wouldExceedCumulative,
  isSymlinkEscape,
  stripBOM,
  isVaultFile,
  isDroppableFile,
  filterAndSortMdFiles,
  MAX_OPEN_FILE_BYTES,
  MAX_FILES_PER_DIR,
  MAX_FILE_BYTES,
  MAX_CUMULATIVE_BYTES,
} from '../../src/main/main-logic.js';

// T-B10 file-type predicates. Statically imported here (not via createRequire as the old
// file-predicates.test.js did) so Stryker's per-test coverage actually instruments them —
// these cases exercise every branch to kill the type-guard / anchor / logical-operator mutants.
describe('isVaultFile / isDroppableFile (T-B10)', () => {
  test('isVaultFile: .md/.markdown only, anchored, string-guarded', () => {
    expect(isVaultFile('a.md')).toBe(true);
    expect(isVaultFile('a.MARKDOWN')).toBe(true);
    expect(isVaultFile('a.txt')).toBe(false);
    expect(isVaultFile('a.png')).toBe(false);
    expect(isVaultFile('a.md.bak')).toBe(false);   // extension must be at the END (anchored)
    expect(isVaultFile(['a.md'])).toBe(false);       // non-string that coerces to a match → still false
    expect(isVaultFile(42)).toBe(false);
    expect(isVaultFile(null)).toBe(false);
  });
  test('isDroppableFile: .md/.markdown/.txt, anchored, string-guarded', () => {
    expect(isDroppableFile('a.md')).toBe(true);
    expect(isDroppableFile('notes.txt')).toBe(true);
    expect(isDroppableFile('a.markdown')).toBe(true);
    expect(isDroppableFile('a.pdf')).toBe(false);
    expect(isDroppableFile('a.md.exe')).toBe(false); // anchored
    expect(isDroppableFile(['a.txt'])).toBe(false);   // type guard
    expect(isDroppableFile(42)).toBe(false);
  });
});

describe('parseFileArg()', () => {
  test('rejects UNC and POSIX network paths before filesystem access', () => {
    const fs = { realpathSync: vi.fn(), statSync: vi.fn() };
    expect(parseFileArg(['node', '\\\\server\\note.md'], fs)).toBeNull();
    expect(parseFileArg(['node', '//server/note.md'], fs)).toBeNull();
    expect(fs.realpathSync).not.toHaveBeenCalled();
  });
  test('returns null for empty argv', () => {
    expect(parseFileArg(['node', 'src/main/index.js'], {})).toBeNull();
  });

  test('skips flags starting with -', () => {
    const fs = { realpathSync: vi.fn(), statSync: vi.fn() };
    expect(parseFileArg(['node', 'src/main/index.js', '--inspect', 'file.md'], fs)).toBeNull();
  });

  test('kills mutant: flag check removed → -file.md would be incorrectly processed', () => {
    const fs = {
      realpathSync: vi.fn((p) => p === '-file.md' ? '/abs/-file.md' : p),
      statSync: vi.fn(() => ({ isFile: () => true, size: 100 }))
    };
    // With original code, '-file.md' starts with '-' → skipped → null
    expect(parseFileArg(['node', '-file.md'], fs)).toBeNull();
  });

  test('kills mutant: regex anchor removed → file.md.exe must NOT match', () => {
    const fs = {
      realpathSync: vi.fn(() => '/abs/file.md.exe'),
      statSync: vi.fn(() => ({ isFile: () => true, size: 100 }))
    };
    // Original regex requires .md at END of string
    expect(parseFileArg(['node', 'file.md.exe'], fs)).toBeNull();
  });

  test('skips non-markdown extensions', () => {
    const fs = { realpathSync: vi.fn(), statSync: vi.fn() };
    expect(parseFileArg(['node', 'src/main/index.js', 'file.exe'], fs)).toBeNull();
  });

  test('skips non-string argv entries', () => {
    const fs = { realpathSync: vi.fn(), statSync: vi.fn() };
    expect(parseFileArg(['node', 'src/main/index.js', 123, null], fs)).toBeNull();
  });

  test('returns resolved path for valid .md file', () => {
    const fs = {
      realpathSync: vi.fn(() => '/abs/file.md'),
      statSync: vi.fn(() => ({ isFile: () => true, size: 100 }))
    };
    expect(parseFileArg(['node', 'src/main/index.js', 'file.md'], fs)).toBe('/abs/file.md');
    expect(fs.realpathSync).toHaveBeenCalledWith('file.md');
  });

  test('returns resolved path for .markdown file', () => {
    const fs = {
      realpathSync: vi.fn(() => '/abs/file.markdown'),
      statSync: vi.fn(() => ({ isFile: () => true, size: 100 }))
    };
    expect(parseFileArg(['node', 'src/main/index.js', 'file.markdown'], fs)).toBe('/abs/file.markdown');
  });

  test('rejects .txt (file associations and grantDocument are Markdown-only)', () => {
    const fs = {
      realpathSync: vi.fn(() => '/abs/file.txt'),
      statSync: vi.fn(() => ({ isFile: () => true, size: 100 }))
    };
    expect(parseFileArg(['node', 'src/main/index.js', 'file.txt'], fs)).toBeNull();
  });

  test('skips directories', () => {
    const fs = {
      realpathSync: vi.fn(() => '/abs/dir.md'),
      statSync: vi.fn(() => ({ isFile: () => false, size: 100 }))
    };
    expect(parseFileArg(['node', 'src/main/index.js', 'dir.md'], fs)).toBeNull();
  });

  test('skips oversized files', () => {
    const fs = {
      realpathSync: vi.fn(() => '/abs/huge.md'),
      statSync: vi.fn(() => ({ isFile: () => true, size: MAX_OPEN_FILE_BYTES + 1 }))
    };
    expect(parseFileArg(['node', 'src/main/index.js', 'huge.md'], fs)).toBeNull();
  });

  test('exactly at size limit is allowed', () => {
    const fs = {
      realpathSync: vi.fn(() => '/abs/exact.md'),
      statSync: vi.fn(() => ({ isFile: () => true, size: MAX_OPEN_FILE_BYTES }))
    };
    expect(parseFileArg(['node', 'src/main/index.js', 'exact.md'], fs)).toBe('/abs/exact.md');
  });

  test('handles realpathSync throwing', () => {
    const fs = {
      realpathSync: vi.fn(() => { throw new Error('ENOENT'); }),
      statSync: vi.fn()
    };
    expect(parseFileArg(['node', 'src/main/index.js', 'missing.md'], fs)).toBeNull();
  });

  test('handles statSync throwing', () => {
    const fs = {
      realpathSync: vi.fn(() => '/abs/file.md'),
      statSync: vi.fn(() => { throw new Error('EACCES'); })
    };
    expect(parseFileArg(['node', 'src/main/index.js', 'file.md'], fs)).toBeNull();
  });

  test('returns first valid file among multiple args', () => {
    const fs = {
      realpathSync: vi.fn((p) => `/abs/${p}`),
      statSync: vi.fn((p) => ({
        isFile: () => !p.includes('dir'),
        size: p.includes('huge') ? MAX_OPEN_FILE_BYTES + 1 : 100
      }))
    };
    const result = parseFileArg(['node', 'src/main/index.js', '--flag', 'dir.md', 'valid.md'], fs);
    expect(result).toBe('/abs/valid.md');
  });

  test('case-insensitive extension match', () => {
    const fs = {
      realpathSync: vi.fn(() => '/abs/file.MD'),
      statSync: vi.fn(() => ({ isFile: () => true, size: 100 }))
    };
    expect(parseFileArg(['node', 'src/main/index.js', 'file.MD'], fs)).toBe('/abs/file.MD');
  });
});

describe('isAuthorizedPath() [JB1]', () => {
  test('returns true for allowed folder', () => {
    const allowed = new Set(['/vault']);
    expect(isAuthorizedPath('/vault', allowed)).toBe(true);
  });

  test('returns false for unauthorized folder', () => {
    const allowed = new Set(['/vault']);
    expect(isAuthorizedPath('/etc', allowed)).toBe(false);
  });

  test('returns false for empty allowlist', () => {
    expect(isAuthorizedPath('/vault', new Set())).toBe(false);
  });

  test('returns false for similar but different path', () => {
    const allowed = new Set(['/vault']);
    expect(isAuthorizedPath('/vault2', allowed)).toBe(false);
    expect(isAuthorizedPath('/vault/', allowed)).toBe(false);
  });
});

describe('isNetworkPath() [JB2]', () => {
  test('detects Windows UNC path', () => {
    expect(isNetworkPath('\\\\server\\share')).toBe(true);
  });

  test('detects POSIX network path', () => {
    expect(isNetworkPath('//server/share')).toBe(true);
  });

  test('allows normal local path', () => {
    expect(isNetworkPath('C:\\Users\\vault')).toBe(false);
    expect(isNetworkPath('/home/user/vault')).toBe(false);
  });

  test('allows path with single slash prefix', () => {
    expect(isNetworkPath('/server/share')).toBe(false);
  });

  test('empty string is not a network path', () => {
    expect(isNetworkPath('')).toBe(false);
  });
});

describe('collectAuthorizedFolders() — re-authorize previously-opened vaults on launch', () => {
  test('returns [] for missing / non-object settings', () => {
    expect(collectAuthorizedFolders(null)).toEqual([]);
    expect(collectAuthorizedFolders(undefined)).toEqual([]);
    expect(collectAuthorizedFolders('nope')).toEqual([]);
    expect(collectAuthorizedFolders(42)).toEqual([]);
  });

  test('includes lastSession.vaultPath', () => {
    expect(collectAuthorizedFolders({ lastSession: { vaultPath: 'C:\\vault' } })).toEqual(['C:\\vault']);
  });

  test('includes each recents[].vaultRoot', () => {
    const got = collectAuthorizedFolders({ recents: [{ vaultRoot: '/a' }, { vaultRoot: '/b' }] });
    expect(got).toEqual(['/a', '/b']);
  });

  test('de-duplicates across lastSession + recents', () => {
    const got = collectAuthorizedFolders({
      lastSession: { vaultPath: '/v' },
      recents: [{ vaultRoot: '/v' }, { vaultRoot: '/w' }, { vaultRoot: '/v' }],
    });
    expect(got).toEqual(['/v', '/w']);
  });

  test('excludes network paths (JB2)', () => {
    const got = collectAuthorizedFolders({
      lastSession: { vaultPath: '\\\\server\\share' },
      recents: [{ vaultRoot: '//nas/x' }, { vaultRoot: 'C:\\ok' }],
    });
    expect(got).toEqual(['C:\\ok']);
  });

  test('ignores null / non-string / missing vaultRoot entries', () => {
    const got = collectAuthorizedFolders({
      lastSession: { vaultPath: null },
      recents: [null, { name: 'a.md', path: 'a.md' }, { vaultRoot: '' }, { vaultRoot: 5 }, { vaultRoot: '/good' }],
    });
    expect(got).toEqual(['/good']);
  });

  test('tolerates non-array recents and non-object lastSession', () => {
    expect(collectAuthorizedFolders({ recents: 'nope', lastSession: 'nope' })).toEqual([]);
    expect(collectAuthorizedFolders({})).toEqual([]);
  });
});

describe('collectAuthorizedFiles() — re-authorize previously-opened single files on launch', () => {
  test('returns [] for missing / non-object settings', () => {
    expect(collectAuthorizedFiles(null)).toEqual([]);
    expect(collectAuthorizedFiles(undefined)).toEqual([]);
    expect(collectAuthorizedFiles('nope')).toEqual([]);
  });

  test('collects recents[].abs absolute file paths', () => {
    const got = collectAuthorizedFiles({ recents: [{ abs: 'C:\\docs\\a.md' }, { abs: '/home/b.md' }] });
    expect(got).toEqual(['C:\\docs\\a.md', '/home/b.md']);
  });

  test('de-duplicates and ignores null / non-string / empty abs', () => {
    const got = collectAuthorizedFiles({
      recents: [{ abs: '/a.md' }, { vaultRoot: '/v' }, { abs: '' }, { abs: 7 }, null, { abs: '/a.md' }],
    });
    expect(got).toEqual(['/a.md']);
  });

  test('excludes network paths (JB2)', () => {
    const got = collectAuthorizedFiles({ recents: [{ abs: '\\\\nas\\a.md' }, { abs: '//srv/b.md' }, { abs: 'D:\\ok.md' }] });
    expect(got).toEqual(['D:\\ok.md']);
  });

  test('non-array recents → []', () => {
    expect(collectAuthorizedFiles({ recents: 'nope' })).toEqual([]);
    expect(collectAuthorizedFiles({})).toEqual([]);
  });
});

describe('isTooManyFiles() [JB3]', () => {
  test('returns true above cap', () => {
    expect(isTooManyFiles(MAX_FILES_PER_DIR + 1)).toBe(true);
  });

  test('returns false at cap', () => {
    expect(isTooManyFiles(MAX_FILES_PER_DIR)).toBe(false);
  });

  test('returns false below cap', () => {
    expect(isTooManyFiles(100)).toBe(false);
  });

  test('returns false for zero', () => {
    expect(isTooManyFiles(0)).toBe(false);
  });
});

describe('isOversizedFile() [JB3]', () => {
  test('returns true above cap', () => {
    expect(isOversizedFile(MAX_FILE_BYTES + 1)).toBe(true);
  });

  test('returns false at cap', () => {
    expect(isOversizedFile(MAX_FILE_BYTES)).toBe(false);
  });

  test('returns false below cap', () => {
    expect(isOversizedFile(1024)).toBe(false);
  });
});

describe('wouldExceedCumulative() [JB3]', () => {
  test('returns true when cumulative would exceed', () => {
    expect(wouldExceedCumulative(MAX_CUMULATIVE_BYTES - 10, 20)).toBe(true);
  });

  test('returns false when cumulative stays within limit', () => {
    expect(wouldExceedCumulative(0, MAX_CUMULATIVE_BYTES)).toBe(false);
  });

  test('returns true at exact boundary (strict >)', () => {
    expect(wouldExceedCumulative(MAX_CUMULATIVE_BYTES, 1)).toBe(true);
  });

  test('returns false for zero addition', () => {
    expect(wouldExceedCumulative(0, 0)).toBe(false);
  });
});

describe('isSymlinkEscape() [JB4]', () => {
  const path = pathModule;

  test('detects escape via ..', () => {
    expect(isSymlinkEscape('/outside', '/vault', path)).toBe(true);
  });

  test('allows symlink inside folder', () => {
    expect(isSymlinkEscape('/vault/sub/file.md', '/vault', path)).toBe(false);
  });

  test('detects absolute path escape', () => {
    expect(isSymlinkEscape('/etc/passwd', '/vault', path)).toBe(true);
  });

  test('allows exact folder path', () => {
    expect(isSymlinkEscape('/vault', '/vault', path)).toBe(false);
  });
});

describe('stripBOM()', () => {
  test('strips UTF-8 BOM', () => {
    expect(stripBOM('\uFEFFhello')).toBe('hello');
  });

  test('leaves content without BOM unchanged', () => {
    expect(stripBOM('hello')).toBe('hello');
  });

  test('handles empty string', () => {
    expect(stripBOM('')).toBe('');
  });

  test('strips BOM only at start', () => {
    expect(stripBOM('hello\uFEFFworld')).toBe('hello\uFEFFworld');
  });
});

describe('filterAndSortMdFiles()', () => {
  test('filters only .md and .markdown files', () => {
    const entries = [
      { name: 'a.md', isFile: () => true, isSymbolicLink: () => false },
      { name: 'b.txt', isFile: () => true, isSymbolicLink: () => false },
      { name: 'c.markdown', isFile: () => true, isSymbolicLink: () => false },
    ];
    expect(filterAndSortMdFiles(entries)).toEqual(['a.md', 'c.markdown']);
  });

  test('includes symlinks', () => {
    const entries = [
      { name: 'link.md', isFile: () => false, isSymbolicLink: () => true },
    ];
    expect(filterAndSortMdFiles(entries)).toEqual(['link.md']);
  });

  test('excludes directories', () => {
    const entries = [
      { name: 'dir.md', isFile: () => false, isSymbolicLink: () => false },
    ];
    expect(filterAndSortMdFiles(entries)).toEqual([]);
  });

  test('sorts by localeCompare', () => {
    const entries = [
      { name: 'z.md', isFile: () => true, isSymbolicLink: () => false },
      { name: 'a.md', isFile: () => true, isSymbolicLink: () => false },
    ];
    expect(filterAndSortMdFiles(entries)).toEqual(['a.md', 'z.md']);
  });

  test('case-insensitive extension match', () => {
    const entries = [
      { name: 'a.MD', isFile: () => true, isSymbolicLink: () => false },
      { name: 'b.MarkDown', isFile: () => true, isSymbolicLink: () => false },
    ];
    expect(filterAndSortMdFiles(entries)).toEqual(['a.MD', 'b.MarkDown']);
  });

  test('handles empty entries', () => {
    expect(filterAndSortMdFiles([])).toEqual([]);
  });

  test('kills mutant: regex anchor removed → evil.md.exe must NOT match', () => {
    const entries = [
      { name: 'evil.md.exe', isFile: () => true, isSymbolicLink: () => false },
    ];
    expect(filterAndSortMdFiles(entries)).toEqual([]);
  });
});

describe('parseFileArg() mutant killers', () => {
  test('mutation killer: argv[0] is always skipped (kills L20 slice(1) removal)', () => {
    // Mutant `Array.from(argv)` (no slice) would treat argv[0] as a candidate.
    // Test: pass a valid .md path at index 0. Original skips → null; mutant
    // returns the resolved path.
    const fs = {
      realpathSync: vi.fn(() => '/abs/file.md'),
      statSync: vi.fn(() => ({ isFile: () => true, size: 100 }))
    };
    expect(parseFileArg(['file.md'], fs)).toBeNull();
    expect(fs.realpathSync).not.toHaveBeenCalled();
  });

  test('kills mutant: i <= argv.length with array-like object', () => {
    const fs = {
      realpathSync: vi.fn((p) => `/abs/${p}`),
      statSync: vi.fn(() => ({ isFile: () => true, size: 100 }))
    };
    // Array-like object with length=2 but element 3 exists
    const argv = { 0: 'node', 1: 'src/main/index.js', 2: 'file.md', length: 2 };
    // With i < 2: only checks index 1 ('src/main/index.js') → null
    // With i <= 2: checks index 2 ('file.md') → returns path
    expect(parseFileArg(argv, fs)).toBeNull();
    expect(fs.realpathSync).not.toHaveBeenCalledWith('file.md');
  });
});

describe('constant boundary values', () => {
  test('MAX_OPEN_FILE_BYTES is exactly 10 MiB', () => {
    expect(MAX_OPEN_FILE_BYTES).toBe(10 * 1024 * 1024);
  });

  test('MAX_FILES_PER_DIR is exactly 5000', () => {
    expect(MAX_FILES_PER_DIR).toBe(5000);
  });

  test('MAX_FILE_BYTES is exactly 10 MiB', () => {
    expect(MAX_FILE_BYTES).toBe(10 * 1024 * 1024);
  });

  test('MAX_CUMULATIVE_BYTES is exactly 100 MiB', () => {
    expect(MAX_CUMULATIVE_BYTES).toBe(100 * 1024 * 1024);
  });
});

describe('shouldResetChrome (T-F19 recovery switch)', () => {
  test('true only for the exact flag', () => {
    expect(shouldResetChrome(['electron', '.', '--reset-chrome'])).toBe(true);
    expect(shouldResetChrome(['electron', '--reset-chrome', 'note.md'])).toBe(true);
  });

  test('false for anything else, including near misses', () => {
    expect(shouldResetChrome(['electron', '.'])).toBe(false);
    expect(shouldResetChrome(['electron', '--reset-chrome=1'])).toBe(false);
    expect(shouldResetChrome(['electron', '-reset-chrome'])).toBe(false);
    expect(shouldResetChrome(['electron', '--reset'])).toBe(false);
    expect(shouldResetChrome(['electron', 'reset-chrome'])).toBe(false);
  });

  test('argv[0] is never treated as a flag, matching parseFileArg', () => {
    expect(shouldResetChrome(['--reset-chrome'])).toBe(false);
  });

  test('survives array-likes and non-string members', () => {
    expect(shouldResetChrome({ 0: 'electron', 1: '--reset-chrome', length: 2 })).toBe(true);
    expect(shouldResetChrome(['electron', null, 42, undefined])).toBe(false);
    expect(shouldResetChrome([])).toBe(false);
  });
});
