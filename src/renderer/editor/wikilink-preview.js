/**
 * wikilink-preview.js — CodeMirror 6 live-preview for [[wikilinks]] (R09).
 *
 * @lezer/markdown does not know the app's custom `[[target|alias]]` syntax (it is a
 * marked *extension*, not part of CommonMark/GFM), so the syntax-tree-driven
 * live-preview (live-preview.js) never touches it — a wikilink would otherwise sit
 * in the editor as raw, non-clickable text. This plugin scans visible lines for the
 * wikilink pattern and, on every line the cursor is NOT on, replaces the match with
 * a clickable `<a class="wikilink">` widget that calls onNavigate(target). The
 * active line stays raw so it remains editable — the same affordance as the rest of
 * the live-preview surface and the same rendered markup as the preview pane.
 *
 * CM6 is injected so this stays decoupled from the vendored engine and testable.
 */

import { isEscaped } from '../limits.js';
import { activeLineSpan, atomicDecorationPlugin, forEachVisibleChunk, syntaxRangeAllowed } from './syntax-guards.js';

// Mirror of the wikilink tokenizer in markdown.js: [[target]] or [[target|alias]],
// no newlines/pipes inside the target, no newline inside the alias.
const WIKILINK_RE = /\[\[([^\]\n|]+?)(?:\|([^\]\n]+?))?\]\]/g;

export function createWikilinkPreview(CM6, onNavigate) {
  const { Decoration, WidgetType } = CM6;

  class WikilinkWidget extends WidgetType {
    constructor(target, alias) { super(); this.target = target; this.alias = alias; }
    eq(o) { return o.target === this.target && o.alias === this.alias; }
    toDOM() {
      const a = document.createElement('a');
      a.className = 'wikilink';
      a.setAttribute('data-target', this.target);
      a.href = '#';
      a.tabIndex = 0;
      a.setAttribute('aria-label', `Open note ${this.alias}`);
      a.textContent = this.alias;
      const activate = (e) => {
        e.preventDefault();
        if (typeof onNavigate === 'function') onNavigate(this.target);
      };
      // mousedown (not click): fire BEFORE CodeMirror moves the caret into the widget,
      // and preventDefault so focus/selection isn't disturbed by the navigation.
      a.addEventListener('mousedown', activate);
      a.addEventListener('click', (e) => e.preventDefault());
      a.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') activate(e);
      });
      return a;
    }
    ignoreEvent() { return false; } // let the widget receive its own mousedown
  }

  function build(view) {
    if (view.visibleRanges.length === 0) return Decoration.set([], true);
    const ranges = [];
    const { activeFrom, activeTo } = activeLineSpan(view);
    forEachVisibleChunk(view, (from, text) => {
      WIKILINK_RE.lastIndex = 0;
      let m;
      while ((m = WIKILINK_RE.exec(text))) {
        if (isEscaped(text, m.index)) continue;
        const start = from + m.index;
        const end = start + m[0].length;
        if (!syntaxRangeAllowed(CM6, view.state, start, end)) continue;
        if (end >= activeFrom && start <= activeTo) continue; // active line → leave raw/editable
        const target = m[1].trim();
        const alias = (m[2] && m[2].trim()) || target;
        ranges.push(Decoration.replace({ widget: new WikilinkWidget(target, alias) }).range(start, end));
      }
    });
    return Decoration.set(ranges, true);
  }

  // Atomic so the caret steps OVER a collapsed wikilink rather than landing inside it.
  return atomicDecorationPlugin(CM6, build);
}
