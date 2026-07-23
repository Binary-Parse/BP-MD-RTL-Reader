'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function currentCommit(root = process.cwd()) {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: root, encoding: 'utf8', shell: false,
  });
  if (result.status !== 0) throw new Error('Unable to determine current Git commit for coverage metadata');
  return result.stdout.trim();
}

function writeCoverageMetadata(directory, kind, extra = {}) {
  fs.mkdirSync(directory, { recursive: true });
  const metadata = {
    schemaVersion: 1,
    kind,
    commit: currentCommit(),
    generatedAt: new Date().toISOString(),
    ...extra,
  };
  fs.writeFileSync(path.join(directory, 'run-metadata.json'), JSON.stringify(metadata, null, 2) + '\n');
  return metadata;
}

function loadCoverageInput(coveragePath, expectedKind, { maxAgeMs = 6 * 60 * 60 * 1000 } = {}) {
  if (!fs.existsSync(coveragePath)) throw new Error('Missing required coverage input: ' + coveragePath);
  const coverage = JSON.parse(fs.readFileSync(coveragePath, 'utf8'));
  if (!coverage || typeof coverage !== 'object' || Object.keys(coverage).length === 0) {
    throw new Error('Coverage input is empty: ' + coveragePath);
  }
  const metadataPath = path.join(path.dirname(coveragePath), 'run-metadata.json');
  if (!fs.existsSync(metadataPath)) throw new Error('Missing coverage run metadata: ' + metadataPath);
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  if (metadata.kind !== expectedKind) throw new Error('Unexpected coverage kind in ' + metadataPath);
  if (metadata.commit !== currentCommit()) throw new Error('Stale coverage commit in ' + metadataPath);
  const generatedAt = Date.parse(metadata.generatedAt);
  if (!Number.isFinite(generatedAt) || Date.now() - generatedAt > maxAgeMs || generatedAt > Date.now() + 60_000) {
    throw new Error('Stale or invalid coverage timestamp in ' + metadataPath);
  }
  return { coverage, metadata };
}

module.exports = { currentCommit, writeCoverageMetadata, loadCoverageInput };
