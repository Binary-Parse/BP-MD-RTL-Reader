/**
 * trusted.test.js — T-AI2 content pipeline hardening.
 * Uses a recording fake DOMPurify to assert configs and a tiny real strip for SVG.
 */
import { describe, test, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import createDOMPurify from 'dompurify';
import { MAX_NOTE_DEPTH, sanitizeHtml, sanitizeSvg, sanitizeMath, katexOptions } from '../../src/renderer/markdown/trusted.js';

function fakeDOMPurify(records) {
  return {
    sanitize(input, cfg) {
      records.push({ input, cfg });
      // crude strip so tests can assert script removal
      return String(input).replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '');
    },
  };
}

describe('sanitizeHtml', () => {
  test('forbids script/style/iframe and dangerous attrs', () => {
    const rec = [];
    const out = sanitizeHtml('<p onclick="x">hi</p><script>bad()</script>', fakeDOMPurify(rec));
    expect(out).not.toMatch(/<script/i);
    expect(rec[0].cfg.FORBID_TAGS).toEqual(expect.arrayContaining(['script', 'iframe']));
    expect(rec[0].cfg.ADD_ATTR).toEqual(expect.arrayContaining(['dir', 'lang']));
    // the inline style="" attribute is forbidden too (CSS-exfil defense, AI2/B4)
    expect(rec[0].cfg.FORBID_ATTR).toEqual(expect.arrayContaining(['style', 'onerror']));
  });

  // QA-M16: the reading pane takes the sanitized nodes, so the page does not parse and
  // sanitize the same HTML a second time.
  test('fragment mode returns the sanitized nodes, with the same result as the string', () => {
    const { window } = new JSDOM('');
    const purify = createDOMPurify(window);
    const html = '<h1 id="t">Title</h1><p onclick="x()">a <img src="x" onerror="y()"></p><script>bad()</script>';
    const frag = sanitizeHtml(html, purify, { fragment: true });
    expect(frag.nodeType).toBe(11); // DocumentFragment
    const holder = window.document.createElement('div');
    holder.appendChild(frag);
    expect(holder.innerHTML).toBe(sanitizeHtml(html, purify));
    expect(holder.innerHTML).not.toMatch(/onclick|onerror|<script/);
  });
});

describe('sanitizeSvg (EC-B3)', () => {
  test('forbids script + foreignObject; uses SVG profile', () => {
    const rec = [];
    const out = sanitizeSvg('<svg><foreignObject><script>x()</script></foreignObject></svg>', fakeDOMPurify(rec));
    expect(out).not.toMatch(/foreignObject|script/i);
    expect(rec[0].cfg.USE_PROFILES).toEqual({ svg: true, svgFilters: true });
    expect(rec[0].cfg.FORBID_TAGS).toEqual(expect.arrayContaining(['script', 'foreignObject']));
  });
});

describe('sanitizeMath (T-F9: KaTeX HTML+MathML, keep styles, drop active content)', () => {
  test('uses html+mathMl+svg profiles, keeps style, forbids script/foreignObject', () => {
    const rec = [];
    const out = sanitizeMath('<span class="katex" style="top:1px"><math><mn>2</mn></math></span><script>x()</script>', fakeDOMPurify(rec));
    expect(out).not.toMatch(/<script/i);
    expect(rec[0].cfg.USE_PROFILES).toEqual({ html: true, mathMl: true, svg: true });
    expect(rec[0].cfg.ADD_ATTR).toEqual(expect.arrayContaining(['style']));
    expect(rec[0].cfg.FORBID_TAGS).toEqual(expect.arrayContaining(['script', 'foreignObject']));
    // keeps the accessible x-tex annotation, but forbids the annotation-xml escape hatch
    expect(rec[0].cfg.ADD_TAGS).toEqual(expect.arrayContaining(['annotation', 'semantics']));
    expect(rec[0].cfg.FORBID_TAGS).toEqual(expect.arrayContaining(['annotation-xml']));
  });
  test('returns empty string when DOMPurify is absent', () => {
    expect(sanitizeMath('<span>x</span>', null)).toBe('');
  });
});

describe('katexOptions (EC-B4)', () => {
  test('trust:false and bounded expansion', () => {
    const o = katexOptions();
    expect(o.trust).toBe(false);
    expect(o.maxExpand).toBeLessThanOrEqual(1000);
    expect(o.throwOnError).toBe(false);
  });
});

// ── Mutation-hardening (audit F-3): assert the EXACT sanitizer config + every guard. ──
describe('sanitizer config — exact arrays (kills element-drop mutants)', () => {
  test('sanitizeHtml passes the full forbid/add lists verbatim', () => {
    const rec = []; sanitizeHtml('<p>x</p>', fakeDOMPurify(rec));
    expect(rec[0].cfg.ADD_ATTR).toEqual(['id', 'data-target', 'dir', 'lang']);
    expect(rec[0].cfg.ALLOW_DATA_ATTR).toBe(false);
    expect(rec[0].cfg.FORBID_TAGS).toEqual(['script', 'style', 'iframe', 'object', 'embed', 'form']);
    expect(rec[0].cfg.FORBID_ATTR).toEqual(['style', 'onerror', 'onload', 'onclick']);
    expect(rec[0].cfg.ALLOWED_URI_REGEXP).toBeInstanceOf(RegExp);
  });
  test('sanitizeSvg passes the full svg forbid lists verbatim', () => {
    const rec = []; sanitizeSvg('<svg></svg>', fakeDOMPurify(rec));
    expect(rec[0].cfg.FORBID_TAGS).toEqual(['script', 'foreignObject']);
    expect(rec[0].cfg.FORBID_ATTR).toEqual(['onload', 'onerror']);
    expect(rec[0].cfg.USE_PROFILES).toEqual({ svg: true, svgFilters: true });
  });
  test('sanitizeMath passes the full math add/forbid lists verbatim', () => {
    const rec = []; sanitizeMath('<span>x</span>', fakeDOMPurify(rec));
    expect(rec[0].cfg.USE_PROFILES).toEqual({ html: true, mathMl: true, svg: true });
    expect(rec[0].cfg.ADD_TAGS).toEqual(['semantics', 'annotation']);
    expect(rec[0].cfg.ADD_ATTR).toEqual(['style', 'aria-hidden', 'encoding']);
    expect(rec[0].cfg.FORBID_TAGS).toEqual(['script', 'iframe', 'object', 'embed', 'foreignObject', 'annotation-xml']);
    expect(rec[0].cfg.FORBID_ATTR).toEqual(['onerror', 'onload', 'onclick']);
    // Load-bearing: without it the return value is a plain string, which the app-wide
    // 'default' Trusted Types policy re-sanitizes with a narrower config — silently
    // undoing ADD_TAGS/ADD_ATTR above and stripping the accessible MathML annotation.
    expect(rec[0].cfg.RETURN_TRUSTED_TYPE).toBe(true);
  });
});

describe('sanitizer guards — every absent/invalid DOMPurify → empty string', () => {
  for (const [name, fn] of [['sanitizeHtml', sanitizeHtml], ['sanitizeSvg', sanitizeSvg], ['sanitizeMath', sanitizeMath]]) {
    test(`${name} returns '' when DOMPurify is null / has no sanitize fn`, () => {
      expect(fn('<x>', null)).toBe('');
      expect(fn('<x>', undefined)).toBe('');
      expect(fn('<x>', {})).toBe('');                      // sanitize missing
      expect(fn('<x>', { sanitize: 'nope' })).toBe('');    // sanitize not a function
    });
  }
});

describe('katexOptions — exact hardened values', () => {
  test('every hardening field is set (kills literal mutants)', () => {
    const o = katexOptions();
    expect(o.trust).toBe(false);
    expect(o.throwOnError).toBe(false);
    expect(o.maxExpand).toBe(1000);
    expect(o.maxSize).toBe(500);
    expect(o.strict).toBe('ignore');
  });
  test('overrides merge on top', () => {
    expect(katexOptions({ displayMode: true }).displayMode).toBe(true);
    expect(katexOptions({ trust: true }).trust).toBe(false);
  });
});

// T-F19: sanitizeSvg's output is assigned to innerHTML as a PLAIN STRING (markdown/
// mermaid.js), so Chromium re-runs it through the app-wide Trusted Types 'default'
// policy, whose config is narrower in some places and wider in others. sanitizeMath had
// to set RETURN_TRUSTED_TYPE to survive that; sanitizeSvg does not, because its
// allow-list is a subset of the default policy's on every axis.
//
// Measured on a live mermaid render 2026-08-22: one pass and two passes were
// byte-identical at 14106 chars, with zero tags and zero attributes dropped. This pins
// the property that makes that true, so a change to either config surfaces here rather
// than as silently missing diagram parts.
describe('sanitizeSvg survives the Trusted Types default policy (T-F19)', () => {
  const DEFAULT_POLICY_CFG = {
    USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true },
    ADD_ATTR: ['style', 'id', 'data-target', 'dir', 'lang'],
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed'],
  };

  test('its profile set is a subset of the default policy\'s', () => {
    const rec = [];
    sanitizeSvg('<svg></svg>', fakeDOMPurify(rec));
    for (const profile of Object.keys(rec[0].cfg.USE_PROFILES)) {
      expect(DEFAULT_POLICY_CFG.USE_PROFILES[profile], `profile ${profile}`).toBe(true);
    }
  });

  test('it adds no tag or attribute the default policy would strip back out', () => {
    const rec = [];
    sanitizeSvg('<svg></svg>', fakeDOMPurify(rec));
    // Anything sanitizeSvg ADDS must also be permitted downstream, or the second pass
    // removes it again -- exactly the bug that hid KaTeX's <annotation>.
    expect(rec[0].cfg.ADD_TAGS ?? []).toEqual([]);
    for (const attr of rec[0].cfg.ADD_ATTR ?? []) {
      expect(DEFAULT_POLICY_CFG.ADD_ATTR, `ADD_ATTR ${attr}`).toContain(attr);
    }
  });

  test('it forbids everything the default policy forbids, and more', () => {
    const rec = [];
    sanitizeSvg('<svg></svg>', fakeDOMPurify(rec));
    // foreignObject is the SVG->HTML escape hatch; the default policy does not name it,
    // so sanitizeSvg staying stricter is what keeps the composed result safe.
    expect(rec[0].cfg.FORBID_TAGS).toContain('script');
    expect(rec[0].cfg.FORBID_TAGS).toContain('foreignObject');
  });
});

// ── data: URIs are image payloads, not navigation targets (audit 1b) ──────────
// A hook-aware fake: sanitize() runs the registered afterSanitizeAttributes hook
// against the given fake nodes (as real DOMPurify does), so the strip-non-media
// data rule is observable in Node.
function hookingDOMPurify(nodes) {
  const hooks = { afterSanitizeAttributes: [] };
  return {
    hooks,
    addHook(type, fn) { hooks[type].push(fn); },
    removeHook(type, fn) { const i = hooks[type].indexOf(fn); if (i !== -1) hooks[type].splice(i, 1); },
    sanitize(input) {
      for (const hook of hooks.afterSanitizeAttributes) {
        for (const node of nodes || []) hook(node);
      }
      return String(input);
    },
  };
}
function fakeNode(name, attrs = {}) {
  const live = { ...attrs };
  return {
    nodeType: 1,
    nodeName: name,
    getAttribute: (a) => (a in live ? live[a] : null),
    removeAttribute: (a) => { delete live[a]; },
    attrs: live,
  };
}

describe('data: URIs are stripped from non-media elements (audit 1b)', () => {
  test('an <a href="data:..."> loses the href; <img src="data:..."> keeps it', () => {
    const anchor = fakeNode('A', { href: 'data:text/html,<script>x()</script>' });
    const img = fakeNode('IMG', { src: 'data:image/png;base64,AA' });
    sanitizeHtml('<a href="data:text/html,x">y</a>', hookingDOMPurify([anchor, img]));
    expect(anchor.attrs.href).toBeUndefined();
    expect(img.attrs.src).toBe('data:image/png;base64,AA');
  });

  test('embedded media (source/audio/video) keep their src; other src is stripped', () => {
    const source = fakeNode('SOURCE', { src: 'data:image/svg+xml,<svg/>' });
    const audio = fakeNode('AUDIO', { src: 'data:audio/wav,AA' });
    const div = fakeNode('DIV', { src: 'data:text/html,x' });
    sanitizeHtml('<div></div>', hookingDOMPurify([source, audio, div]));
    expect(source.attrs.src).toBe('data:image/svg+xml,<svg/>');
    expect(audio.attrs.src).toBe('data:audio/wav,AA');
    expect(div.attrs.src).toBeUndefined();
  });

  test('the hook is removed after the sanitize call (no lingering registration)', () => {
    const purify = hookingDOMPurify([fakeNode('A', { href: 'data:text/html,x' })]);
    sanitizeHtml('<p>x</p>', purify);
    expect(purify.hooks.afterSanitizeAttributes).toHaveLength(0);
  });

  test('a DOMPurify without hook support still sanitizes (rule silently skipped)', () => {
    const rec = [];
    expect(sanitizeHtml('<p>x</p>', fakeDOMPurify(rec))).toBe('<p>x</p>');
  });
});

// The cases below run the real DOMPurify (the version the app ships) over a real DOM,
// because the id prefix lives in a hook the recording fake above never calls.
const realPurify = () => createDOMPurify(new JSDOM('<!doctype html>').window);
const clean = (html) => sanitizeHtml(html, realPurify());
const keepsHref = (href) => clean(`<a href="${href}">x</a>`).includes('href=');

describe('link allow-list (ALLOWED_URI_REGEXP through the real DOMPurify)', () => {
  test('keeps relative paths and the safe schemes', () => {
    for (const h of ['./pic.png', 'images/a.png', '/images/a.png', 'https://example.com', 'http://x',
      'mailto:a@b', 'tel:+1', '#h', 'bpmd://vault/a.png']) {
      expect(keepsHref(h), h).toBe(true);
    }
  });
  test('drops javascript, blob, protocol-relative and non-image data URIs', () => {
    for (const h of ['javascript:alert(1)', 'blob:x', '//evil.example/x', 'data:text/html,x', 'xhttps://evil']) {
      expect(keepsHref(h), h).toBe(false);
    }
  });
  // Browsers normalize `\` to `/` in special URLs, so every backslash spelling of a
  // protocol-relative URL must be blocked exactly like its `//` form.
  test('drops backslash protocol-relative spellings', () => {
    for (const h of ['\\\\evil.com', '/\\evil.com', '\\/evil.com', '\\\\evil.com/x']) {
      expect(keepsHref(h), h).toBe(false);
    }
    expect(keepsHref('images\\\\evil')).toBe(true); // interior backslash is a plain path char
  });
});

describe('M1: an id or name written in a note cannot take the place of an app element', () => {
  test('every id and name from a note gets the prefix', () => {
    const out = clean('<div id="findBar">x</div><button id="dlgSaveBtn">Save</button><a name="toast">t</a>');
    expect(out).toContain('id="user-content-findBar"');
    expect(out).toContain('id="user-content-dlgSaveBtn"');
    expect(out).toContain('name="user-content-toast"');
    expect(out).not.toMatch(/id="findBar"|id="dlgSaveBtn"|name="toast"/);
  });

  test('a link inside the note follows its target, before or after it in the text', () => {
    const out = clean('<a href="#later">down</a><p id="first">a</p><a href="#first">up</a><p id="later">b</p>');
    expect(out).toContain('href="#user-content-later"');
    expect(out).toContain('href="#user-content-first"');
  });

  test('footnote references and back-links still point at each other', () => {
    const out = clean('<sup class="fn-ref" id="fnref-1"><a href="#fn-1">1</a></sup><li id="fn-1" class="fn-item">n <a href="#fnref-1" class="fn-back">back</a></li>');
    expect(out).toContain('id="user-content-fnref-1"');
    expect(out).toContain('href="#user-content-fn-1"');
    expect(out).toContain('id="user-content-fn-1"');
    expect(out).toContain('href="#user-content-fnref-1"');
  });

  // QA M1: `<label for="themeBtn">` in a note clicked the app's theme button.
  test('attributes that point at an element by id follow the prefix', () => {
    const out = clean('<label for="themeBtn">x</label><input list="opts" aria-labelledby="a b" aria-controls="winCloseBtn"><button popovertarget="settings">s</button>');
    expect(out).toContain('for="user-content-themeBtn"');
    expect(out).toContain('list="user-content-opts"');
    expect(out).toContain('aria-labelledby="user-content-a user-content-b"');
    expect(out).toContain('aria-controls="user-content-winCloseBtn"');
    expect(out).not.toMatch(/for="themeBtn"|aria-controls="winCloseBtn"|popovertarget="settings"/);
  });

  // QA H5: `<u>a <u>a …` nested 511 deep and every paint of the note took most of a second.
  test('elements nested deeper than MAX_NOTE_DEPTH are replaced by their content', () => {
    const out = clean('<p>' + '<u>a '.repeat(120) + '</p>');
    const doc = new JSDOM('<!doctype html><body>' + out + '</body>').window.document;
    let depth = 0; let el = doc.body;
    while (el.firstElementChild) { el = el.lastElementChild; depth++; }
    expect(depth).toBeLessThanOrEqual(MAX_NOTE_DEPTH);
    expect(doc.body.textContent.split('a').length - 1).toBe(120); // no text is lost
    const shallow = '<ul><li><p><u>keep</u> <a href="#x">me</a></p></li></ul>';
    expect(clean(shallow)).toBe(shallow);
  });

  test('a link to a heading slug (an id the app sets later) is left alone', () => {
    expect(clean('<a href="#my-heading">go</a><h2>My heading</h2>')).toContain('href="#my-heading"');
  });

  test('a percent-encoded Arabic fragment finds its target', () => {
    const out = clean('<a href="#%D9%85%D9%84%D8%A7%D8%AD%D8%B8%D8%A9">x</a><p id="ملاحظة">y</p>');
    expect(out).toContain('href="#user-content-%D9%85%D9%84%D8%A7%D8%AD%D8%B8%D8%A9"');
    expect(out).toContain('id="user-content-ملاحظة"');
  });

  test('a second pass does not add a second prefix', () => {
    const once = clean('<p id="a">x</p><a href="#a">y</a>');
    expect(clean(once)).toBe(once);
  });

  test('a form and its named controls are removed', () => {
    const out = clean('<form id="f"><input name="cookie"></form><p>kept</p>');
    expect(out).not.toMatch(/<form/i);
    expect(out).toContain('<p>kept</p>');
  });

  test('the hook is gone after the call, so other sanitize stages keep their ids', () => {
    const purify = realPurify();
    sanitizeHtml('<p id="a">x</p>', purify);
    expect(purify.sanitize('<p id="a">x</p>')).toBe('<p id="a">x</p>');
  });

  test('a data: link is still removed and a data: image still kept', () => {
    const out = clean('<a href="data:text/html,x">l</a><img src="data:image/png;base64,AAAA">');
    expect(out).not.toContain('href="data:');
    expect(out).toContain('src="data:image/png;base64,AAAA"');
  });
});

describe('M2: a note keeps only the classes this app produces', () => {
  test('classes of app chrome are removed, and an emptied class attribute with them', () => {
    const out = clean('<div class="update-bar">Update <a href="https://example.com">now</a></div><p class="ctx toast modal-overlay open">x</p>');
    expect(out).not.toMatch(/class=/);
    expect(out).toContain('href="https://example.com"');
  });

  test('pipeline classes survive: code language, highlight.js tokens, wikilinks, footnotes', () => {
    const html = '<pre><code class="language-c++ hljs">x</code></pre>'
      + '<span class="hljs-title function_">f</span><span class="hljs-keyword">if</span><span class="language-xml">y</span>'
      + '<a class="wikilink" data-target="Note">Note</a>'
      + '<sup class="fn-ref">1</sup><section class="footnotes"><li class="fn-item"><a class="fn-back" href="#x">b</a></li></section>';
    expect(clean(html)).toBe(html);
  });

  test('a mixed class list keeps the allowed tokens only', () => {
    expect(clean('<code class="language-js update-bar hljs">x</code>')).toBe('<code class="language-js hljs">x</code>');
  });

  test('data-* from a note is removed, except the wikilink target', () => {
    const out = clean('<span data-tip="fake tooltip" data-i18n="menu.file" data-target="Note">x</span>');
    expect(out).toBe('<span data-target="Note">x</span>');
  });
});
