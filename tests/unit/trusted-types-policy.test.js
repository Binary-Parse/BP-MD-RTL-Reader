import { describe, expect, test, vi } from 'vitest';
import { isAllowedVendorScriptUrl, installTrustedTypes } from '../../src/renderer/trusted-types-policy.js';

describe('trusted types policy', () => {
  test('allows same-origin vendor mermaid and CM6 script URLs', () => {
    expect(isAllowedVendorScriptUrl('../../resources/vendor/mermaid/mermaid.min.js')).toBe(true);
    expect(isAllowedVendorScriptUrl('../../resources/vendor/codemirror/codemirror.min.js')).toBe(true);
  });

  test('blocks remote, traversal, and non-js URLs', () => {
    expect(isAllowedVendorScriptUrl('https://evil.example/x.js')).toBe(false);
    expect(isAllowedVendorScriptUrl('../../resources/vendor/../main/index.js')).toBe(false);
    expect(isAllowedVendorScriptUrl('../../resources/vendor/x.txt')).toBe(false);
  });

  test('installs a default policy that sanitizes HTML and rejects bad script URLs', () => {
    const createPolicy = vi.fn((_name, spec) => spec);
    const DOMPurify = { sanitize: vi.fn((html) => `clean:${html}`) };
    const policy = installTrustedTypes({ createPolicy }, DOMPurify);
    expect(createPolicy).toHaveBeenCalledWith('default', expect.any(Object));
    expect(policy.createHTML('<p>x</p>')).toBe('clean:<p>x</p>');
    expect(() => policy.createScriptURL('https://x/x.js')).toThrow(/blocked/);
    expect(policy.createScriptURL('../../resources/vendor/mermaid/mermaid.min.js'))
      .toBe('../../resources/vendor/mermaid/mermaid.min.js');
  });

  test('does not install a policy when createPolicy is unavailable', () => {
    expect(installTrustedTypes({}, { sanitize: () => 'x' })).toBeNull();
    expect(installTrustedTypes(null, { sanitize: () => 'x' })).toBeNull();
  });

  test('createHTML fails closed when DOMPurify is missing', () => {
    const policy = installTrustedTypes({ createPolicy: (_name, spec) => spec }, null);
    expect(policy.createHTML('<p>x</p>')).toBe('');
  });

  test('rejects non-string, backslash, and null-byte script URLs', () => {
    expect(isAllowedVendorScriptUrl(null)).toBe(false);
    expect(isAllowedVendorScriptUrl('../../resources/vendor/mermaid\\mermaid.min.js')).toBe(false);
    expect(isAllowedVendorScriptUrl('../../resources/vendor/mermaid/mermaid.min.js\0.js')).toBe(false);
  });
});

// Audit B7: the policy is the last gate before the HTML sink and the script loader, so its
// exact behaviour is pinned here, not only "something is sanitized".
describe('trusted types policy — exact contract', () => {
  const VENDOR = '../../resources/vendor/';

  test('a vendor script URL is accepted only as the exact relative path of a .js file', () => {
    expect(isAllowedVendorScriptUrl(`${VENDOR}a.js`)).toBe(true);
    expect(isAllowedVendorScriptUrl(`${VENDOR}katex/contrib/auto-render_v2.min.js`)).toBe(true);
    // nothing may come before or after the path
    expect(isAllowedVendorScriptUrl(`x${VENDOR}a.js`)).toBe(false);
    expect(isAllowedVendorScriptUrl(`/${VENDOR}a.js`)).toBe(false);
    expect(isAllowedVendorScriptUrl(`${VENDOR}a.js.map`)).toBe(false);
    expect(isAllowedVendorScriptUrl(`${VENDOR}a.js?x=1`)).toBe(false);
    expect(isAllowedVendorScriptUrl(`${VENDOR}a.js#frag`)).toBe(false);
    expect(isAllowedVendorScriptUrl(`${VENDOR}a.mjs`)).toBe(false);
    expect(isAllowedVendorScriptUrl(`${VENDOR}ajs`)).toBe(false);
    expect(isAllowedVendorScriptUrl(`${VENDOR}.js`)).toBe(false);
    expect(isAllowedVendorScriptUrl(VENDOR)).toBe(false);
    expect(isAllowedVendorScriptUrl('')).toBe(false);
    expect(isAllowedVendorScriptUrl('../resources/vendor/a.js')).toBe(false);
    expect(isAllowedVendorScriptUrl('../../resources/vendors/a.js')).toBe(false);
  });

  test('surrounding white space is ignored, white space inside is not', () => {
    expect(isAllowedVendorScriptUrl(`  ${VENDOR}a.js\n`)).toBe(true);
    expect(isAllowedVendorScriptUrl(`${VENDOR}a b.js`)).toBe(false);
  });

  test('two dots anywhere after the vendor folder are refused, single dots are fine', () => {
    expect(isAllowedVendorScriptUrl(`${VENDOR}a..b.js`)).toBe(false);
    expect(isAllowedVendorScriptUrl(`${VENDOR}x/../y.js`)).toBe(false);
    expect(isAllowedVendorScriptUrl(`${VENDOR}..js`)).toBe(false);
    expect(isAllowedVendorScriptUrl(`${VENDOR}a.b.min.js`)).toBe(true);
    expect(isAllowedVendorScriptUrl(`${VENDOR}./a.js`)).toBe(true);
  });

  test('absolute URLs, other schemes and non-strings are refused', () => {
    for (const url of ['app://ui/resources/vendor/a.js', `${VENDOR}http://x/a.js`, 'javascript:alert(1)', 'data:text/javascript,1',
      `${VENDOR}a\\b.js`, `${VENDOR}a\0.js`, undefined, 42, {}, [`${VENDOR}a.js`]]) {
      expect(isAllowedVendorScriptUrl(url)).toBe(false);
    }
  });

  test('HTML is sanitized with exactly the reviewed DOMPurify configuration', () => {
    const DOMPurify = { sanitize: vi.fn(() => 'clean') };
    const policy = installTrustedTypes({ createPolicy: (_name, spec) => spec }, DOMPurify);
    expect(policy.createHTML('<b>x</b>')).toBe('clean');
    expect(DOMPurify.sanitize).toHaveBeenCalledTimes(1);
    expect(DOMPurify.sanitize).toHaveBeenCalledWith('<b>x</b>', {
      USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true },
      ADD_ATTR: ['style', 'id', 'data-target', 'dir', 'lang'],
      FORBID_TAGS: ['script', 'iframe', 'object', 'embed'],
    });
  });

  test('whatever is passed as HTML reaches the sanitizer as a string; nothing becomes the empty string', () => {
    const DOMPurify = { sanitize: vi.fn((html) => html) };
    const policy = installTrustedTypes({ createPolicy: (_name, spec) => spec }, DOMPurify);
    expect(policy.createHTML(null)).toBe('');
    expect(policy.createHTML(undefined)).toBe('');
    expect(policy.createHTML(0)).toBe('0');
    expect(policy.createHTML(false)).toBe('false');
    expect(DOMPurify.sanitize.mock.calls.map((call) => call[0])).toEqual(['', '', '0', 'false']);
  });

  test('a sanitizer object without a sanitize function fails closed', () => {
    for (const broken of [undefined, {}, { sanitize: 'nope' }]) {
      const policy = installTrustedTypes({ createPolicy: (_name, spec) => spec }, broken);
      expect(policy.createHTML('<p>x</p>')).toBe('');
    }
  });

  test('the policy is the default one and has exactly the two creators', () => {
    const createPolicy = vi.fn((_name, spec) => spec);
    const policy = installTrustedTypes({ createPolicy }, { sanitize: (html) => html });
    expect(createPolicy).toHaveBeenCalledTimes(1);
    expect(createPolicy.mock.calls[0][0]).toBe('default');
    expect(Object.keys(policy).sort()).toEqual(['createHTML', 'createScriptURL']);
  });

  test('a refused script URL throws a TypeError and an accepted one is returned unchanged', () => {
    const policy = installTrustedTypes({ createPolicy: (_name, spec) => spec }, null);
    expect(() => policy.createScriptURL('https://evil.example/x.js')).toThrow(TypeError);
    expect(() => policy.createScriptURL('https://evil.example/x.js')).toThrow('blocked script URL');
    expect(() => policy.createScriptURL(undefined)).toThrow(TypeError);
    expect(policy.createScriptURL(` ${VENDOR}a.js `)).toBe(` ${VENDOR}a.js `);
  });

  test('no policy is installed when the API is missing or createPolicy is not a function', () => {
    for (const api of [undefined, null, {}, { createPolicy: 'x' }, 0]) {
      expect(installTrustedTypes(api, { sanitize: (html) => html })).toBeNull();
    }
  });
});
