/**
 * session.js — pure helpers for last-session restore (T-B5 / M6 EXIT).
 *
 * The renderer wires these to the settings bridge: `buildSession` snapshots the open
 * vault + active tab into the persisted `lastSession` shape, and `pickActiveIndex`
 * decides which restored file to re-open on the next launch. Disk re-reads + DOM are
 * the renderer's job; this module stays pure so the logic is unit-tested.
 */

/**
 * Build the persisted lastSession from the open vault + tabs. Returns null when there
 * is no disk-backed vault to restore (nothing meaningful to persist).
 * @param {string} vaultPath absolute folder path of the open vault
 * @param {Array<{path?:string}>} files the open files (vault listing)
 * @param {number|null} activeIndex index of the active tab
 */
export function buildSession(vaultPath, files, activeIndex) {
  if (!vaultPath || typeof vaultPath !== 'string' || !Array.isArray(files) || !files.length) return null;
  const openPaths = files.map((f) => f && f.path).filter((p) => typeof p === 'string');
  if (!openPaths.length) return null;
  const active = activeIndex != null ? files[activeIndex] : null;
  const activePath = active && typeof active.path === 'string' ? active.path : undefined;
  return { vaultPath, openPaths, activePath };
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
