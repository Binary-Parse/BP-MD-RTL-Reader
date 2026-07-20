import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workflow = readFileSync(path.join(root, '.github/workflows/claude.yml'), 'utf8');

describe('privileged Claude workflow supply-chain policy', () => {
  test('every action reference is an immutable full commit SHA', () => {
    const refs = [...workflow.matchAll(/^\s*uses:\s*([^\s#]+)(?:\s*#.*)?$/gm)].map(match => match[1]);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) expect(ref).toMatch(/^[^@\s]+@[0-9a-f]{40}$/);
  });

  test('does not grant an unused OIDC token permission', () => {
    expect(workflow).not.toMatch(/^\s*id-token:\s*write\s*$/m);
  });
});
