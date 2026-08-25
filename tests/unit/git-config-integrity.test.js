import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Git classifies a file as binary when its contents include a NUL byte, and a
// binary .gitignore/.gitattributes/.mailmap diffs as "Binary files differ" —
// silently unreviewable in a PR. These files are hand-edited often enough (and
// by tooling that can paste raw control characters) that the invariant is worth
// pinning. See scripts/rem-convert.mjs for the escaped-sentinel pattern that
// keeps deliberate NULs out of source.
const GIT_CONFIG_FILES = ['.gitignore', '.gitattributes', '.mailmap'];

// Built, never written literally: a raw NUL in this file would be the very bug
// the suite is here to catch.
const NUL = String.fromCharCode(0);

const read = (file) => readFileSync(path.resolve(file), 'utf8');

describe('git layer configuration files stay reviewable', () => {
  test.each(GIT_CONFIG_FILES)('%s contains no NUL bytes', (file) => {
    const offsets = [...read(file)]
      .map((character, index) => (character === NUL ? index : -1))
      .filter((index) => index !== -1);
    expect(offsets).toEqual([]);
  });

  test.each(GIT_CONFIG_FILES)('%s uses LF line endings only', (file) => {
    expect(read(file)).not.toMatch(/\r/);
  });

  test('.gitattributes declares itself and its siblings as LF text', () => {
    const attributes = read('.gitattributes');
    for (const file of GIT_CONFIG_FILES) {
      expect(attributes).toMatch(new RegExp(`^\\${file}\\s+text eol=lf`, 'm'));
    }
  });

  test('.gitignore keeps the secret guardrails that are supposed to never match', () => {
    const lines = read('.gitignore').split('\n');
    for (const pattern of ['.env', '*.pem', '*.key', '*.p12', '*.pfx', '*.p8']) {
      expect(lines).toContain(pattern);
    }
  });
});
