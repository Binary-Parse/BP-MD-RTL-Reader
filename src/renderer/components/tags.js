/**
 * tags.js — pure #tag extraction for the tags pane.
 *
 * A tag is a `#` preceded by start-of-string or whitespace, followed by one or
 * more Unicode letters/numbers/underscore/hyphen. This is the single source of
 * truth for tag parsing; app.js (renderTags) and the unit tests both use it.
 */

/**
 * Count tag occurrences in a single string.
 * @param {string} content
 * @returns {Object<string, number>} tag → occurrence count
 */
export function extractTags(content) {
  const tagMap = new Map();
  const re = /(?:^|\s)#([\p{L}\p{N}_-]+)/gu;
  let m;
  while ((m = re.exec(content || '')) !== null) {
    tagMap.set(m[1], (tagMap.get(m[1]) || 0) + 1);
  }
  return Object.fromEntries(tagMap);
}

// audit PERF-05: renderTree triggers this on every expand/collapse — a full-content regex
// rescan per click. Cache each file's UNIQUE tag list keyed by its content (WeakMap, dies
// with the file object), and dedupe file indices with a last-element check (indices arrive
// in encounter order) instead of Array.includes.
const perFileTags = new WeakMap();

function tagsOf(file) {
  const content = file && typeof file.content === 'string' ? file.content : '';
  const cached = perFileTags.get(file);
  if (cached && cached.content === content) return cached.tags;
  const unique = [];
  const seen = new Set();
  const re = /(?:^|\s)#([\p{L}\p{N}_-]+)/gu;
  let m;
  while ((m = re.exec(content)) !== null) {
    if (!seen.has(m[1])) { seen.add(m[1]); unique.push(m[1]); }
  }
  perFileTags.set(file, { content, tags: unique });
  return unique;
}

/**
 * Map each tag to the indices of the files that contain it (cached per file content).
 * @param {Array<{content?: string}>} files
 * @returns {Object<string, number[]>} tag → unique file indices (in encounter order)
 */
export function extractTagsFromFiles(files) {
  const tagMap = new Map();
  (files || []).forEach((f, i) => {
    for (const tag of tagsOf(f)) {
      if (!tagMap.has(tag)) tagMap.set(tag, []);
      const idxs = tagMap.get(tag);
      if (idxs[idxs.length - 1] !== i) idxs.push(i); // O(1) dedup
    }
  });
  return Object.fromEntries(tagMap);
}
