/**
 * tree.js — pure folder-tree builder for the vault sidebar (T-F1).
 * Turns a flat list of {name, relPath, fileIdx} into a nested dir/file tree.
 * No DOM; the renderer walks the result to build collapsible nodes.
 */

function sortNode(node) {
  node.children.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1; // dirs first
    return a.name.localeCompare(b.name);
  });
  for (const c of node.children) if (c.type === 'dir') sortNode(c);
  return node;
}

/**
 * @param {Array<{name?:string, relPath?:string, fileIdx?:number}>} entries
 * @returns {{name:'', path:'', type:'dir', children:Array}}
 */
export function buildFileTree(entries = []) {
  const root = { name: '', path: '', type: 'dir', children: [] };
  const dirs = new Map([['', root]]);

  function ensureDir(dirPath) {
    if (dirs.has(dirPath)) return dirs.get(dirPath);
    const parts = dirPath.split('/');
    const name = parts[parts.length - 1];
    const parentPath = parts.slice(0, -1).join('/');
    const parent = ensureDir(parentPath);
    const node = { name, path: dirPath, type: 'dir', children: [] };
    parent.children.push(node);
    dirs.set(dirPath, node);
    return node;
  }

  entries.forEach((e, i) => {
    const rel = (e.relPath || e.name || '').replace(/\\/g, '/');
    if (!rel) return;
    const parts = rel.split('/');
    const fileName = parts[parts.length - 1];
    const dirPath = parts.slice(0, -1).join('/');
    const dir = ensureDir(dirPath);
    dir.children.push({
      name: fileName,
      path: rel,
      type: 'file',
      fileIdx: e.fileIdx != null ? e.fileIdx : i,
    });
  });

  return sortNode(root);
}

/** Flatten a tree to a render list with depth (dirs/roots + files in display order). */
export function flattenTree(root, collapsed = new Set(), depth = 0, out = []) {
  for (const child of root.children) {
    out.push({ name: child.name, path: child.path, type: child.type, depth, fileIdx: child.fileIdx, id: child.id });
    if ((child.type === 'dir' || child.type === 'root') && !collapsed.has(child.path)) {
      flattenTree(child, collapsed, depth + 1, out);
    }
  }
  return out;
}

/**
 * Prefix every descendant path in `node` with `prefix/`, in place. Exported (B4) so a
 * caller building its own synthetic root — e.g. a "loose files" pseudo-root that isn't
 * vault-scoped and so isn't itself a buildForest group — can namespace its subtree's
 * paths the same way buildForest does, keeping collapse-state/DOM-addressing collision
 * safety uniform across every kind of root.
 */
export function prefixTreePaths(node, prefix) {
  for (const child of node.children) {
    child.path = `${prefix}/${child.path}`;
    if (child.type === 'dir') prefixTreePaths(child, prefix);
  }
}

/**
 * Group `entries` by vaultId into a forest — one named root per open folder, each
 * containing that folder's own dir/file tree (built by buildFileTree, unchanged).
 * Descendant paths are prefixed with `@<vaultId>/` so two folders that happen to
 * share a subfolder name (e.g. both have `notes/`) can never collide in collapse
 * state or DOM addressing. Entries with no vaultId (loose/single-file opens) are
 * left out — the caller folds those into its own pseudo-root.
 * @param {Array<{name?, relPath?, fileIdx?, vaultId?}>} entries
 * @param {Map<string,string>} roots vaultId -> display name
 * @returns {{name:'', path:'', type:'dir', children:Array}}
 */
export function buildForest(entries = [], roots = new Map()) {
  const byVault = new Map();
  for (const id of roots.keys()) byVault.set(id, []);
  for (const entry of entries) {
    const id = entry && entry.vaultId;
    if (id == null) continue;
    if (!byVault.has(id)) byVault.set(id, []);
    byVault.get(id).push(entry);
  }
  const forestRoot = { name: '', path: '', type: 'dir', children: [] };
  for (const [id, group] of byVault) {
    const subtree = buildFileTree(group);
    prefixTreePaths(subtree, `@${id}`);
    forestRoot.children.push({
      type: 'root',
      id,
      name: roots.get(id) || id,
      path: `@${id}`,
      children: subtree.children,
    });
  }
  forestRoot.children.sort((a, b) => a.name.localeCompare(b.name));
  return forestRoot;
}
