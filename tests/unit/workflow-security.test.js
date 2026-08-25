import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workflowsDir = path.join(root, '.github/workflows');

function readWorkflow(name) {
  return readFileSync(path.join(workflowsDir, name), 'utf8');
}

describe('privileged Claude workflow supply-chain policy', () => {
  const workflow = readWorkflow('claude.yml');

  test('every action reference is an immutable full commit SHA', () => {
    const refs = [...workflow.matchAll(/^\s*uses:\s*([^\s#]+)(?:\s*#.*)?$/gm)].map(match => match[1]);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) expect(ref).toMatch(/^[^@\s]+@[0-9a-f]{40}$/);
  });

  test('does not grant an unused OIDC token permission', () => {
    expect(workflow).not.toMatch(/^\s*id-token:\s*write\s*$/m);
  });

  test('checkout does not persist credentials for later steps', () => {
    expect(workflow).toMatch(/persist-credentials:\s*false/);
  });

  test('runs harden-runner before privileged actions', () => {
    expect(workflow).toMatch(/step-security\/harden-runner@[0-9a-f]{40}/);
  });

  test('declares a read-only top-level permissions default', () => {
    expect(workflow).toMatch(/^permissions:\n\s+contents:\s*read$/m);
  });

  // Each trigger carries author_association on a different payload object, so one
  // shared clause would silently evaluate false for the events that lack it.
  test('gates every trigger on a trusted author association', () => {
    expect(workflow).toMatch(/github\.event\.comment\.author_association/);
    expect(workflow).toMatch(/github\.event\.review\.author_association/);
    expect(workflow).toMatch(/github\.event\.issue\.author_association/);
  });

  test('admits only owners, members, and collaborators', () => {
    const gates = [...workflow.matchAll(/fromJSON\('(\[[^']+\])'\)/g)].map(m => JSON.parse(m[1]));
    expect(gates.length).toBe(4);
    for (const gate of gates) expect(gate).toEqual(['OWNER', 'MEMBER', 'COLLABORATOR']);
  });
});

describe('all GitHub workflows pin actions to a full commit SHA', () => {
  const files = readdirSync(workflowsDir).filter((name) => /\.ya?ml$/.test(name)).sort();

  test('every uses: line is name@40-hex', () => {
    expect(files).toEqual(['ci.yml', 'claude.yml', 'codeql.yml', 'scorecard.yml']);
    for (const file of files) {
      const yaml = readWorkflow(file);
      const refs = [...yaml.matchAll(/^\s*uses:\s*([^\s#]+)(?:\s*#.*)?$/gm)].map(match => match[1]);
      expect(refs.length, file).toBeGreaterThan(0);
      for (const ref of refs) expect(ref, `${file} ${ref}`).toMatch(/^[^@\s]+@[0-9a-f]{40}$/);
    }
  });

  test('every workflow runs SHA-pinned harden-runner', () => {
    for (const file of files) {
      expect(readWorkflow(file), file).toMatch(/step-security\/harden-runner@[0-9a-f]{40}/);
    }
  });

  // v2.10.2 carries GHSA-cpmj-h4f6-r6pq, GHSA-46g3-37rh-v698, GHSA-g699-3x6g-wm3g,
  // and GHSA-mxr3-8whj-j74r, fixed in 2.12.0 / 2.14.2 / 2.16.0 respectively.
  test('harden-runner is pinned past its known advisories', () => {
    for (const file of files) {
      const yaml = readWorkflow(file);
      expect(yaml, file).toMatch(/step-security\/harden-runner@bf7454d06d71f1098171f2acdf0cd4708d7b5920/);
      expect(yaml, `${file} still pins the advisory-carrying v2.10.2`)
        .not.toMatch(/harden-runner@0080882f6c36860b6ba35c610c98ce87d4e2f26f/);
    }
  });

  // v2.20.0 is the first release that can enforce egress blocking on Windows and
  // macOS runners, so any job left in audit mode there must say why.
  test('every audit-mode egress policy carries a justification', () => {
    for (const file of files) {
      const lines = readWorkflow(file).split('\n');
      lines.forEach((line, index) => {
        if (!/egress-policy:\s*audit\s*$/.test(line)) return;
        const preceding = lines.slice(Math.max(0, index - 12), index).join('\n');
        expect(preceding, `${file}:${index + 1} audit mode with no rationale`)
          .toMatch(/#/);
      });
    }
  });

  // A tag is mutable: the same v1.61.1-jammy can be republished with different
  // bytes. Actions are already SHA-pinned for this reason; container images
  // carry the same risk and are pinned to the manifest-list digest.
  test('every container image is pinned to a manifest digest', () => {
    let seen = 0;
    for (const file of files) {
      for (const [, image] of readWorkflow(file).matchAll(/^\s*image:\s*(\S+)\s*$/gm)) {
        seen += 1;
        expect(image, `${file} ${image}`).toMatch(/@sha256:[0-9a-f]{64}$/);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });
});
