/**
 * Trusted Types policy helpers (CSP require-trusted-types-for 'script').
 * Pure so Node unit tests can cover URL and sanitizer guards without Electron.
 */

const VENDOR_SCRIPT = /^\.\.\/\.\.\/resources\/vendor\/[A-Za-z0-9_./-]+\.js$/;

export function isAllowedVendorScriptUrl(url) {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (trimmed.includes('\\') || trimmed.includes('\0')) return false;
  if (trimmed.includes('://')) return false;
  if (!VENDOR_SCRIPT.test(trimmed)) return false;
  return !trimmed.slice('../../resources/vendor/'.length).includes('..');
}

export function installTrustedTypes(trustedTypesApi, DOMPurify) {
  if (!trustedTypesApi || typeof trustedTypesApi.createPolicy !== 'function') return null;
  const sanitize = (html) => {
    if (!DOMPurify || typeof DOMPurify.sanitize !== 'function') return '';
    return DOMPurify.sanitize(String(html ?? ''), {
      USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true },
      ADD_ATTR: ['style', 'id', 'data-target', 'dir', 'lang'],
      FORBID_TAGS: ['script', 'iframe', 'object', 'embed'],
    });
  };
  return trustedTypesApi.createPolicy('default', {
    createHTML: (html) => sanitize(html),
    createScriptURL: (url) => {
      if (!isAllowedVendorScriptUrl(url)) throw new TypeError('blocked script URL');
      return url;
    },
  });
}
