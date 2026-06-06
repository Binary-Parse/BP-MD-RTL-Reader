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
  const tagMap = {};
  const re = /(?:^|\s)#([\p{L}\p{N}_-]+)/gu;
  let m;
  while ((m = re.exec(content || '')) !== null) {
    if (!tagMap[m[1]]) tagMap[m[1]] = 0;
    tagMap[m[1]]++;
  }
  return tagMap;
}

/**
 * Map each tag to the indices of the files that contain it.
 * @param {Array<{content?: string}>} files
 * @returns {Object<string, number[]>} tag → unique file indices (in encounter order)
 */
export function extractTagsFromFiles(files) {
  const tagMap = {};
  (files || []).forEach((f, i) => {
    const re = /(?:^|\s)#([\p{L}\p{N}_-]+)/gu;
    let m;
    while ((m = re.exec(f.content || '')) !== null) {
      if (!tagMap[m[1]]) tagMap[m[1]] = [];
      if (!tagMap[m[1]].includes(i)) tagMap[m[1]].push(i);
    }
  });
  return tagMap;
}
