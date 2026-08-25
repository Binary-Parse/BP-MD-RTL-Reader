'use strict';

const https = require('https');
const { URL } = require('url');

/** SHA-256 of the current api.github.com leaf certificate (hex, no colons). Refresh if update:check fails TLS pin. */
const DEFAULT_CERT_PINS = Object.freeze([
  'b42b6ae85214f31f3ef5d48e1180a46fb9c0d7d8fe8fd202256650cd52e059e8',
]);

function normalizePin(value) {
  return String(value || '').replace(/:/g, '').toLowerCase();
}

function pinMatches(fingerprint256, pins) {
  const got = normalizePin(fingerprint256);
  return (pins || DEFAULT_CERT_PINS).some((pin) => normalizePin(pin) === got);
}

function isGithubApiUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === 'api.github.com';
  } catch (_) {
    return false;
  }
}

function createPinnedGithubFetch({ requestFn = https.request, pins = DEFAULT_CERT_PINS } = {}) {
  return function pinnedGithubFetch(url, options = {}) {
    if (!isGithubApiUrl(url)) {
      return Promise.reject(new Error('blocked-host'));
    }
    const parsed = new URL(url);
    const headers = { ...(options.headers || {}) };
    return new Promise((resolve, reject) => {
      const req = requestFn({
        protocol: 'https:',
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: options.method || 'GET',
        headers,
        servername: 'api.github.com',
      }, (res) => {
        const cert = res.socket && typeof res.socket.getPeerCertificate === 'function'
          ? res.socket.getPeerCertificate()
          : null;
        if (!cert || !pinMatches(cert.fingerprint256, pins)) {
          res.resume();
          reject(new Error('tls-pin-mismatch'));
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            json: async () => JSON.parse(body),
          });
        });
      });
      req.on('error', reject);
      if (options.signal && typeof options.signal.addEventListener === 'function') {
        const abort = () => req.destroy(new Error('aborted'));
        if (options.signal.aborted) abort();
        else options.signal.addEventListener('abort', abort, { once: true });
      }
      req.end();
    });
  };
}

module.exports = {
  DEFAULT_CERT_PINS,
  pinMatches,
  isGithubApiUrl,
  createPinnedGithubFetch,
};
