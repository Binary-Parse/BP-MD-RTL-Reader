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
 * Build the persisted lastSession from the open vault + tabs, in the forest-ready
 * shape (B2, multi-folder workspaces): `{ vaults: [{vaultId, openPaths}],
 * activeVaultId, activePath }`. Only one vault is ever open going into `vaults`
 * today — workspace-controller.js still tracks a single vaultId — Track B3/B4
 * populate more than one entry once several folders can stay open at once.
 * Returns null when there is no disk-backed vault to restore (nothing meaningful to
 * persist), including a synthetic (non-`cap-`) id: a browser File System Access API
 * pick or the demo set names nothing readVault can re-open on the next launch.
 * @param {string} vaultId main-issued opaque vault capability ID
 * @param {Array<{path?:string}>} files the open files (vault listing)
 * @param {number|null} activeIndex index of the active tab
 */
export function buildSession(vaultId, files, activeIndex) {
  if (!vaultId || typeof vaultId !== 'string' || !CAPABILITY_ID.test(vaultId)
    || !Array.isArray(files) || !files.length) return null;
  const openPaths = files.map((f) => f && f.path).filter((p) => typeof p === 'string');
  if (!openPaths.length) return null;
  const active = activeIndex != null ? files[activeIndex] : null;
  const activePath = active && typeof active.path === 'string' ? active.path : undefined;
  return {
    vaults: [{ vaultId, openPaths }],
    activeVaultId: vaultId,
    activePath,
  };
}

/**
 * Stable identity for a file across re-renders, used to address tree/tab DOM instead
 * of a splice-fragile array index (B2/B3). Strongest-to-weakest: a document capability
 * (single-file opens) beats a vault-scoped path (folder opens) beats a bare loose path
 * (browser/File System Access API, or any note with no on-disk vault at all) — the
 * `vault:<id> <path>` form is what lets two open folders share a relative path (both
 * have `notes/todo.md`) without colliding, which a bare `name+path` key cannot do.
 * @param {{documentId?:string, vaultId?:string, path?:string}} file
 * @returns {string|null}
 */
export function fileKey(file) {
  if (!file) return null;
  if (typeof file.documentId === 'string' && file.documentId) return `doc:${file.documentId}`;
  if (typeof file.vaultId === 'string' && file.vaultId && typeof file.path === 'string') {
    return `vault:${file.vaultId} ${file.path}`;
  }
  if (typeof file.path === 'string' && file.path) return `loose:${file.path}`;
  return null;
}

/**
 * Index of the file whose path matches activePath, else 0. Clamped to a valid index;
 * an empty list yields 0 (caller no-ops on an empty vault).
 */
export function pickActiveIndex(files, activePath) {
  if (!Array.isArray(files) || !files.length) return 0;
  const i = files.findIndex((f) => f && f.path === activePath);
  return i >= 0 ? i : 0;
}
