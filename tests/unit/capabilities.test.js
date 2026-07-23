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
          { id: 'cap-orphan', path: '/other/b.markdown', vaultId: 'cap-missing' },
          { id: 'cap-text', path: '/notes/a.txt', vaultId: 'cap-vault' },
        ],
      }),
    });
    const registry = createCapabilityRegistry({ fs, path: path.posix, userDataDir: '/user' });
    expect(registry.resolveVault('cap-vault')).toMatchObject({ path: '/notes', generation: 1 });
    expect(registry.resolveDocument('cap-doc')).toMatchObject({ path: '/notes/a.md', vaultId: 'cap-vault' });
    expect(registry.resolveDocument('cap-orphan')).toMatchObject({ path: '/other/b.markdown', vaultId: null });
    expect(registry.resolveDocument('cap-text')).toBeNull();
    expect(registry.resolveVault(123)).toBeNull();
    expect(registry.resolveDocument(null)).toBeNull();
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

  test('reuses a document grant, can attach its vault, and flushes explicitly', () => {
    const fs = memFs();
    let n = 0;
    const registry = createCapabilityRegistry({
      fs, path: path.posix, userDataDir: '/user', randomId: () => 'cap-' + (++n),
    });
    const vault = registry.grantVault('/notes');
    const document = registry.grantDocument('/notes/a.md', { persistGrant: false });
    expect(registry.grantDocument('/notes/a.md', { vaultId: vault.id, persistGrant: false }))
      .toMatchObject({ id: document.id, vaultId: vault.id });
    expect(registry.grantDocument('/notes/a.md', { vaultId: vault.id })).toMatchObject({ id: document.id });
    registry.flush();
    expect(fs._files[registry.file]).toContain(document.id);
  });
});
