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

/** Flatten a tree to a render list with depth (dirs + files in display order). */
export function flattenTree(root, collapsed = new Set(), depth = 0, out = []) {
  for (const child of root.children) {
    out.push({ name: child.name, path: child.path, type: child.type, depth, fileIdx: child.fileIdx });
    if (child.type === 'dir' && !collapsed.has(child.path)) {
      flattenTree(child, collapsed, depth + 1, out);
    }
  }
  return out;
}
