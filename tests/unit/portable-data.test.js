import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DATA_DIR_NAME, MIGRATED_MARKER, applyPortableDataDir, migrateFromAppData, resolvePortableDataDir,
} from '../../src/main/portable-data.js';

// D12: the portable .exe keeps its data in a folder beside itself.
let root;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'bpmd-portable-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

function fakeApp(userData) {
  const paths = { userData };
  return { getPath: vi.fn((name) => paths[name]), setPath: vi.fn((name, value) => { paths[name] = value; }) };
}

describe('resolvePortableDataDir', () => {
  test('is the folder beside the .exe only for the portable Windows build', () => {
    // Windows paths on any host: the portable stub only exists on Windows.
    const exeDir = 'E:\\Apps\\Reader';
    expect(resolvePortableDataDir({ env: { PORTABLE_EXECUTABLE_DIR: exeDir }, platform: 'win32' }))
      .toBe(`E:\\Apps\\Reader\\${DATA_DIR_NAME}`);
    expect(resolvePortableDataDir({ env: {}, platform: 'win32' })).toBeNull();
    expect(resolvePortableDataDir({ env: { PORTABLE_EXECUTABLE_DIR: exeDir }, platform: 'linux' })).toBeNull();
    expect(resolvePortableDataDir({ env: { PORTABLE_EXECUTABLE_DIR: 'relative\\dir' }, platform: 'win32' })).toBeNull();
  });
});

describe('migrateFromAppData', () => {
  test('copies the allowlisted entries once, keeps the source, and leaves other files behind', () => {
    const from = path.join(root, 'appdata');
    const to = path.join(root, 'portable');
    fs.mkdirSync(path.join(from, 'recovery'), { recursive: true });
    fs.mkdirSync(to);
    fs.writeFileSync(path.join(from, 'settings.json'), '{"theme":"dark"}');
    fs.writeFileSync(path.join(from, 'recovery', 'snapshot.json'), '{}');
    fs.writeFileSync(path.join(from, 'Cookies'), 'chromium');

    expect(migrateFromAppData({ fs, path, fromDir: from, toDir: to })).toEqual(['settings.json', 'recovery']);
    expect(fs.readFileSync(path.join(to, 'settings.json'), 'utf8')).toBe('{"theme":"dark"}');
    expect(fs.existsSync(path.join(to, 'recovery', 'snapshot.json'))).toBe(true);
    expect(fs.existsSync(path.join(to, 'Cookies'))).toBe(false);
    expect(fs.existsSync(path.join(from, 'settings.json'))).toBe(true); // a copy, never a move
    expect(fs.existsSync(path.join(to, MIGRATED_MARKER))).toBe(true);

    // The marker stops a second copy: a later change in %APPDATA% does not overwrite.
    fs.writeFileSync(path.join(from, 'settings.json'), '{"theme":"light"}');
    fs.rmSync(path.join(to, 'settings.json'));
    expect(migrateFromAppData({ fs, path, fromDir: from, toDir: to })).toEqual([]);
    expect(fs.existsSync(path.join(to, 'settings.json'))).toBe(false);
  });

  test('keeps an entry the portable folder already has, and one failed copy does not stop the rest', () => {
    const from = path.join(root, 'appdata');
    const to = path.join(root, 'portable');
    fs.mkdirSync(from); fs.mkdirSync(to);
    fs.writeFileSync(path.join(from, 'settings.json'), 'old');
    fs.writeFileSync(path.join(to, 'settings.json'), 'portable');
    fs.writeFileSync(path.join(from, 'annotations.json'), '[]');
    fs.writeFileSync(path.join(from, 'reading-stats.json'), '{}');
    const log = vi.fn();
    const failing = { ...fs, cpSync: (src, ...rest) => {
      if (src.endsWith('annotations.json')) throw new Error('locked');
      return fs.cpSync(src, ...rest);
    } };
    expect(migrateFromAppData({ fs: failing, path, fromDir: from, toDir: to, log })).toEqual(['reading-stats.json']);
    expect(fs.readFileSync(path.join(to, 'settings.json'), 'utf8')).toBe('portable');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('annotations.json: locked'));
  });
});

// These use real Windows folders under the temp directory (the stub sets a Windows path).
describe.runIf(process.platform === 'win32')('applyPortableDataDir', () => {
  test('moves userData beside the .exe and copies the old data there', () => {
    const appData = path.join(root, 'appdata');
    fs.mkdirSync(appData);
    fs.writeFileSync(path.join(appData, 'capabilities.json'), '{}');
    const app = fakeApp(appData);
    const exeDir = path.join(root, 'stick');
    const dir = applyPortableDataDir({ app, fs, path, env: { PORTABLE_EXECUTABLE_DIR: exeDir }, platform: 'win32' });
    expect(dir).toBe(path.join(exeDir, DATA_DIR_NAME));
    expect(app.setPath).toHaveBeenCalledWith('userData', dir);
    expect(fs.existsSync(path.join(dir, 'capabilities.json'))).toBe(true);
  });

  test('leaves userData alone outside the portable build', () => {
    const app = fakeApp(path.join(root, 'appdata'));
    expect(applyPortableDataDir({ app, fs, path, env: {}, platform: 'win32' })).toBeNull();
    expect(app.setPath).not.toHaveBeenCalled();
  });

  test('a folder that cannot be written keeps the usual userData and says why', () => {
    const app = fakeApp(path.join(root, 'appdata'));
    const log = vi.fn();
    const readOnly = { ...fs, writeFileSync: () => { throw new Error('EROFS'); } };
    const dir = applyPortableDataDir({
      app, fs: readOnly, path, log, env: { PORTABLE_EXECUTABLE_DIR: path.join(root, 'cd') }, platform: 'win32',
    });
    expect(dir).toBeNull();
    expect(app.setPath).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('is not writable'));
  });
});
