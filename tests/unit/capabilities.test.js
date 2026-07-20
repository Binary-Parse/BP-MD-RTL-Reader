import { describe, expect, test } from 'vitest';
import path from 'node:path';
import { createCapabilityRegistry } from '../../src/main/capabilities.js';

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
});
