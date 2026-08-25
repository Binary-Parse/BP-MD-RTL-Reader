const EXCLUDED_NODE = /(?:Code|Comment|Escape|Invalid|Error)/i;

function hasExcludedAncestor(node) {
  for (let current = node; current; current = current.parent) {
    if (EXCLUDED_NODE.test(current.name || '')) return true;
  }
  return false;
}

/**
 * Keep regex-based custom extensions subordinate to the Markdown syntax tree.
 * Code, comments, escapes, and parse-error nodes must remain literal.
 */
export function syntaxRangeAllowed(CM6, state, from, to) {
  if (!CM6 || typeof CM6.syntaxTree !== 'function') return true;
  const tree = CM6.syntaxTree(state);
  if (!tree || typeof tree.resolveInner !== 'function') return true;
  const points = [from, Math.max(from, to - 1), from + Math.floor(Math.max(0, to - from - 1) / 2)];
  return points.every((pos) => !hasExcludedAncestor(tree.resolveInner(pos, -1)));
}
