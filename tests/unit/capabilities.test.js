import { describe, expect, test } from 'vitest';
import path from 'node:path';
import { createCapabilityRegistry, isInside } from '../../src/main/capabilities.js';

function memFs(seed = {}) {
  const files = { ...seed };
  return {
    _files: files,
    readFileSync(file) {
      if (!(file in files)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return files[file];
    },
    writeFileSync(file, content) { files[file] = content; },
    renameSync(from, to) { files[to] = files[from]; delete files[from]; },
    realpathSync(file) { return path.posix.resolve(file); },
    statSync(file) {
      if (file.endsWith('.md')) return { isDirectory: () => false, isFile: () => true };
      return { isDirectory: () => true, isFile: () => false };
    },
  };
}

describe('main-owned filesystem capability registry', () => {
  test('isInside accepts descendants but rejects the root, siblings, and absolute escapes', () => {
    expect(isInside('/notes/sub/a.md', '/notes', path.posix)).toBe(true);
    expect(isInside('/notes', '/notes', path.posix)).toBe(false);
    expect(isInside('/other/a.md', '/notes', path.posix)).toBe(false);
  });

  test('persists grants outside renderer settings and resolves opaque IDs after restart', () => {
    const fs = memFs();
    let n = 0;
    const first = createCapabilityRegistry({
      fs, path: path.posix, userDataDir: '/user', randomId: () => `cap-${++n}`,
    });
    const vault = first.grantVault('/notes');
    const document = first.grantDocument('/notes/a.md', { vaultId: vault.id });
    expect(first.listVaults().map((item) => item.id)).toContain(vault.id);
    expect(first.listDocuments().map((item) => item.id)).toContain(document.id);
    expect(first.listVaults().find((item) => item.id === vault.id).path).toBe('/notes');
    expect(first.listDocuments().find((item) => item.id === document.id).path).toBe('/notes/a.md');

    expect(vault).toEqual({ id: 'cap-1', name: 'notes', generation: 1 });
    expect(document).toEqual({ id: 'cap-2', name: 'a.md', vaultId: 'cap-1' });
    expect(vault).not.toHaveProperty('path');
    expect(document).not.toHaveProperty('path');

    const second = createCapabilityRegistry({
      fs, path: path.posix, userDataDir: '/user', randomId: () => 'unused',
    });
    expect(second.resolveVault('cap-1').path).toBe('/notes');
    expect(second.resolveDocument('cap-2').path).toBe('/notes/a.md');
  });

  test('renderer-chosen IDs and corrupt persisted records cannot mint authority', () => {
    const file = '/user/capabilities.json';
    const fs = memFs({
      [file]: JSON.stringify({ version: 1, vaults: [{ id: '../evil', path: 7 }], documents: 'bad' }),
    });
    const registry = createCapabilityRegistry({ fs, path: path.posix, userDataDir: '/user', randomId: () => 'cap-safe' });
    expect(registry.resolveVault('../evil')).toBeNull();
    expect(registry.resolveDocument('/etc/passwd')).toBeNull();
  });

  test('canonicalizes native-picker paths and reuses an existing grant', () => {
    const fs = memFs();
    fs.realpathSync = () => '/canonical/notes';
    const registry = createCapabilityRegistry({ fs, path: path.posix, userDataDir: '/user', randomId: () => 'cap-1' });
    expect(registry.grantVault('/alias').id).toBe('cap-1');
    expect(registry.grantVault('/alias').id).toBe('cap-1');
    expect(registry.resolveVault('cap-1').path).toBe('/canonical/notes');
  });

  test('only grants existing directories and regular Markdown files', () => {
    const fs = memFs();
    const registry = createCapabilityRegistry({ fs, path: path.posix, userDataDir: '/user', randomId: () => 'cap-1' });
    expect(() => registry.grantVault('/notes/a.md')).toThrow(/directory/);
    expect(() => registry.grantDocument('/notes/image.png')).toThrow(/Markdown/);
  });

  test('loads only valid persisted vault and Markdown document records', () => {
    const file = '/user/capabilities.json';
    const fs = memFs({
      [file]: JSON.stringify({
        version: 1,
        vaults: [
          { id: 'cap-vault', path: '/notes', generation: 0 },
          { id: 'bad id', path: '/ignored', generation: 9 },
          { id: 'cap-net', path: '//server/share', generation: 1 },
        ],
        documents: [
          { id: 'cap-doc', path: '/notes/a.md', vaultId: 'cap-vault' },
          // audit SEC-05: a document naming an UNKNOWN vault no longer loads…
          { id: 'cap-orphan', path: '/other/b.markdown', vaultId: 'cap-missing' },
          // …and neither does one that sits OUTSIDE the vault it claims.
          { id: 'cap-escape', path: '/elsewhere/c.md', vaultId: 'cap-vault' },
          { id: 'cap-text', path: '/notes/a.txt', vaultId: 'cap-vault' },
        ],
      }),
    });
    const registry = createCapabilityRegistry({ fs, path: path.posix, userDataDir: '/user' });
    expect(registry.resolveVault('cap-vault')).toMatchObject({ path: '/notes', generation: 1 });
    expect(registry.resolveDocument('cap-doc')).toMatchObject({ path: '/notes/a.md', vaultId: 'cap-vault' });
    expect(registry.resolveDocument('cap-orphan')).toBeNull();
    expect(registry.resolveDocument('cap-escape')).toBeNull();
    expect(registry.resolveDocument('cap-text')).toBeNull();
    expect(registry.resolveVault(123)).toBeNull();
    expect(registry.resolveDocument(null)).toBeNull();
  });

  // audit SEC-05: the registry is main-owned but not tamper-proof — a hand-edited file
  // must not restore authority for a document that escapes (or does not belong to) its
  // vault. Containment is re-validated structurally at load, with no disk access.
  test('drops vault-escaping and unknown-vault document records at load (audit SEC-05)', () => {
    const file = '/user/capabilities.json';
    const fs = memFs({
      [file]: JSON.stringify({
        version: 1,
        vaults: [{ id: 'cap-v', path: '/notes', generation: 1 }],
        documents: [
          { id: 'cap-ok', path: '/notes/sub/a.md', vaultId: 'cap-v' },      // strictly inside → kept
          { id: 'cap-sib', path: '/notes-other/a.md', vaultId: 'cap-v' },   // sibling prefix → dropped
          { id: 'cap-out', path: '/elsewhere/a.md', vaultId: 'cap-v' },     // other root → dropped
          { id: 'cap-dot', path: '/notes/../a.md', vaultId: 'cap-v' },      // traversal → dropped
          { id: 'cap-self', path: '/notes', vaultId: 'cap-v' },             // the vault itself → dropped (.md check)
          { id: 'cap-gone', path: '/notes/b.md', vaultId: 'cap-missing' },  // unknown vault → dropped
          { id: 'cap-loose', path: '/notes/c.md', vaultId: null },          // vault-less → kept
        ],
      }),
    });
    const registry = createCapabilityRegistry({ fs, path: path.posix, userDataDir: '/user', randomId: () => 'cap-x' });
    const ids = registry.listDocuments().map((d) => d.id);
    expect(ids).toContain('cap-ok');
    expect(ids).toContain('cap-loose');
    for (const dropped of ['cap-sib', 'cap-out', 'cap-dot', 'cap-self', 'cap-gone']) {
      expect(ids, `${dropped} must not load`).not.toContain(dropped);
      expect(registry.resolveDocument(dropped), `${dropped} must restore no authority`).toBeNull();
    }
  });

  test('each persisted-record predicate independently rejects malformed authority', () => {
    const file = '/user/capabilities.json';
    const invalidVaults = [
      null,
      { id: 'bad', path: '/notes' },
      { id: 'cap-valid', path: 7 },
      { id: 'cap-valid', path: 'relative' },
      { id: 'cap-valid', path: '//server/share' },
      { id: 'cap-valid', path: '\\\\server\\share' },
      { id: 'xcap-valid', path: '/notes' },
      { id: 'cap-valid!', path: '/notes' },
    ];
    for (const record of invalidVaults) {
      const fs = memFs({ [file]: JSON.stringify({ version: 1, vaults: [record], documents: [] }) });
      const registry = createCapabilityRegistry({ fs, path: path.posix, userDataDir: '/user' });
      expect(registry.resolveVault(record?.id)).toBeNull();
    }
  });

  test('rejects wrong registry versions and document-extension suffix tricks', () => {
    const file = '/user/capabilities.json';
    for (const version of [0, 2, null]) {
      const fs = memFs({ [file]: JSON.stringify({ version, vaults: [{ id: 'cap-v', path: '/notes' }] }) });
      expect(createCapabilityRegistry({ fs, path: path.posix, userDataDir: '/user' }).resolveVault('cap-v')).toBeNull();
    }
    const fs = memFs({
      [file]: JSON.stringify({
        version: 1, vaults: [],
        documents: [{ id: 'cap-doc', path: '/notes/a.md.exe' }, { id: 'xcap-doc', path: '/notes/a.md' }],
      }),
    });
    const registry = createCapabilityRegistry({ fs, path: path.posix, userDataDir: '/user' });
    expect(registry.resolveDocument('cap-doc')).toBeNull();
    expect(registry.resolveDocument('xcap-doc')).toBeNull();
  });

  test('collision allocation performs exactly ten retries', () => {
    let calls = 0;
    const registry = createCapabilityRegistry({
      fs: memFs(), path: path.posix, userDataDir: '/user',
      randomId: () => (++calls === 12 ? 'cap-late' : 'cap-same'),
    });
    expect(registry.grantVault('/notes').id).toBe('cap-same');
    expect(() => registry.grantVault('/other')).toThrow(/Could not allocate/);
    expect(calls).toBe(11);
  });

  test('rejects relative, non-string, and network picker paths', () => {
    const registry = createCapabilityRegistry({
      fs: memFs(), path: path.posix, userDataDir: '/user', randomId: () => 'cap-id',
    });
    expect(() => registry.grantVault('relative')).toThrow(/absolute/);
    expect(() => registry.grantVault(null)).toThrow(/absolute/);
    expect(() => registry.grantVault('//server/share')).toThrow(/Network/);
  });

  test('validates generated IDs and bounds collision retries', () => {
    const invalid = createCapabilityRegistry({
      fs: memFs(), path: path.posix, userDataDir: '/user', randomId: () => '../bad',
    });
    expect(() => invalid.grantVault('/notes')).toThrow(/Invalid capability ID/);

    const collided = createCapabilityRegistry({
      fs: memFs(), path: path.posix, userDataDir: '/user', randomId: () => 'cap-same',
    });
    expect(collided.grantVault('/notes').id).toBe('cap-same');
    expect(() => collided.grantVault('/other')).toThrow(/Could not allocate/);
  });

  test('enforces document file type, regular-file status, and vault containment', () => {
    const fs = memFs();
    fs.statSync = file => ({
      isDirectory: () => file === '/notes',
      isFile: () => file === '/notes/a.md' || file === '/other/b.md',
    });
    let n = 0;
    const registry = createCapabilityRegistry({
      fs, path: path.posix, userDataDir: '/user', randomId: () => 'cap-' + (++n),
    });
    const vault = registry.grantVault('/notes');
    expect(() => registry.grantDocument('/notes/a.txt')).toThrow(/Markdown/);
    expect(() => registry.grantDocument('/notes/missing.md')).toThrow(/regular file/);
    expect(() => registry.grantDocument('/other/b.md', { vaultId: vault.id })).toThrow(/inside vault/);
    expect(() => registry.grantDocument('/notes/a.md', { vaultId: 'cap-missing' })).toThrow(/inside vault/);
  });

  test('reuses a document grant; only a persisted grant attaches its vault (S-M1)', () => {
    const fs = memFs();
    let n = 0;
    const registry = createCapabilityRegistry({
      fs, path: path.posix, userDataDir: '/user', randomId: () => 'cap-' + (++n),
    });
    const vault = registry.grantVault('/notes');
    const document = registry.grantDocument('/notes/a.md', { persistGrant: false });
    // A session vault read (persistGrant:false) must NOT convert the standalone record:
    // closing the folder would otherwise strand its still-open tab (2026-09-26 audit).
    expect(registry.grantDocument('/notes/a.md', { vaultId: vault.id, persistGrant: false }))
      .toMatchObject({ id: document.id, vaultId: null });
    expect(registry.grantDocument('/notes/a.md', { vaultId: vault.id }))
      .toMatchObject({ id: document.id, vaultId: vault.id });
    registry.flush();
    expect(fs._files[registry.file]).toContain(document.id);
  });

  test('a never-promoted persistGrant:false record never reaches disk, even after flushes', () => {
    const fs = memFs();
    let n = 0;
    const registry = createCapabilityRegistry({
      fs, path: path.posix, userDataDir: '/user', randomId: () => 'cap-' + (++n),
    });
    const vault = registry.grantVault('/notes');
    registry.grantDocument('/notes/a.md', { vaultId: vault.id, persistGrant: false });
    registry.grantDocument('/notes/b.md', { vaultId: vault.id, persistGrant: false });
    registry.flush();
    expect(JSON.parse(fs._files[registry.file]).documents).toEqual([]);

    registry.grantDocument('/notes/a.md', { vaultId: vault.id });
    registry.flush();
    expect(JSON.parse(fs._files[registry.file]).documents.map((d) => d.path)).toEqual(['/notes/a.md']);
  });

  // audit PERF-03: path indexes make the reuse lookup O(1); the observable contract is that
  // a repeat grant never mints a second record for the same canonical path.
  test('granting the same path twice returns the same id and adds no duplicate record', () => {
    const fs = memFs();
    let n = 0;
    const registry = createCapabilityRegistry({
      fs, path: path.posix, userDataDir: '/user', randomId: () => 'cap-' + (++n),
    });
    const vault = registry.grantVault('/notes');
    const again = registry.grantVault('/notes');
    expect(again.id).toBe(vault.id);
    expect(registry.listVaults()).toHaveLength(1);

    const first = registry.grantDocument('/notes/a.md', { vaultId: vault.id });
    const second = registry.grantDocument('/notes/a.md', { vaultId: vault.id });
    const third = registry.grantDocument('/notes/a.md', { vaultId: vault.id });
    expect(second.id).toBe(first.id);
    expect(third.id).toBe(first.id);
    expect(registry.listDocuments()).toHaveLength(1);
    expect(registry.listDocuments()[0]).toMatchObject({ id: first.id, path: '/notes/a.md', vaultId: vault.id });
  });

  // The path index must also serve a registry that LOADED its records from disk, not only
  // ones granted in this process.
  test('a path index built by load() reuses persisted records', () => {
    const file = '/user/capabilities.json';
    const fs = memFs({
      [file]: JSON.stringify({
        version: 1,
        vaults: [{ id: 'cap-vault', path: '/notes', generation: 1 }],
        documents: [{ id: 'cap-doc', path: '/notes/a.md', vaultId: 'cap-vault' }],
      }),
    });
    const registry = createCapabilityRegistry({ fs, path: path.posix, userDataDir: '/user', randomId: () => 'cap-new' });
    expect(registry.grantVault('/notes').id).toBe('cap-vault');
    expect(registry.grantDocument('/notes/a.md', { vaultId: 'cap-vault' }).id).toBe('cap-doc');
    expect(registry.listVaults()).toHaveLength(1);
    expect(registry.listDocuments()).toHaveLength(1);
  });
});

// audit SEC-01: the registry gained explicit revocation and startup pruning so it stops
// accumulating every path ever granted, forever.
describe('capability revocation and pruning (audit SEC-01)', () => {
  function makeRegistry(fs) {
    let n = 0;
    return createCapabilityRegistry({
      fs, path: path.posix, userDataDir: '/user', randomId: () => 'cap-' + (++n),
    });
  }

  test('revokeVault removes the vault and every document it contained', () => {
    const fs = memFs();
    const registry = makeRegistry(fs);
    const vault = registry.grantVault('/notes');
    const inside = registry.grantDocument('/notes/a.md', { vaultId: vault.id });
    const otherVault = registry.grantVault('/other');
    const loose = registry.grantDocument('/loose/b.md');

    registry.revokeVault(vault.id);

    expect(registry.resolveVault(vault.id)).toBeNull();
    expect(registry.resolveDocument(inside.id)).toBeNull();
    expect(registry.resolveVault(otherVault.id)).not.toBeNull();
    expect(registry.resolveDocument(loose.id)).not.toBeNull();
    // The path index forgot the revoked path, so a re-grant mints a NEW id.
    expect(registry.grantVault('/notes').id).not.toBe(vault.id);
  });

  test('revokeDocument removes exactly one document', () => {
    const fs = memFs();
    const registry = makeRegistry(fs);
    const first = registry.grantDocument('/loose/a.md');
    const second = registry.grantDocument('/loose/b.md');
    registry.revokeDocument(first.id);
    expect(registry.resolveDocument(first.id)).toBeNull();
    expect(registry.resolveDocument(second.id)).not.toBeNull();
    expect(registry.listDocuments()).toHaveLength(1);
    // Revoked document paths are re-grantable under a fresh id.
    expect(registry.grantDocument('/loose/a.md').id).not.toBe(first.id);
  });

  test('prune keeps referenced records and drops everything else, with counts', () => {
    const fs = memFs();
    const registry = makeRegistry(fs);
    const keepVault = registry.grantVault('/keep');
    const keepDoc = registry.grantDocument('/keep/a.md', { vaultId: keepVault.id });
    const dropVault = registry.grantVault('/drop');
    const dropDoc = registry.grantDocument('/drop/b.md', { vaultId: dropVault.id });
    const looseKept = registry.grantDocument('/loose/kept.md');
    const looseDropped = registry.grantDocument('/loose/dropped.md');

    const counts = registry.prune({
      keepVaultIds: new Set([keepVault.id]),
      keepDocumentIds: new Set([looseKept.id]),
    });

    expect(counts).toEqual({ removedVaults: 1, removedDocuments: 2 });
    expect(registry.resolveVault(keepVault.id)).not.toBeNull();
    expect(registry.resolveDocument(keepDoc.id)).not.toBeNull(); // kept with its vault
    expect(registry.resolveVault(dropVault.id)).toBeNull();
    expect(registry.resolveDocument(dropDoc.id)).toBeNull();
    expect(registry.resolveDocument(looseKept.id)).not.toBeNull();
    expect(registry.resolveDocument(looseDropped.id)).toBeNull();
  });

  test('pruned records do not come back after a reload from the same userData dir', () => {
    const fs = memFs();
    const registry = makeRegistry(fs);
    const keepVault = registry.grantVault('/keep');
    const dropVault = registry.grantVault('/drop');
    const looseKept = registry.grantDocument('/loose/kept.md');
    registry.grantDocument('/loose/dropped.md');

    registry.prune({
      keepVaultIds: new Set([keepVault.id]),
      keepDocumentIds: new Set([looseKept.id]),
    });

    const reloaded = makeRegistry(fs);
    expect(reloaded.resolveVault(keepVault.id)).not.toBeNull();
    expect(reloaded.resolveVault(dropVault.id)).toBeNull();
    expect(reloaded.listVaults()).toHaveLength(1);
    expect(reloaded.listDocuments()).toHaveLength(1);
    expect(reloaded.resolveDocument(looseKept.id)).not.toBeNull();
  });

  test('prune with no keep sets empties the registry', () => {
    const fs = memFs();
    const registry = makeRegistry(fs);
    registry.grantVault('/a');
    registry.grantDocument('/b/c.md');
    expect(registry.prune()).toEqual({ removedVaults: 1, removedDocuments: 1 });
    expect(registry.listVaults()).toEqual([]);
    expect(registry.listDocuments()).toEqual([]);
  });

  test('relocateVault and relocateDocument re-pin the stored path and the path index', () => {
    const fs = memFs();
    const registry = makeRegistry(fs);
    const vault = registry.grantVault('/notes');
    const doc = registry.grantDocument('/notes/a.md', { vaultId: vault.id });

    expect(registry.relocateVault(vault.id, '/notes-moved')).toBe(true);
    expect(registry.relocateDocument(doc.id, '/notes-moved/a.md')).toBe(true);
    expect(registry.resolveVault(vault.id).path).toBe('/notes-moved');
    expect(registry.resolveDocument(doc.id).path).toBe('/notes-moved/a.md');

    registry.flush();
    expect(fs._files[registry.file]).toContain('/notes-moved/a.md');

    expect(registry.grantVault('/notes-moved').id).toBe(vault.id);
    expect(registry.grantDocument('/notes-moved/a.md', { vaultId: vault.id }).id).toBe(doc.id);
  });

  test('relocate rejects unknown ids and non-absolute paths without mutating anything', () => {
    const fs = memFs();
    const registry = makeRegistry(fs);
    const vault = registry.grantVault('/notes');
    expect(registry.relocateVault('cap-missing', '/x')).toBe(false);
    expect(registry.relocateVault(vault.id, 'relative')).toBe(false);
    expect(registry.relocateDocument('cap-missing', '/x')).toBe(false);
    expect(registry.resolveVault(vault.id).path).toBe('/notes');
  });
});

describe('relocate refuses to re-pin records onto network paths (grant-time UNC rule)', () => {
  test('relocateVault/relocateDocument reject UNC and protocol-relative targets in place', () => {
    const fs = memFs();
    let n = 0;
    const registry = createCapabilityRegistry({
      fs, path: path.posix, userDataDir: '/user', randomId: () => `cap-${++n}`,
    });
    const vault = registry.grantVault('/notes');
    const document = registry.grantDocument('/notes/a.md', { vaultId: vault.id });
    expect(registry.relocateVault(vault.id, '\\srv\share')).toBe(false);
    expect(registry.relocateVault(vault.id, '//srv/share')).toBe(false);
    expect(registry.relocateDocument(document.id, '\\srv\share\a.md')).toBe(false);
    expect(registry.listVaults().find((r) => r.id === vault.id).path).toBe('/notes');
    expect(registry.listDocuments().find((r) => r.id === document.id).path).toBe('/notes/a.md');
  });

  test('a session vault read does not convert a standalone document grant into a vault-owned one (S-M1)', () => {
    const fs = memFs();
    let n = 0;
    const registry = createCapabilityRegistry({
      fs, path: path.posix, userDataDir: '/user', randomId: () => `cap-${++n}`,
    });
    const vault = registry.grantVault('/notes');
    const standalone = registry.grantDocument('/notes/a.md');
    expect(registry.resolveDocument(standalone.id).vaultId).toBeNull();
    registry.grantDocument('/notes/a.md', { vaultId: vault.id, persistGrant: false });
    expect(registry.resolveDocument(standalone.id).vaultId).toBeNull();
    registry.grantDocument('/notes/a.md', { vaultId: vault.id, persistGrant: true });
    expect(registry.resolveDocument(standalone.id).vaultId).toBe(vault.id);
  });
});

// PERF-01 (2026-09-26): batch deliveries mint session grants and persist the set in
// ONE write — promoteDocuments is the single-flush promotion path.
describe('promoteDocuments (PERF-01)', () => {
  test('promotes session-only documents in one write; unknown ids are ignored', () => {
    const fs = memFs();
    let n = 0;
    const registry = createCapabilityRegistry({
      fs, path: path.posix, userDataDir: '/user', randomId: () => 'cap-' + (++n),
    });
    const a = registry.grantDocument('/notes/a.md', { persistGrant: false });
    const b = registry.grantDocument('/notes/b.md', { persistGrant: false });
    expect(fs._files[registry.file]).toBeUndefined();
    expect(registry.promoteDocuments([a.id, 'cap-nope'])).toEqual({ changed: true });
    const persisted = JSON.parse(fs._files[registry.file]).documents.map((d) => d.id);
    expect(persisted).toEqual([a.id]);
    expect(registry.promoteDocuments([b.id])).toEqual({ changed: true });
    expect(registry.promoteDocuments([b.id])).toEqual({ changed: false });
  });
});
