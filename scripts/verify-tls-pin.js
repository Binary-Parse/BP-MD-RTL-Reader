'use strict';

/**
 * Release-gate check: verifies the pins of src/main/github-tls.js against the LIVE
 * api.github.com certificate chain.
 *
 *  exit 1  no pin matches (or the endpoint was unreachable): the update check would be
 *          fail-closed dead; re-mint LIVE_CHAIN_PINS before a release.
 *  exit 0  at least one pin matches. A WARNING is printed when the leaf pin no longer matches
 *          or when only backup roots match: the check still works, but LIVE_CHAIN_PINS
 *          describes a chain GitHub has left and should be re-minted (audit M37).
 *
 * Run: npm run tls:verify
 */

const tls = require('tls');
const { LIVE_CHAIN_PINS, BACKUP_ROOT_PINS, chainSpkiPins, normalizePin } = require('../src/main/github-tls');

const nameOf = (list, pin) => (list.find((entry) => normalizePin(entry.pin) === normalizePin(pin)) || {}).name;
const socket = tls.connect(
  { host: 'api.github.com', port: 443, servername: 'api.github.com', rejectUnauthorized: true },
  () => {
    const cert = socket.getPeerCertificate(true);
    const presented = chainSpkiPins(cert);
    const leaf = cert && cert.subject && cert.subject.CN ? cert.subject.CN : '(unknown)';
    const validTo = cert && cert.valid_to ? cert.valid_to : '(unknown)';
    console.log(`api.github.com leaf CN=${leaf}, valid to ${validTo}`);
    console.log(`presented-chain SPKI pins (${presented.length}):`);
    let live = 0;
    let backup = 0;
    for (const pin of presented) {
      const liveName = nameOf(LIVE_CHAIN_PINS, pin);
      const backupName = nameOf(BACKUP_ROOT_PINS, pin);
      if (liveName) live += 1;
      else if (backupName) backup += 1;
      const mark = liveName ? `LIVE   ${liveName}` : backupName ? `BACKUP ${backupName}` : '';
      console.log(`  ${pin} ${mark}`);
    }
    socket.end();
    if (live + backup === 0) {
      console.error('tls:verify FAILED — no pin matched the live chain. Re-mint LIVE_CHAIN_PINS before release.');
      process.exit(1);
    }
    const leafPinned = presented.length > 0 && !!nameOf(LIVE_CHAIN_PINS, presented[0]);
    console.log(`tls:verify OK — ${live} of ${LIVE_CHAIN_PINS.length} live-chain pins and ${backup} backup root(s) matched.`);
    if (live === 0) console.warn('WARNING — only backup roots match: GitHub changed its CA. Re-mint LIVE_CHAIN_PINS.');
    else if (!leafPinned) console.warn('WARNING — the leaf pin no longer matches (GitHub re-issued its leaf with a new key). The CA pins carry the check; re-mint the leaf pin.');
    process.exit(0);
  }
);

socket.setTimeout(10000, () => {
  socket.destroy(new Error('timeout after 10s'));
});
socket.on('error', (err) => {
  console.error(`tls:verify FAILED — could not reach api.github.com: ${err.message}`);
  process.exit(1);
});
