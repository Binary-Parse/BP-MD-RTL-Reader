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
