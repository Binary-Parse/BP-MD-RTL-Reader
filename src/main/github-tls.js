'use strict';

const https = require('https');
const crypto = require('crypto');
const { URL } = require('url');

/**
 * SHA-256 SPKI (Subject Public Key Info) pins — hex, no colons — of certificates ACCEPTED for
 * api.github.com. SEC-06: a response is trusted when ANY certificate presented in the chain
 * (leaf first) hashes to ANY entry. The pin check comes ON TOP of the normal TLS validation
 * and host name check of https.request; it can only refuse, never accept, a chain.
 *
 * Pin semantics matter: the hash is of the certificate's PUBLIC KEY, not the whole certificate.
 * A whole-certificate fingerprint changes on every routine re-issue, while the SPKI survives a
 * re-issue that reuses the key — and it is the same for a root and for its cross-signed copy.
 *
 * audit M37: an installed copy cannot be repaired after its pins stop matching, because the
 * update check is how it would learn of the repair. So the list holds two groups:
 *
 *  - LIVE_CHAIN_PINS: the four keys of the chain api.github.com presented on 2026-10-12, leaf
 *    to root. The leaf is re-issued about every 90 days and expires 2026-11-27; the roots live
 *    until 2038 and 2046. Verified against the live endpoint with `npm run tls:verify`.
 *  - BACKUP_ROOT_PINS: roots of the CAs GitHub used before or is likely to move to. They do
 *    not match today. Each value is the SPKI of the certificate of that NAME in the root store
 *    bundled with Node (`tls.rootCertificates`); tests/unit/github-tls.test.js proves every one.
 *
 * Accepted consequence (DECISIONS.md, 2026-10-12): a certificate for api.github.com issued
 * under any of these roots is accepted, not only GitHub's own key. The check only ever reads
 * a version number and the app opens one fixed URL, so this is the price of surviving a
 * rotation. When nothing matches, the app says so and points at the releases page.
 *
 * Mint a pin for a certificate you have in PEM form:
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
const LIVE_CHAIN_PINS = Object.freeze([
  { name: '*.github.com', pin: '4b62d421bab8c94839c3e3186e3e4b64e580640cda78d189f6b4d37381a3bc14' }, // leaf, to 2026-11-27
  { name: 'Sectigo Public Server Authentication CA DV E36', pin: '6526a0bc3ce396d2e47b05c406e0f1233a56fdda55c3526ebef99dd21864cdd6' }, // intermediate, to 2036
  { name: 'Sectigo Public Server Authentication Root E46', pin: 'b0b56335468561f5bb9fa12d801784a633a572705d34f32b643445dfa8b005d1' }, // root, to 2046
  { name: 'USERTrust ECC Certification Authority', pin: '2021917e98263945c859c43f1d73cb4139053c414fa03ca3bc7ee88614298f3b' }, // root, to 2038
]);

const BACKUP_ROOT_PINS = Object.freeze([
  { name: 'Sectigo Public Server Authentication Root R46', pin: '0e8bb18bbeefb381be21bfc1a206d317298462ad104855f04a0542699708d3d4' }, // the RSA twin of the live root, to 2046
  { name: 'USERTrust RSA Certification Authority', pin: 'c784333d20bcd742b9fdc3236f4e509b8937070e73067e254dd3bf9c45bf4dde' }, // the RSA twin of the live cross-signer, to 2038
  { name: 'DigiCert Global Root G2', pin: '8bb593a93be1d0e8a822bb887c547890c3e706aad2dab76254f97fb36b82fc26' }, // GitHub's CA before 2025, to 2038
  { name: 'DigiCert Global Root G3', pin: 'b94c198300cec5c057ad0727b70bbe91816992256439a7b32f4598119dda9c97' }, // its elliptic-curve twin, to 2038
  { name: 'ISRG Root X1', pin: '0b9fa5a59eed715c26c1020c711b4f6ec42d58b0015e14337a39dad301c5afc3' }, // Let's Encrypt, to 2035
  { name: 'ISRG Root X2', pin: '762195c225586ee6c0237456e2107dc54f1efc21f61a792ebd515913cce68332' }, // Let's Encrypt, elliptic curve, to 2040
]);

const DEFAULT_CERT_PINS = Object.freeze([...LIVE_CHAIN_PINS, ...BACKUP_ROOT_PINS].map((entry) => entry.pin));

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
  LIVE_CHAIN_PINS,
  BACKUP_ROOT_PINS,
  normalizePin,
  pinMatches,
  spkiPinOf,
  chainSpkiPins,
  isGithubApiUrl,
  createPinnedGithubFetch,
};
