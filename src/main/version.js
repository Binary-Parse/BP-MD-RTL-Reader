/** Strict SemVer 2.0 parsing/comparison for the opt-in update check. */

const SEMVER = /^[vV]?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

function parse(value) {
  if (typeof value !== 'string') return null;
  const match = SEMVER.exec(value.trim());
  if (!match) return null;
  const prerelease = match[4] ? match[4].split('.').map(identifier => {
    if (/^\d+$/.test(identifier)) {
      if (identifier.length > 1 && identifier[0] === '0') return null;
      return Number(identifier);
    }
    return identifier;
  }) : [];
  if (prerelease.includes(null)) return null;
  return {
    major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]),
    prerelease, build: match[5] ? match[5].split('.') : [],
  };
}

function compareVersions(a, b) {
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return null;
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] > right[key]) return 1;
    if (left[key] < right[key]) return -1;
  }
  if (!left.prerelease.length && !right.prerelease.length) return 0;
  if (!left.prerelease.length) return 1;
  if (!right.prerelease.length) return -1;
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let i = 0; i < length; i++) {
    if (left.prerelease[i] === undefined) return -1;
    if (right.prerelease[i] === undefined) return 1;
    const x = left.prerelease[i];
    const y = right.prerelease[i];
    if (x === y) continue;
    if (typeof x === 'number' && typeof y !== 'number') return -1;
    if (typeof x !== 'number' && typeof y === 'number') return 1;
    return x > y ? 1 : -1;
  }
  return 0;
}

module.exports = { compareVersions, parse };
