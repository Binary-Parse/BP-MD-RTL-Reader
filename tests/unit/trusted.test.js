/**
 * trusted.test.js — T-AI2 content pipeline hardening.
 * Uses a recording fake DOMPurify to assert configs and a tiny real strip for SVG.
 */
import { describe, test, expect } from 'vitest';
import { sanitizeHtml, sanitizeSvg, sanitizeMath, katexOptions, isSafeHref, renderTrusted } from '../../src/renderer/markdown/trusted.js';

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

describe('isSafeHref (EC-B5/B6)', () => {
  test('allows http(s)/mailto/tel/#/bpmd', () => {
    for (const h of ['https://x', 'http://x', 'mailto:a@b', 'tel:+1', '#h', 'bpmd://vault/a.png']) {
      expect(isSafeHref(h)).toBe(true);
    }
  });
  test('blocks javascript/data/blob', () => {
    for (const h of ['javascript:x', 'data:x', 'blob:x', 5]) expect(isSafeHref(h)).toBe(false);
  });
});

describe('renderTrusted', () => {
  test('falls back to escapeHtml when marked missing', () => {
    expect(renderTrusted('<b>', { escapeHtml: (s) => s.replace('<', '&lt;') })).toBe('&lt;b>');
  });
  test('parses then sanitizes', () => {
    const rec = [];
    const marked = { parse: (m) => `<p>${m}</p><script>x</script>` };
    const out = renderTrusted('hi', { marked, DOMPurify: fakeDOMPurify(rec) });
    expect(out).toBe('<p>hi</p>');
  });
});

// ── Mutation-hardening (audit F-3): assert the EXACT sanitizer config + every guard. ──
describe('sanitizer config — exact arrays (kills element-drop mutants)', () => {
  test('sanitizeHtml passes the full forbid/add lists verbatim', () => {
    const rec = []; sanitizeHtml('<p>x</p>', fakeDOMPurify(rec));
    expect(rec[0].cfg.ADD_ATTR).toEqual(['id', 'data-target', 'dir', 'lang']);
    expect(rec[0].cfg.FORBID_TAGS).toEqual(['script', 'style', 'iframe', 'object', 'embed']);
    expect(rec[0].cfg.FORBID_ATTR).toEqual(['style', 'onerror', 'onload', 'onclick']);
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
  test('renderTrusted with a real marked but null DOMPurify yields the sanitized empty string', () => {
    const marked = { parse: (m) => `<p>${m}</p>` };
    expect(renderTrusted('hi', { marked, DOMPurify: null })).toBe('');
  });
  test('renderTrusted with no escapeHtml stringifies md when marked missing', () => {
    expect(renderTrusted('<b>', {})).toBe('<b>');
    expect(renderTrusted(null, {})).toBe('');
    expect(renderTrusted(undefined, { marked: { parse: 'x' } })).toBe(''); // marked.parse not a fn
  });
});

describe('isSafeHref — anchoring + trim (kills regex/trim mutants)', () => {
  test('the scheme must be at the START (anchored ^) — embedded scheme is unsafe', () => {
    expect(isSafeHref('xhttps://evil')).toBe(false);
    expect(isSafeHref('data:text/html,https://x')).toBe(false);
    expect(isSafeHref('javascript:void(https://x)')).toBe(false);
  });
  test('leading/trailing whitespace is trimmed before the scheme test', () => {
    expect(isSafeHref('   https://x  ')).toBe(true);   // trim() makes this pass
    expect(isSafeHref('\tmailto:a@b')).toBe(true);
  });
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
    expect(katexOptions({ trust: true }).trust).toBe(true);
  });
});
