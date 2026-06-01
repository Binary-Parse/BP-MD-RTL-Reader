/**
 * trusted.test.js — T-AI2 content pipeline hardening.
 * Uses a recording fake DOMPurify to assert configs and a tiny real strip for SVG.
 */
import { describe, test, expect } from 'vitest';
import { sanitizeHtml, sanitizeSvg, katexOptions, isSafeHref, renderTrusted } from '../../src/renderer/trusted.js';

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
