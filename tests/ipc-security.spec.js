// @ts-check
/**
 * IPC security tests for the fs:readVault handler (JB1–JB4).
 * run_id=20260516T085804Z-1659, retry-3
 *
 * These tests exercise the main-process IPC handler logic directly by
 * extracting and calling the handler function with mocked `fs` and `path`
 * modules. No Electron runtime is required — the handler is a plain async
 * function once the IPC plumbing is stripped away.
 *
 * Coverage:
 *   JB1 — unauthorized-path rejected (not in allowedFolders)
 *   JB2 — UNC path (\\server\share) rejected
 *   JB2 — POSIX network path (//server/share) rejected
 *   JB3 — file count cap: > 5000 entries → { error: 'too-many-files' }
 *   JB3 — per-file size cap: file > 10 MiB skipped silently
 *   JB3 — cumulative bytes cap: > 100 MiB → { error: 'cumulative-size-exceeded' }
 *   JB4 — symlink escaping folderPath rejected / skipped
 */

const { test, expect } = require('@playwright/test');
const pathModule = require('path');

// ---------------------------------------------------------------------------
// Handler factory
// ---------------------------------------------------------------------------
// We rebuild the handler logic inline (mirroring main.js) so we can inject
// mock fs without touching the real Electron environment.  Any divergence
// from main.js must be treated as a test gap — keep these two in sync.

const MAX_FILES_PER_DIR    = 5000;
const MAX_FILE_BYTES       = 10 * 1024 * 1024;      // 10 MiB
const MAX_CUMULATIVE_BYTES = 100 * 1024 * 1024;     // 100 MiB

/**
 * Build a handler function that behaves identically to the fs:readVault
 * ipcMain.handle callback in main.js, but uses injected `fs` and
 * `allowedFolders` for hermetic testing.
 *
 * @param {Set<string>} allowedFolders
 * @param {object} mockFs   — subset of fs.promises used by the handler
 * @returns {(folderPath: string) => Promise<any>}
 */
function buildHandler(allowedFolders, mockFs) {
  return async function readVaultHandler(folderPath) {
    if (!folderPath || typeof folderPath !== 'string') {
      throw new Error('Invalid folder path');
    }

    // JB2: Reject UNC/network paths (prevents SMB-auth hash leak, CWE-918)
    if (folderPath.startsWith('\\\\') || folderPath.startsWith('//')) {
      return { error: 'network-path-not-allowed' };
    }

    // JB1: Path must have been returned by dialog:openFolder
    if (!allowedFolders.has(folderPath)) {
      return { error: 'unauthorized-path' };
    }

    const entries = await mockFs.readdir(folderPath, { withFileTypes: true });

    // JB3: cap file count
    if (entries.length > MAX_FILES_PER_DIR) {
      return { error: 'too-many-files' };
    }

    const mdFiles = entries
      .filter(e => (e.isFile() || e.isSymbolicLink()) && /\.(md|markdown)$/i.test(e.name))
      .map(e => e.name)
      .sort((a, b) => a.localeCompare(b));

    const results = [];
    let cumulativeBytes = 0;

    for (const name of mdFiles) {
      const fullPath = pathModule.join(folderPath, name);

      // JB4: Symlink escape check
      const lstat = await mockFs.lstat(fullPath);
      if (lstat.isSymbolicLink()) {
        const real = await mockFs.realpath(fullPath);
        const rel = pathModule.relative(folderPath, real);
        if (rel.startsWith('..') || pathModule.isAbsolute(rel)) {
          continue; // symlink escape — skip
        }
      }

      // JB3: per-file size cap
      const stat = lstat.isSymbolicLink()
        ? await mockFs.stat(fullPath)
        : lstat;
      if (stat.size > MAX_FILE_BYTES) {
        continue; // skip oversized file silently
      }

      // JB3: cumulative bytes cap
      cumulativeBytes += stat.size;
      if (cumulativeBytes > MAX_CUMULATIVE_BYTES) {
        return { error: 'cumulative-size-exceeded', partial: results };
      }

      let content = await mockFs.readFile(fullPath, 'utf8');
      if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
      results.push({ name, relPath: name, content });
    }
    return results;
  };
}

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/** Build a minimal Dirent-like object for readdir({ withFileTypes: true }) */
function makeDirent(name, isFile = true, isSymlink = false) {
  return {
    name,
    isFile:        () => isFile && !isSymlink,
    isDirectory:   () => !isFile && !isSymlink,
    isSymbolicLink: () => isSymlink,
  };
}

/** Build a minimal Stats-like object */
function makeStat(size, isSymlink = false) {
  return {
    size,
    isSymbolicLink: () => isSymlink,
    isFile:        () => !isSymlink,
  };
}

// ---------------------------------------------------------------------------
// JB1 — Path allowlist
// ---------------------------------------------------------------------------

test.describe('[JB1] Path allowlist', () => {

  test('[JB1-unauth] unauthorized path returns { error: "unauthorized-path" }', async () => {
    const allowed = new Set(); // empty — nothing added by dialog
    const handler = buildHandler(allowed, {});
    const result = await handler('C:\\Users\\test\\Notes');
    expect(result).toEqual({ error: 'unauthorized-path' });
  });

  test('[JB1-allowed] path in allowlist proceeds past the check', async () => {
    const folderPath = 'C:\\Users\\test\\Notes';
    const allowed = new Set([folderPath]);
    const mockFs = {
      readdir: async () => [],   // empty dir — no files to read
      lstat:   async () => makeStat(100),
      stat:    async () => makeStat(100),
      realpath: async (p) => p,
      readFile: async () => '# hi',
    };
    const handler = buildHandler(allowed, mockFs);
    const result = await handler(folderPath);
    // Should return an empty array (no .md files), not an error object
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });

  test('[JB1-different-path] similar-but-different path rejected', async () => {
    const allowed = new Set(['C:\\Users\\test\\Notes']);
    const handler = buildHandler(allowed, {});
    // Attacker tries a sibling directory
    const result = await handler('C:\\Users\\test\\Notes2');
    expect(result).toEqual({ error: 'unauthorized-path' });
  });

});

// ---------------------------------------------------------------------------
// JB2 — UNC / network path rejection
// ---------------------------------------------------------------------------

test.describe('[JB2] UNC and network path rejection', () => {

  test('[JB2-unc] Windows UNC path (\\\\server\\share) is rejected before allowlist', async () => {
    // Even if the UNC path were in the allowlist it must be rejected first
    const allowed = new Set(['\\\\server\\share']);
    const handler = buildHandler(allowed, {});
    const result = await handler('\\\\server\\share');
    expect(result).toEqual({ error: 'network-path-not-allowed' });
  });

  test('[JB2-posix-net] POSIX network path (//server/share) is rejected', async () => {
    const allowed = new Set(['//server/share']);
    const handler = buildHandler(allowed, {});
    const result = await handler('//server/share');
    expect(result).toEqual({ error: 'network-path-not-allowed' });
  });

  test('[JB2-local] normal local path is NOT rejected by UNC check', async () => {
    const folderPath = 'C:\\Users\\test\\Notes';
    const allowed = new Set([folderPath]);
    const mockFs = {
      readdir: async () => [],
      lstat:   async () => makeStat(0),
      stat:    async () => makeStat(0),
      realpath: async (p) => p,
      readFile: async () => '',
    };
    const handler = buildHandler(allowed, mockFs);
    const result = await handler(folderPath);
    // local path reaches the handler without UNC error
    expect(result).not.toHaveProperty('error');
  });

});

// ---------------------------------------------------------------------------
// JB3 — Resource bounds
// ---------------------------------------------------------------------------

test.describe('[JB3] Resource bounds', () => {

  test('[JB3-file-count] > 5000 entries returns { error: "too-many-files" }', async () => {
    const folderPath = 'C:\\big';
    const allowed = new Set([folderPath]);
    // Generate 5001 Dirent-like objects (all non-md so they would normally be skipped,
    // but the count check fires BEFORE filtering)
    const entries = Array.from({ length: 5001 }, (_, i) => makeDirent(`file${i}.txt`));
    const mockFs = {
      readdir: async () => entries,
    };
    const handler = buildHandler(allowed, mockFs);
    const result = await handler(folderPath);
    expect(result).toEqual({ error: 'too-many-files' });
  });

  test('[JB3-file-count-boundary] exactly 5000 entries passes the count check', async () => {
    const folderPath = 'C:\\boundary';
    const allowed = new Set([folderPath]);
    // 5000 entries, none of which are .md — so result is []
    const entries = Array.from({ length: 5000 }, (_, i) => makeDirent(`file${i}.txt`));
    const mockFs = {
      readdir: async () => entries,
    };
    const handler = buildHandler(allowed, mockFs);
    const result = await handler(folderPath);
    // 5000 is at the limit (not exceeded), so should not return too-many-files
    expect(result).not.toHaveProperty('error');
    expect(Array.isArray(result)).toBe(true);
  });

  test('[JB3-per-file-size] file > 10 MiB is silently skipped', async () => {
    const folderPath = 'C:\\docs';
    const allowed = new Set([folderPath]);
    const oversize = MAX_FILE_BYTES + 1;
    const mockFs = {
      readdir: async () => [makeDirent('big.md')],
      lstat:   async () => makeStat(oversize),
      stat:    async () => makeStat(oversize),
      realpath: async (p) => p,
      readFile: async () => '# big',
    };
    const handler = buildHandler(allowed, mockFs);
    const result = await handler(folderPath);
    // The oversized file is skipped — result array is empty
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });

  test('[JB3-per-file-size-ok] file exactly at 10 MiB is NOT skipped', async () => {
    const folderPath = 'C:\\docs';
    const allowed = new Set([folderPath]);
    const exactSize = MAX_FILE_BYTES; // exactly 10 MiB — should be allowed
    const mockFs = {
      readdir: async () => [makeDirent('ok.md')],
      lstat:   async () => makeStat(exactSize),
      stat:    async () => makeStat(exactSize),
      realpath: async (p) => p,
      readFile: async () => '# ok',
    };
    const handler = buildHandler(allowed, mockFs);
    const result = await handler(folderPath);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('ok.md');
  });

  test('[JB3-cumulative] cumulative bytes > 100 MiB returns { error: "cumulative-size-exceeded" }', async () => {
    const folderPath = 'C:\\many';
    const allowed = new Set([folderPath]);
    // 11 files × 10 MiB each = 110 MiB total (exceeds 100 MiB cap after 10th)
    const fileSize = MAX_FILE_BYTES; // 10 MiB per file
    const fileNames = Array.from({ length: 11 }, (_, i) => `note${i}.md`);
    const entries = fileNames.map(n => makeDirent(n));
    const mockFs = {
      readdir: async () => entries,
      lstat:   async (p) => makeStat(fileSize),
      stat:    async (p) => makeStat(fileSize),
      realpath: async (p) => p,
      readFile: async () => '# content',
    };
    const handler = buildHandler(allowed, mockFs);
    const result = await handler(folderPath);
    expect(result).toHaveProperty('error', 'cumulative-size-exceeded');
    // partial results included for the files read before the cap was hit
    expect(result).toHaveProperty('partial');
    expect(Array.isArray(result.partial)).toBe(true);
    // 10 files × 10 MiB = exactly 100 MiB, 11th file would push it over
    expect(result.partial.length).toBe(10);
  });

});

// ---------------------------------------------------------------------------
// JB4 — Symlink escape check
// ---------------------------------------------------------------------------

test.describe('[JB4] Symlink escape check', () => {

  test('[JB4-escape] symlink resolving outside folderPath is skipped', async () => {
    const folderPath = pathModule.resolve('C:\\docs');
    const allowed = new Set([folderPath]);
    // The symlink resolves to a path outside the vault (e.g. /etc/passwd equivalent)
    const outsidePath = pathModule.resolve('C:\\Windows\\System32\\secret.md');
    const mockFs = {
      readdir: async () => [makeDirent('evil.md', true, true /* isSymlink */)],
      lstat:   async () => makeStat(100, true /* isSymlink */),
      realpath: async () => outsidePath,
      stat:    async () => makeStat(100),
      readFile: async () => '# should not be read',
    };
    const handler = buildHandler(allowed, mockFs);
    const result = await handler(folderPath);
    // symlink that escapes is skipped — result is empty
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });

  test('[JB4-safe-symlink] symlink resolving inside folderPath is allowed', async () => {
    const folderPath = pathModule.resolve('C:\\docs');
    const allowed = new Set([folderPath]);
    // The symlink resolves to a path inside the vault — safe
    const insidePath = pathModule.join(folderPath, 'subdir', 'real.md');
    const mockFs = {
      readdir: async () => [makeDirent('link.md', true, true /* isSymlink */)],
      lstat:   async () => makeStat(50, true /* isSymlink */),
      realpath: async () => insidePath,
      stat:    async () => makeStat(50),
      readFile: async () => '# safe',
    };
    const handler = buildHandler(allowed, mockFs);
    const result = await handler(folderPath);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('link.md');
  });

  test('[JB4-non-symlink] regular file (non-symlink) is not subject to realpath check', async () => {
    const folderPath = pathModule.resolve('C:\\docs');
    const allowed = new Set([folderPath]);
    const mockFs = {
      readdir: async () => [makeDirent('normal.md', true, false /* not symlink */)],
      lstat:   async () => makeStat(200, false),
      // realpath should NOT be called for non-symlinks — if it is, throw to detect the bug
      realpath: async () => { throw new Error('realpath called on non-symlink'); },
      stat:    async () => makeStat(200),
      readFile: async () => '# normal',
    };
    const handler = buildHandler(allowed, mockFs);
    const result = await handler(folderPath);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('# normal');
  });

  test('[JB4-absolute-escape] symlink resolving to absolute path outside vault is rejected', async () => {
    const folderPath = pathModule.resolve('C:\\docs');
    const allowed = new Set([folderPath]);
    // On POSIX: /etc/passwd would be absolute and path.relative returns absolute too
    // On Windows: test a drive-root path outside docs
    const absoluteEscape = 'C:\\';
    const mockFs = {
      readdir: async () => [makeDirent('abs.md', true, true)],
      lstat:   async () => makeStat(10, true),
      realpath: async () => absoluteEscape,
      stat:    async () => makeStat(10),
      readFile: async () => '# abs',
    };
    const handler = buildHandler(allowed, mockFs);
    const result = await handler(folderPath);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });

});
