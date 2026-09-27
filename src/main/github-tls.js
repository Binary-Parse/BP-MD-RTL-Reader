'use strict';

const https = require('https');
const crypto = require('crypto');
const { URL } = require('url');

/**
 * SHA-256 SPKI (Subject Public Key Info) pins — hex, no colons — of certificates ACCEPTED for
 * api.github.com. SEC-06: a response is trusted when ANY certificate presented in the chain
 * (leaf first) hashes to ANY entry, so a planned rotation is a one-line addition here instead
 * of a client release that has to land before the old pin stops matching.
 *
 * Pin semantics matter: the hash is of the certificate's PUBLIC KEY, not the whole certificate.
 * A whole-certificate fingerprint changes on every routine re-issue, while the SPKI survives a
 * re-issue that reuses the key — and GitHub re-issues its leaf roughly every 90 days.
 *
 * Entry 1 is the live leaf (CN=*.github.com). Entry 2 is its issuing intermediate CA, kept as
 * the rotation backup: when the leaf is re-issued under the same CA, entry 2 still matches and
 * the update check keeps working until a human mints a fresh leaf pin. Both entries were
 * verified against the live endpoint with `npm run tls:verify` on 2026-09-22.
 *
 * Mint a replacement (or backup) pin for a certificate you have in PEM form:
 *   openssl x509 -in cert.pem -pubkey -noout | openssl pkey -pubin -outform DER | openssl dgst -sha256
 *
 * Verify this list against the LIVE endpoint (release-gate step — see docs/BUILD.md):
 *   npm run tls:verify
 *
 * NEVER leave a placeholder (e.g. a "TODO-OWNER" style value) or an unverified hash in this
 * list: matching is fail-closed, so a bogus entry helps nobody — it only makes a future mistake
 * look like a working rotation (the 1.3.0 pin `b42b6ae8…` shipped unverified and matched no
 * live value, which is exactly the failure mode this note exists to prevent).
 */
const DEFAULT_CERT_PINS = Object.freeze([
  '4b62d421bab8c94839c3e3186e3e4b64e580640cda78d189f6b4d37381a3bc14', // leaf: *.github.com
  '6526a0bc3ce396d2e47b05c406e0f1233a56fdda55c3526ebef99dd21864cdd6', // issuing intermediate CA
]);

const MAX_RESPONSE_BYTES = 1024 * 1024;

function normalizePin(value) {
  return String(value || '').replace(/:/g, '').toLowerCase();
}

/** SPKI SHA-256 of one DER certificate (the `raw` field of a peer-certificate object). */
function spkiPinOf(cert) {
  try {
    const x509 = new crypto.X509Certificate(cert.raw);
    return crypto.createHash('sha256')
      .update(x509.publicKey.export({ type: 'spki', format: 'der' }))
      .digest('hex');
  } catch (_) {
    return null;
  }
}

/** SPKI pins for every certificate in the presented chain, leaf first; cycle-safe. */
function chainSpkiPins(cert) {
  const seen = new Set();
  const pins = [];
  let current = cert;
  while (current && current.raw && !seen.has(current.fingerprint256)) {
    seen.add(current.fingerprint256);
    const pin = spkiPinOf(current);
    if (pin) pins.push(pin);
    current = current.issuerCertificate;
  }
  return pins;
}

function pinMatches(cert, pins) {
  const wanted = (pins || DEFAULT_CERT_PINS).map(normalizePin);
  return chainSpkiPins(cert).some((pin) => wanted.includes(normalizePin(pin)));
}

function isGithubApiUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === 'api.github.com';
  } catch (_) {
    return false;
  }
}

function createPinnedGithubFetch({ requestFn = https.request, pins = DEFAULT_CERT_PINS, maxResponseBytes = MAX_RESPONSE_BYTES } = {}) {
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
          ? res.socket.getPeerCertificate(true)
          : null;
        if (!cert || !pinMatches(cert, pins)) {
          res.resume();
          reject(new Error('tls-pin-mismatch'));
          return;
        }
        const chunks = [];
        let received = 0;
        res.on('data', (c) => {
          received += c.length;
          if (received > maxResponseBytes) {
            req.destroy(new Error('response-too-large'));
            reject(new Error('response-too-large'));
            return;
          }
          chunks.push(c);
        });
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
  normalizePin,
  pinMatches,
  spkiPinOf,
  chainSpkiPins,
  isGithubApiUrl,
  createPinnedGithubFetch,
};
