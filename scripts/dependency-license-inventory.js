'use strict';

const crypto = require('crypto');
const fs = require('fs');

function buildInventory(lockBytes = fs.readFileSync('package-lock.json')) {
  const lock = JSON.parse(lockBytes.toString('utf8'));
  const entries = Object.entries(lock.packages || {}).filter(([packagePath]) => packagePath !== '');
  const packageNames = new Set();
  const licenseCounts = new Map();
  let missingLicenseEntries = 0;

  for (const [packagePath, metadata] of entries) {
    const packageName = packagePath.split('node_modules/').pop();
    if (packageName) packageNames.add(packageName);
    const license = Array.isArray(metadata.license)
      ? metadata.license.join(' OR ')
      : (metadata.license || 'MISSING');
    if (!metadata.license) missingLicenseEntries++;
    licenseCounts.set(license, (licenseCounts.get(license) || 0) + 1);
  }

  const licenses = Object.fromEntries([...licenseCounts.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
  return {
    schemaVersion: 1,
    generator: 'scripts/dependency-license-inventory.js@1',
    source: 'package-lock.json',
    sourceSha256: crypto.createHash('sha256').update(lockBytes).digest('hex'),
    lockfileVersion: lock.lockfileVersion,
    packageEntries: entries.length,
    uniquePackageNames: packageNames.size,
    missingLicenseEntries,
    licenses,
  };
}

function main() {
  const generated = buildInventory();
  if (process.argv.includes('--write')) {
    fs.writeFileSync('docs/dependency-license-inventory.json', JSON.stringify(generated, null, 2) + '\n');
    console.log('Wrote docs/dependency-license-inventory.json');
    return;
  }
  const committed = JSON.parse(fs.readFileSync('docs/dependency-license-inventory.json', 'utf8'));
  if (JSON.stringify(committed) !== JSON.stringify(generated)) {
    throw new Error('Dependency license inventory is stale; run npm run license:inventory:update.');
  }
  console.log(`Dependency license inventory verified: ${generated.packageEntries} lock entries, ${generated.missingLicenseEntries} missing license field(s).`);
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exit(1); }
}

module.exports = { buildInventory };
