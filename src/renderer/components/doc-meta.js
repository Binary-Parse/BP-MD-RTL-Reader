import { parseFrontMatter, frontMatterDirection } from '../markdown/frontmatter.js';
import { resolveBlockDirection } from '../bidi.js';

const WORDS_PER_MINUTE = 220;
const STRONG_LETTER = /\p{L}/u;
const FENCE = /^\s*(```|~~~)/;

// Large notes (large-file mode): counting every word, splitting every line and voting on every
// block of a 100 MB note costs seconds and hundreds of MB, and the Inspector asks again on each
// pause in typing. Above SAMPLE_ABOVE characters the figures come from three slices of the text
// (start, middle, end) and the word count is scaled to the whole length: an estimate, cheap and
// stable. Notes below the threshold are counted exactly, as before.
export const SAMPLE_ABOVE = 2_000_000;
const SAMPLE_PART = 200_000;
const NEWLINES = String.fromCharCode(10, 10); // a blank line between the slices
function sampleOf(text) {
  const mid = Math.floor(text.length / 2) - SAMPLE_PART / 2;
  const parts = [text.slice(0, SAMPLE_PART), text.slice(mid, mid + SAMPLE_PART), text.slice(text.length - SAMPLE_PART)];
  return parts.join(NEWLINES);
}

export function wordCount(text) {
  const { body } = parseFrontMatter(text == null ? '' : text);
  return bodyWordCount(body);
}

/** Words in a note body whose front matter is already stripped (estimated above SAMPLE_ABOVE characters). */
export function bodyWordCount(body) {
  if (body.length > SAMPLE_ABOVE) {
    const sample = sampleOf(body);
    return Math.round(((sample.match(/\S+/g) || []).length * body.length) / sample.length);
  }
  return (body.match(/\S+/g) || []).length;
}

export function readMinutes(words) {
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

function votingBlocks(body) {
  const blocks = [];
  let fenced = false;
  let current = [];
  const flush = () => {
    if (current.length) blocks.push(current.join('\n'));
    current = [];
  };
  for (const line of body.split(/\r?\n/)) {
    if (FENCE.test(line)) {
      fenced = !fenced;
      flush();
    } else if (fenced) {
      continue;
    } else if (line.trim() === '') {
      flush();
    } else {
      current.push(line);
    }
  }
  flush();
  return blocks.filter((block) => STRONG_LETTER.test(block));
}

export function fileDirKind(text, forced = null) {
  if (forced === 'rtl' || forced === 'ltr') return forced;
  const whole = text == null ? '' : String(text);
  const { data, body } = parseFrontMatter(whole.length > SAMPLE_ABOVE ? sampleOf(whole) : whole);
  const declared = frontMatterDirection(data);
  if (declared) return declared;
  let rtl = 0;
  let ltr = 0;
  for (const block of votingBlocks(body)) {
    if (resolveBlockDirection(block) === 'rtl') rtl += 1;
    else ltr += 1;
  }
  if (rtl >= 2 && ltr >= 2) return 'mixed';
  return rtl > ltr ? 'rtl' : 'ltr';
}

export function outlineNumbers(levels) {
  if (!levels.length) return [];
  const base = Math.min(...levels);
  let counters = [];
  return levels.map((level) => {
    const depth = level - base;
    const next = counters.slice(0, depth + 1);
    while (next.length < depth + 1) next.push(0);
    next.push(next.pop() + 1);
    counters = next;
    return next.filter(Boolean).join('.');
  });
}

export function crumbSegments(rootName, filePath) {
  const parts = String(filePath || '').split(/[\\/]+/).filter(Boolean);
  return (rootName ? [rootName] : []).concat(parts);
}

export function fileMeta(file) {
  const content = file.content || '';
  const forced = file.forcedDir ?? null;
  const cached = file._meta;
  if (cached && cached.src === content && cached.forced === forced) return cached;
  const words = wordCount(content);
  const meta = { src: content, forced, words, minutes: readMinutes(words), dir: fileDirKind(content, forced) };
  file._meta = meta;
  return meta;
}

export function shelfRatio(entries, key) {
  const entry = Array.isArray(entries) ? entries.find((e) => e.key === key) : null;
  const ratio = entry ? Number(entry.ratio) : 0;
  return Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0;
}
