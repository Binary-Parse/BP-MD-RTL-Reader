'use strict';

/**
 * Release-gate check: verifies DEFAULT_CERT_PINS against the LIVE api.github.com certificate
 * chain. Exit 0 = at least one pin matches the presented chain; exit 1 = no match (or the
 * endpoint was unreachable) — in both cases the update check would be fail-closed dead, so
 * the pin list must be re-minted before a release (see src/main/github-tls.js).
 *
 * Run: npm run tls:verify
 */

const tls = require('tls');
const { DEFAULT_CERT_PINS, chainSpkiPins, normalizePin } = require('../src/main/github-tls');

const wanted = new Set(DEFAULT_CERT_PINS.map(normalizePin));
const socket = tls.connect(
  { host: 'api.github.com', port: 443, servername: 'api.github.com', rejectUnauthorized: true },
  () => {
    const cert = socket.getPeerCertificate(true);
    const presented = chainSpkiPins(cert);
    const matched = presented.filter((pin) => wanted.has(normalizePin(pin)));
    const leaf = cert && cert.subject && cert.subject.CN ? cert.subject.CN : '(unknown)';
    const validTo = cert && cert.valid_to ? cert.valid_to : '(unknown)';
    console.log(`api.github.com leaf CN=${leaf}, valid to ${validTo}`);
    console.log(`presented-chain SPKI pins (${presented.length}):`);
    for (const pin of presented) {
      console.log(`  ${wanted.has(normalizePin(pin)) ? 'PINNED' : '      '} ${pin}`);
    }
    socket.end();
    if (matched.length > 0) {
      console.log(`tls:verify OK — ${matched.length} of ${DEFAULT_CERT_PINS.length} pins matched the live chain.`);
      process.exit(0);
    }
    console.error('tls:verify FAILED — no pin matched the live chain. Re-mint DEFAULT_CERT_PINS before release.');
    process.exit(1);
  }
);

socket.setTimeout(10000, () => {
  socket.destroy(new Error('timeout after 10s'));
});
socket.on('error', (err) => {
  console.error(`tls:verify FAILED — could not reach api.github.com: ${err.message}`);
  process.exit(1);
});
