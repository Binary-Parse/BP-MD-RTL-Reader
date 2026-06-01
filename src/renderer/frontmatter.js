/**
 * frontmatter.js — minimal YAML front-matter parsing (T-R6). Pure.
 * Supports the small subset notes use: `key: value` lines between --- fences.
 */

export function parseFrontMatter(md) {
  const src = md == null ? '' : String(md);
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src);
  if (!m) return { data: {}, body: src };
  const data = {};
  for (const raw of m[1].split(/\r?\n/)) {
    const line = raw.trim();
    const mm = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (mm) data[mm[1]] = mm[2].replace(/^["']|["']$/g, '').trim();
  }
  return { data, body: src.slice(m[0].length) };
}

/** Direction declared in front matter, or null (T-R6). */
export function frontMatterDirection(data) {
  const d = String((data && data.direction) || '').toLowerCase();
  return d === 'rtl' || d === 'ltr' ? d : null;
}
