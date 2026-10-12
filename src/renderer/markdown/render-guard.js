/**
 * render-guard.js — keeps one marked.parse call from stalling the window (audit M4).
 *
 * marked parses inline text one "context" at a time (a paragraph, a heading, a list item,
 * a table cell). Inside one context three things were quadratic:
 *
 *   1. marked's own tokenizers rescan the rest of the context for every opener that never
 *      closes: 60 KB of `*a ` took about 30 s. `_`, `~~`, backticks and `!` behave alike.
 *   2. Before its loop marked masks escapes, links and code spans by copying the whole
 *      context once per match.
 *   3. The `start` hint of each inline extension of this app was asked again after every
 *      text token and searched the rest of the context each time. That made honest text
 *      quadratic too: a long log with single line breaks is one context. The block-level
 *      hint did the same once per paragraph over the rest of the document.
 *
 * What this module does about each:
 *
 *   1. A time budget per render (beginRender). Once it is spent, the inline tokenizers
 *      stand down and the rest of the note is emitted as literal text, line by line. The
 *      budget grows with the size of the note, so a large honest note is not cut.
 *   2. A context whose masking alone would be too costly is emitted as literal text.
 *   3. cachedStart remembers where the next match is, so each hint is searched once per
 *      match instead of once per token. This changes no output.
 *
 * It reaches into marked in two places: Lexer.prototype.inlineTokens and blockTokens (to know
 * which context a `start` call belongs to) and the tokenizer overrides of marked.use.
 */

import { RENDER_BUDGET_BASE_MS, RENDER_BUDGET_MS_PER_KB, RENDER_MASK_UNITS } from '../limits.js';

const state = { deadline: Infinity, bailed: false, limited: false, calls: 0 };
const contexts = []; // one entry per running inlineTokens call: { length, next }
const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

/** Start the budget for one render of `length` characters. */
export function beginRender(length) {
  state.deadline = now() + RENDER_BUDGET_BASE_MS + (length / 1024) * RENDER_BUDGET_MS_PER_KB;
  state.bailed = false;
  state.limited = false;
  state.calls = 0;
  contexts.length = 0;
}

/** End the render. Returns true when part of the note was emitted as literal text. */
export function endRender() {
  const limited = state.limited;
  state.deadline = Infinity;
  state.bailed = false;
  contexts.length = 0;
  return limited;
}

/** Record that this render gave up on formatting something (used by the caller's fallback). */
export function markLimited() { state.limited = true; }

function overBudget() {
  if (state.bailed) return true;
  state.calls = (state.calls + 1) & 15; // look at the clock on every 16th call
  if (state.calls === 0 && now() > state.deadline) {
    state.bailed = true;
    state.limited = true;
  }
  return state.bailed;
}

/** Literal text for a context: one text token per line, a break between lines. */
function pushPlain(tokens, src) {
  const lines = src.replace(/\s+$/, '').split('\n');
  lines.forEach((line, index) => {
    if (line) tokens.push({ type: 'text', raw: line, text: line, escaped: false });
    if (index < lines.length - 1) tokens.push({ type: 'br', raw: '\n' });
  });
  return tokens;
}

function countMatches(rule, src, stopAt) {
  if (!rule || typeof rule.exec !== 'function' || !rule.global) return 0;
  rule.lastIndex = 0;
  let count = 0;
  while (count <= stopAt && rule.exec(src) !== null) count += 1;
  rule.lastIndex = 0; // marked's own loops expect to start from the beginning
  return count;
}

/** True when marked's masking pass (one copy of the context per match) would cost too much. */
function maskingTooCostly(lexer, src) {
  if (src.length * src.length < RENDER_MASK_UNITS) return false; // cannot reach the limit
  const rules = lexer && lexer.tokenizer && lexer.tokenizer.rules && lexer.tokenizer.rules.inline;
  if (!rules) return false;
  const stopAt = Math.ceil(RENDER_MASK_UNITS / src.length);
  let count = countMatches(rules.anyPunctuation, src, stopAt);
  if (count <= stopAt) count += countMatches(rules.blockSkip, src, stopAt);
  return count > stopAt;
}

/**
 * Wrap the `start` function of an inline extension. `boundary` is for a pattern with a
 * lookbehind: that many leading characters are tested on their own, because the first
 * position of the text marked passes in has no character before it.
 */
export function cachedStart(find, boundary = 0) {
  return function start(src) {
    if (state.bailed) return undefined;
    const context = contexts.at(-1);
    if (!context || src.length > context.length) return find.call(this, src);
    if (boundary && find.call(this, src.slice(0, boundary)) === 0) return 0;
    const offset = context.length - src.length;
    let next = context.next.get(find);
    if (next === undefined || next < offset) {
      const index = find.call(this, src);
      next = (typeof index === 'number' && index >= 0) ? offset + index : Infinity;
      context.next.set(find, next);
    }
    return next === Infinity ? undefined : next - offset;
  };
}

const installed = new WeakSet();

/** Install the guard on a marked instance (the vendored global, or the package in tests). */
export function installRenderGuard(marked) {
  const Lexer = marked && marked.Lexer;
  if (!Lexer || !Lexer.prototype || typeof Lexer.prototype.inlineTokens !== 'function' || typeof Lexer.prototype.blockTokens !== 'function' || typeof marked.use !== 'function') return;
  if (!installed.has(Lexer)) {
    installed.add(Lexer);
    const inlineTokens = Lexer.prototype.inlineTokens;
    Lexer.prototype.inlineTokens = function guardedInlineTokens(src, tokens = []) {
      if (typeof src !== 'string') return inlineTokens.call(this, src, tokens);
      if (state.bailed || maskingTooCostly(this, src)) {
        state.limited = true;
        return pushPlain(tokens, src);
      }
      contexts.push({ length: src.length, next: new Map() });
      try { return inlineTokens.call(this, src, tokens); } finally { contexts.pop(); }
    };
    // Block extensions have a start hint too, asked once per paragraph over the rest of the
    // document. Inline work is queued and runs after the block pass, so one stack serves both.
    const blockTokens = Lexer.prototype.blockTokens;
    Lexer.prototype.blockTokens = function guardedBlockTokens(src, ...rest) {
      if (typeof src !== 'string') return blockTokens.call(this, src, ...rest);
      contexts.push({ length: src.length, next: new Map() });
      try { return blockTokens.call(this, src, ...rest); } finally { contexts.pop(); }
    };
  }
  if (installed.has(marked)) return;
  installed.add(marked);
  // marked.use: `false` hands over to the built-in tokenizer, `undefined` means "no token here".
  const standDown = () => (overBudget() ? undefined : false);
  marked.use({
    tokenizer: {
      escape: standDown, tag: standDown, link: standDown, reflink: standDown, emStrong: standDown,
      codespan: standDown, del: standDown, autolink: standDown, url: standDown,
      inlineText(src) {
        if (!overBudget()) return false;
        const end = src.indexOf('\n', 1);
        const raw = end < 0 ? src : src.slice(0, end);
        return { type: 'text', raw, text: raw, escaped: false };
      },
    },
  });
}
