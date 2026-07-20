/**
 * math.js — KaTeX math (T-F9), tokenized BEFORE Markdown so the LaTeX source is
 * never corrupted by markdown's escape/emphasis rules.
 *
 * `mathExtension()` is a marked inline extension that matches `$$block$$` / `$inline$`,
 * captures the RAW TeX, and emits a private-use placeholder (hex-encoded, so it
 * survives marked + DOMPurify untouched). Because it is a marked extension, math is
 * never matched inside code spans/fences. `restoreMath(root)` then walks the rendered
 * DOM, decodes each placeholder, renders the raw TeX with the hardened katexOptions()
 * (trust:false, bounded), sanitizes via sanitizeMath, and inserts a `dir="ltr"` span
 * so math reads left-to-right even inside RTL prose. jsdom-testable (inject katex).
 */
import { katexOptions, sanitizeMath } from './trusted.js';
import { MAX_MATH_BYTES, utf8ByteLength } from './limits.js';

// Private-use sentinels (U+E000/U+E001) — never appear in real content, and being
// non-markdown, non-HTML they survive marked + DOMPurify verbatim.
const PH_OPEN = String.fromCharCode(0xE000);
const PH_CLOSE = String.fromCharCode(0xE001);
const PLACEHOLDER_RE = new RegExp(PH_OPEN + '([01])([0-9a-f]*)' + PH_CLOSE, 'g');
const SKIP = new Set(['CODE', 'PRE', 'SCRIPT', 'STYLE']);

// Hex (UTF-8) encode/decode → only [0-9a-f], so the placeholder body can never be
// re-interpreted by Markdown or stripped by the sanitizer.
function hexEncode(s) {
  let out = '';
  const bytes = new TextEncoder().encode(s);
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}
function hexDecode(hex) {
  const bytes = new Uint8Array(Math.floor(hex.length / 2));
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return new TextDecoder().decode(bytes);
}

/** Build the placeholder a math token renders to (carries the raw TeX). */
export function mathPlaceholder(tex, display) {
  if (utf8ByteLength(tex) > MAX_MATH_BYTES) {
    const delimiter = display ? '$$' : '$';
    return delimiter + tex + delimiter;
  }
  return PH_OPEN + (display ? '1' : '0') + hexEncode(tex) + PH_CLOSE;
}

/**
 * marked inline extension config: tokenizes math and emits placeholders carrying
 * the raw TeX. Register with `marked.use(mathExtension())`.
 */
export function mathExtension() {
  return {
    extensions: [{
      name: 'math',
      level: 'inline',
      start(src) { const i = src.indexOf('$'); return i < 0 ? undefined : i; },
      tokenizer(src) {
        let m = /^\$\$([\s\S]+?)\$\$/.exec(src); // block $$...$$ (wins)
        if (m) return { type: 'math', raw: m[0], tex: m[1], display: true };
        // inline $...$: opening $ not followed by $/space, closing $ preceded by
        // non-space — avoids treating "$5 and $10" as math.
        m = /^\$(?!\$)(?=\S)([^$\n]*?)(?<=\S)\$/.exec(src);
        if (m) return { type: 'math', raw: m[0], tex: m[1], display: false };
        return undefined;
      },
      renderer(token) { return mathPlaceholder(token.tex, token.display); },
    }],
  };
}

// Render a single TeX string to a sanitized, LTR-isolated KaTeX span (or null on error).
// Exported so the CM6 live-preview math widgets reuse the EXACT same render+sanitize path.
export function renderTex(tex, display, { katex, DOMPurify, doc }) {
  let html;
  try { html = katex.renderToString(tex, katexOptions({ displayMode: display })); }
  catch (_) { return null; }
  const span = doc.createElement('span');
  span.className = display ? 'math-block' : 'math-inline';
  span.setAttribute('dir', 'ltr'); // math is LTR even in RTL prose (isolate)
  span.innerHTML = sanitizeMath(html, DOMPurify);
  return span;
}

function restoreInNode(node, ctx) {
  const text = node.nodeValue;
  PLACEHOLDER_RE.lastIndex = 0;
  const frag = ctx.doc.createDocumentFragment();
  let m;
  let last = 0;
  let found = false;
  while ((m = PLACEHOLDER_RE.exec(text))) {
    const display = m[1] === '1';
    const tex = hexDecode(m[2]);
    if (m.index > last) frag.appendChild(ctx.doc.createTextNode(text.slice(last, m.index)));
    const el = renderTex(tex, display, ctx);
    if (el) frag.appendChild(el);
    else { const d = display ? '$$' : '$'; frag.appendChild(ctx.doc.createTextNode(d + tex + d)); } // failed → literal
    last = m.index + m[0].length;
    found = true;
  }
  if (!found) return;
  if (last < text.length) frag.appendChild(ctx.doc.createTextNode(text.slice(last)));
  node.parentNode.replaceChild(frag, node);
}

/** Replace math placeholders in the rendered DOM with sanitized KaTeX (T-F9). */
export function restoreMath(root, { katex, DOMPurify } = {}) {
  if (!root || typeof root.querySelectorAll !== 'function' || !katex || typeof katex.renderToString !== 'function') return root;
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const p = n.parentNode;
      if (!p || SKIP.has(p.nodeName)) return NodeFilter.FILTER_REJECT;
      return n.nodeValue.indexOf(PH_OPEN) >= 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  const nodes = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
  const ctx = { katex, DOMPurify, doc };
  for (const node of nodes) restoreInNode(node, ctx);
  return root;
}
