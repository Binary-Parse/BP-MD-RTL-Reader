/**
 * tags.js — pure #tag extraction for the tags pane.
 *
 * A tag is a `#` preceded by start-of-string or whitespace, followed by one or
 * more Unicode letters/numbers/underscore/hyphen. This is the single source of
 * truth for tag parsing (tagWords): app.js uses extractTagsFromFiles; extractTags counts one string.
 *
 * QA-L3: code (fenced blocks, inline code spans, math) is not prose and holds no tags, and
 * neither are numbers (`#123`) or colours (`#fff`, `#1F1B16`).
 */
import { proseText } from '../bidi.js';

const NUMBER = /^\p{N}+$/u;
const HEX = /^(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

// A hex-looking word is a colour when it has a digit or is one repeated letter (#fff);
// words such as #add, #decade or #facade stay tags.
function isTag(word) {
  if (NUMBER.test(word)) return false;
  if (HEX.test(word) && (/\d/.test(word) || new Set(word.toLowerCase()).size === 1)) return false;
  return true;
}

function* tagWords(content) {
  const text = proseText(content || '');
  const re = /(?:^|\s)#([\p{L}\p{N}_-]+)/gu; // per call: a shared global regex keeps lastIndex
  for (let m = re.exec(text); m; m = re.exec(text)) if (isTag(m[1])) yield m[1];
}

/**
 * Count tag occurrences in a single string.
 * @param {string} content
 * @returns {Object<string, number>} tag → occurrence count
 */
export function extractTags(content) {
  const tagMap = new Map();
  for (const tag of tagWords(content)) tagMap.set(tag, (tagMap.get(tag) || 0) + 1);
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
  for (const tag of tagWords(content)) {
    if (!seen.has(tag)) { seen.add(tag); unique.push(tag); }
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
