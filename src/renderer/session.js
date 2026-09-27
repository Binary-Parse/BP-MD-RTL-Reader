/**
 * session.js — pure helpers for last-session restore (T-B5 / M6 EXIT).
 *
 * The renderer wires these to the settings bridge: `buildSession` snapshots the open
 * vault + active tab into the persisted `lastSession` shape, and `pickActiveIndex`
 * decides which restored file to re-open on the next launch. Disk re-reads + DOM are
 * the renderer's job; this module stays pure so the logic is unit-tested.
 */

const CAPABILITY_ID = /^cap-/;

/**
 * Build the persisted lastSession from ALL open vaults (audit UX-04: restoring only
 * vaults[0] silently dropped every other open folder). Vaults are derived from the
 * open files themselves; openPaths lists only files actually open as tabs.
 * Returns null when no disk-backed vault has an open file.
 * @param {Array<{path?:string, vaultId?:string, open?:boolean}>} files
 * @param {number|null} activeIndex
 */
export function buildSession(files, activeIndex) {
  if (!Array.isArray(files) || !files.length) return null;
  const byVault = new Map();
  for (const f of files) {
    if (!f || typeof f.vaultId !== 'string' || !CAPABILITY_ID.test(f.vaultId)) continue;
    if (!byVault.has(f.vaultId)) byVault.set(f.vaultId, []);
    byVault.get(f.vaultId).push(f);
  }
  if (!byVault.size) return null;
  const active = activeIndex != null ? files[activeIndex] : null;
  const activePath = active && typeof active.path === 'string' ? active.path : undefined;
  const activeVaultId = active && typeof active.vaultId === 'string' && CAPABILITY_ID.test(active.vaultId)
    ? active.vaultId : undefined;
  const vaults = [];
  for (const [vaultId, vFiles] of byVault) {
    const openPaths = vFiles.filter((f) => f.open !== false)
      .map((f) => f.path).filter((p) => typeof p === 'string');
    if (openPaths.length) vaults.push({ vaultId, openPaths });
  }
  if (!vaults.length) return null;
  return { vaults, activeVaultId, activePath };
}

/**
 * Stable identity for a file across re-renders, used to address tree/tab DOM instead
 * of a splice-fragile array index (B2/B3). Strongest-to-weakest: a vault-scoped path
 * (folder opens) beats a document capability (single-file opens) beats a bare loose path
 * (browser/File System Access API, or any note with no on-disk vault at all) — the
 * `vault:<id> <path>` form is what lets two open folders share a relative path (both
 * have `notes/todo.md`) without colliding, which a bare `name+path` key cannot do.
 * A vault file carries a per-session document capability too (re-granted on every
 * read), so the vault form MUST win or persisted per-file state (highlights, reading
 * progress) keys on an id that changes every launch (DATA-01).
 * @param {{documentId?:string, vaultId?:string, path?:string}} file
 * @returns {string|null}
 */
export function fileKey(file) {
  if (!file) return null;
  if (typeof file.vaultId === 'string' && file.vaultId && typeof file.path === 'string') {
    return `vault:${file.vaultId} ${file.path}`;
  }
  if (typeof file.documentId === 'string' && file.documentId) return `doc:${file.documentId}`;
  if (typeof file.path === 'string' && file.path) return `loose:${file.path}`;
  return null;
}

/**
 * Index of the active file: prefer an exact (path, vaultId) match so two folders that
 * share a relative path (`notes/todo.md`) don't steal each other's active tab, then a
 * path-only match, else 0.
 */
export function pickActiveIndex(files, activePath, activeVaultId) {
  if (!Array.isArray(files) || !files.length) return 0;
  let i = files.findIndex((f) => f && f.path === activePath
    && (f.vaultId || null) === (activeVaultId || null));
  if (i < 0) i = files.findIndex((f) => f && f.path === activePath);
  return i >= 0 ? i : 0;
}
