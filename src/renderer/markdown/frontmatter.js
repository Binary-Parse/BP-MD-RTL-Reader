/**
 * frontmatter.js — minimal YAML front-matter parsing (T-R6). Pure.
 * Supports the small subset notes use: `key: value` lines between --- fences.
 */

export function parseFrontMatter(md) {
  const src = md == null ? '' : String(md);
  // An optional single leading UTF-8 BOM must not defeat the fence match: a BOM-prefixed
  // note would otherwise render its metadata as body text and ignore direction:/lang:.
  const m = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(src);
  // QA M2: a note that opens with a `---` rule and has another `---` later is not front
  // matter unless the lines between look like YAML; otherwise that text would vanish.
  if (!m || !m[1].split(/\r?\n/).every(isYamlLine)) return { data: {}, body: src };
  const data = {};
  for (const raw of m[1].split(/\r?\n/)) {
    // Deliberately flat metadata grammar: indented YAML belongs to a nested
    // structure and must never be promoted to a top-level document directive.
    if (/^\s/.test(raw)) continue;
    const mm = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(raw);
    if (mm) data[mm[1]] = mm[2].replace(/^["']|["']$/g, '').trim();
  }
  return { data, body: src.slice(m[0].length) };
}

function isYamlLine(line) {
  return line.trim() === '' || /^\s/.test(line) || /^(#|- |-$)/.test(line) || /^[^\s:#][^:]*:(\s|$)/.test(line);
}

/** Direction declared in front matter, or null (T-R6). */
export function frontMatterDirection(data) {
  const d = String((data && data.direction) || '').toLowerCase();
  return d === 'rtl' || d === 'ltr' ? d : null;
}
