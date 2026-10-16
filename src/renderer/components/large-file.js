/**
 * large-file.js — note size tiers and the numbers the renderer shares with main.
 *
 * Main owns the thresholds (src/main/main-logic.js) and hands them over through the
 * `app:limits` channel (electronAPI.getLimits). The values below are only what the page uses
 * until that answer arrives, and in the browser lane, which has no main process; a unit test
 * pins them to main's, so the two cannot drift.
 *
 *   NORMAL   <= largeNoteBytes      nothing special
 *   LARGE    <= confirmNoteBytes    opens; told once; the preview is skipped while editing
 *   HUGE     <= maxFileBytes        asks first; opens in large-file mode
 *   REFUSED  >  maxFileBytes        not opened
 */
export const MIB = 1024 * 1024;

export const TIER = Object.freeze({ NORMAL: 0, LARGE: 1, HUGE: 2, REFUSED: 3 });

const DEFAULTS = Object.freeze({
  largeNoteBytes: 5 * MIB,
  confirmNoteBytes: 20 * MIB,
  maxFileBytes: 100 * MIB,
  maxVaultFileBytes: 20 * MIB,
  maxPdfExportBytes: 64 * MIB,
  maxHtmlExportBytes: 256 * MIB,
  maxEpubBytes: 64 * MIB,
  largeExportBytes: 5 * MIB,
});

let limits = { ...DEFAULTS };

/** The defaults the page starts with (exported for the drift test). */
export const DEFAULT_LIMITS = DEFAULTS;

/** Take main's numbers. Anything that is not a positive finite number keeps the default. */
export function applyLimits(fromMain) {
  if (!fromMain || typeof fromMain !== 'object') return limits;
  // Only the known keys are read, through a Map (no computed property access on main's object).
  const incoming = new Map(Object.entries(fromMain));
  limits = Object.fromEntries(Object.entries(limits).map(([key, kept]) => {
    const value = incoming.get(key);
    return [key, typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : kept];
  }));
  return limits;
}

/** Back to the defaults (tests). */
export function resetLimits() { limits = { ...DEFAULTS }; }

export function getLimits() { return limits; }

/** The tier of an on-disk size in bytes. */
export function noteTier(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return TIER.NORMAL;
  if (bytes > limits.maxFileBytes) return TIER.REFUSED;
  if (bytes > limits.confirmNoteBytes) return TIER.HUGE;
  if (bytes > limits.largeNoteBytes) return TIER.LARGE;
  return TIER.NORMAL;
}

/** Megabytes for a message: one decimal below 10, whole above. */
export function megabytes(bytes) {
  const n = Number(bytes) / MIB;
  if (!(n > 0)) return '0';
  return n >= 10 ? String(Math.round(n)) : (Math.round(n * 10) / 10).toString();
}

/** A limit in whole MB for a message ("100"). */
export function limitMb(bytes) { return String(Math.round(bytes / MIB)); }

/** True while the note is open in large-file mode. */
export function inLargeMode(file) { return !!file && file.largeTier >= TIER.HUGE; }

/** True for a note whose preview is not drawn while editing (LARGE and HUGE). */
export function skipsEditPreview(file) { return !!file && file.largeTier >= TIER.LARGE; }

/**
 * Whether the Reading view shows the "Render anyway" notice instead of the note: a note in
 * large-file mode, until the reader asked for it.
 */
export function needsRenderPrompt(file) { return inLargeMode(file) && !file.renderAnyway; }

/**
 * "Render anyway" on a note in large-file mode renders at most this many characters from the
 * top: a 100 MB note as DOM crashes the renderer (measured), and the rest stays in the editor.
 */
export const RENDER_ANYWAY_CHARS = 20_000_000;

/** The part of a note's body that Reading mode may render: { body, cut } (cut = was shortened). */
export function renderSlice(file, body) {
  const text = String(body || '');
  if (!inLargeMode(file) || text.length <= RENDER_ANYWAY_CHARS) return { body: text, cut: false };
  const end = text.lastIndexOf(String.fromCharCode(10), RENDER_ANYWAY_CHARS);
  return { body: text.slice(0, end > 0 ? end : RENDER_ANYWAY_CHARS), cut: true };
}

/** An export of this many bytes of HTML (or a note of this size) warrants a heads-up. */
export function isLargeExport(bytes) { return Number(bytes) > limits.largeExportBytes; }

/**
 * The export error code from main as a kind for the renderer's toast:
 * 'too-large' | 'timeout' | 'failed'.
 */
export function exportFailureKind(res) {
  const code = res && res.error;
  if (code === 'too-large' || code === 'file-too-large') return 'too-large';
  if (code === 'timeout') return 'timeout';
  return 'failed';
}

/** The tier a note that is open can have: HUGE at most (a refused size never opens). */
export function openTier(bytes) { return Math.min(noteTier(bytes), TIER.HUGE); }

/**
 * A note's size on disk changed (a save wrote it, a reload read it): record it and recompute the
 * tier with the same rule as at open. Returns true when the tier changed, which is when the
 * editor has to be built again (its extensions are fixed when its state is made).
 */
export function applyNoteSize(file, bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return false;
  const before = file.largeTier || TIER.NORMAL;
  file.sizeBytes = bytes;
  file.largeTier = openTier(bytes);
  return file.largeTier !== before;
}

/**
 * The recovery mirror's change signature. The text is read FIRST: for a note in large-file mode
 * reading it hands over the editor's pending edit, which raises the revision, and a revision read
 * before the text left a same-length edit looking unchanged for one more tick.
 */
export function mirrorSignature(files) {
  return files.map((file) => {
    const length = String(file.content || '').length;
    return `${file.name}:${file.revision}:${length}`;
  }).join('|');
}

/** Runs async tasks one at a time, in call order; a task that throws does not stop the next. */
export function serialQueue() {
  let tail = Promise.resolve();
  return (task) => {
    const result = tail.then(task);
    tail = result.catch(() => {});
    return result;
  };
}

/**
 * CodeMirror cannot lay out a wrapped line of about 15 million characters or more: building its
 * height map throws "Cannot read properties of undefined (reading 'length')" (measured:
 * fine at 14 M, broken at 15 M, at any width). A text with a line past this many characters is
 * shown without line wrapping, which the same size of line does handle.
 */
export const MAX_WRAP_LINE_CHARS = 8_000_000;

/** True when some line of `text` is longer than `limit` characters. Cheap below `limit` characters. */
export function hasLongLine(text, limit = MAX_WRAP_LINE_CHARS) {
  const length = text.length;
  if (length <= limit) return false;
  let from = 0;
  while (from < length) {
    const end = text.indexOf(String.fromCharCode(10), from);
    const lineEnd = end < 0 ? length : end;
    if (lineEnd - from > limit) return true;
    from = lineEnd + 1;
  }
  return false;
}
