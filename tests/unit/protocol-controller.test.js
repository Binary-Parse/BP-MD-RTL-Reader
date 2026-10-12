/**
 * protocol-controller.test.js — the bpmd:// (vault asset) and app:// (renderer bundle) handlers,
 * driven directly with a real temporary directory (audit B7: this file had no test of its own).
 *
 * Requirement: a request is answered with the file's bytes only when it names a file inside a
 * vault that is open right now (bpmd) or inside the app's own renderer/vendor folders (app).
 * Everything else — unknown vault, closed vault, traversal, wrong type, unreadable file — is a
 * plain 404, and the handler never throws into Electron.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import realFs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createProtocolController } = require('../../src/main/protocol-controller.js');

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5]);
let base; let vault; let otherVault; let appRoot;

beforeAll(() => {
  base = realFs.realpathSync(realFs.mkdtempSync(path.join(os.tmpdir(), 'bpmd-protocol-')));
  vault = path.join(base, 'vault');
  otherVault = path.join(base, 'other');
  appRoot = path.join(base, 'app');
  for (const dir of [path.join(vault, 'img'), otherVault, path.join(appRoot, 'src', 'renderer'), path.join(appRoot, 'resources', 'vendor'), path.join(appRoot, 'src', 'main')]) {
    realFs.mkdirSync(dir, { recursive: true });
  }
  realFs.writeFileSync(path.join(vault, 'img', 'pic.png'), PNG);
  realFs.writeFileSync(path.join(vault, 'note.md'), '# note');
  realFs.writeFileSync(path.join(otherVault, 'secret.png'), PNG);
  realFs.writeFileSync(path.join(appRoot, 'src', 'renderer', 'index.html'), '<!doctype html><title>app</title>');
  realFs.writeFileSync(path.join(appRoot, 'src', 'renderer', 'app.js'), 'export {};');
  realFs.writeFileSync(path.join(appRoot, 'resources', 'vendor', 'lib.js'), 'var lib;');
  realFs.writeFileSync(path.join(appRoot, 'src', 'main', 'index.js'), 'main');
});
afterAll(() => realFs.rmSync(base, { recursive: true, force: true }));

/** The real file system behind spies, so a test can see what was touched or make a call fail. */
function spiedFs() {
  return {
    realpathSync: vi.fn((target) => realFs.realpathSync(target)),
    promises: {
      readFile: vi.fn((file) => realFs.promises.readFile(file)),
      realpath: vi.fn((target) => realFs.promises.realpath(target)),
      stat: vi.fn((target) => realFs.promises.stat(target)),
    },
  };
}

function setup(overrides = {}) {
  const handlers = new Map();
  const protocol = { handle: vi.fn((scheme, handler) => handlers.set(scheme, handler)) };
  const fs = spiedFs();
  const getOpenVault = vi.fn((id) => (id === 'v1' ? { path: vault } : id === 'v2' ? { path: otherVault } : id === 'nopath' ? {} : null));
  const listOpenVaultRoots = vi.fn(() => [vault, otherVault]);
  const isAuthorizedPath = vi.fn((root, openRoots) => openRoots.has(root));
  const controller = createProtocolController({
    protocol, fs, path, rootDir: appRoot, isAuthorizedPath, getOpenVault, listOpenVaultRoots, ...overrides,
  });
  return { controller, handlers, protocol, fs, getOpenVault, listOpenVaultRoots, isAuthorizedPath };
}

async function expect404(response) {
  expect(response.status).toBe(404);
  expect(await response.text()).toBe('Not found');
}

describe('registration', () => {
  test('each handler is registered under its own scheme', () => {
    const { controller, protocol } = setup();
    controller.registerBpmdProtocol();
    expect(protocol.handle.mock.calls.map((call) => call[0])).toEqual(['bpmd']);
    controller.registerAppProtocol();
    expect(protocol.handle.mock.calls.map((call) => call[0])).toEqual(['bpmd', 'app']);
    expect(typeof protocol.handle.mock.calls[0][1]).toBe('function');
    expect(typeof protocol.handle.mock.calls[1][1]).toBe('function');
  });

  test('without a usable protocol module nothing is registered and nothing throws', () => {
    for (const protocol of [null, undefined, {}, { handle: 'not a function' }]) {
      const { controller } = setup({ protocol });
      expect(() => controller.registerBpmdProtocol()).not.toThrow();
      expect(() => controller.registerAppProtocol()).not.toThrow();
    }
  });
});

describe('bpmd:// vault assets', () => {
  let ctx; let bpmd;
  beforeEach(() => {
    ctx = setup();
    ctx.controller.registerBpmdProtocol();
    bpmd = (url) => ctx.handlers.get('bpmd')({ url });
  });

  test('serves the bytes of an image inside the open vault, with its type and length', async () => {
    const response = await bpmd('bpmd://vault/v1/img/pic.png');
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(PNG);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('content-length')).toBe(String(PNG.length));
    expect(ctx.getOpenVault).toHaveBeenCalledWith('v1');
    expect(ctx.fs.promises.readFile).toHaveBeenCalledTimes(1);
    expect(ctx.fs.promises.readFile).toHaveBeenCalledWith(path.join(vault, 'img', 'pic.png'));
  });

  test('the vault root is re-checked against the vaults that are open at this moment', async () => {
    await bpmd('bpmd://vault/v1/img/pic.png');
    expect(ctx.isAuthorizedPath).toHaveBeenCalledTimes(1);
    const [root, openRoots] = ctx.isAuthorizedPath.mock.calls[0];
    expect(root).toBe(vault);
    expect(openRoots).toBeInstanceOf(Set);
    expect([...openRoots]).toEqual([vault, otherVault]);
  });

  test('a vault that is no longer open is a 404 and its file is never read', async () => {
    ctx.listOpenVaultRoots.mockReturnValue([otherVault]);
    await expect404(await bpmd('bpmd://vault/v1/img/pic.png'));
    expect(ctx.fs.promises.readFile).not.toHaveBeenCalled();
    expect(ctx.fs.promises.realpath).not.toHaveBeenCalled();
  });

  test('an unknown vault id is a 404, and no authorization is asked for a root that does not exist', async () => {
    await expect404(await bpmd('bpmd://vault/nope/img/pic.png'));
    expect(ctx.getOpenVault).toHaveBeenCalledWith('nope');
    expect(ctx.isAuthorizedPath).not.toHaveBeenCalled();
    expect(ctx.fs.promises.readFile).not.toHaveBeenCalled();
  });

  test('a vault entry without a path is a 404', async () => {
    await expect404(await bpmd('bpmd://vault/nopath/img/pic.png'));
    expect(ctx.isAuthorizedPath).not.toHaveBeenCalled();
    expect(ctx.fs.promises.readFile).not.toHaveBeenCalled();
  });

  test('a URL that is not a vault asset URL is a 404 and no vault is looked up', async () => {
    for (const url of ['bpmd://vault/', 'bpmd://other/v1/img/pic.png', 'https://example.com/pic.png', 'bpmd://vault/v1']) {
      await expect404(await bpmd(url));
    }
    expect(ctx.getOpenVault).not.toHaveBeenCalled();
    expect(ctx.fs.promises.readFile).not.toHaveBeenCalled();
  });

  test('a path that climbs out of the vault is a 404 and the disk is not touched', async () => {
    await expect404(await bpmd('bpmd://vault/v1/..%2Fother%2Fsecret.png'));
    await expect404(await bpmd('bpmd://vault/v1/img/..%2F..%2Fother%2Fsecret.png'));
    expect(ctx.fs.promises.realpath).not.toHaveBeenCalled();
    expect(ctx.fs.promises.readFile).not.toHaveBeenCalled();
  });

  test('one vault id cannot reach a file of another open vault', async () => {
    await expect404(await bpmd('bpmd://vault/v1/secret.png'));
    const own = await bpmd('bpmd://vault/v2/secret.png');
    expect(own.status).toBe(200);
  });

  test('a file that is not an image type is a 404 and is not read', async () => {
    await expect404(await bpmd('bpmd://vault/v1/note.md'));
    expect(ctx.fs.promises.readFile).not.toHaveBeenCalled();
  });

  test('a missing file is a 404', async () => {
    await expect404(await bpmd('bpmd://vault/v1/img/missing.png'));
    expect(ctx.fs.promises.readFile).not.toHaveBeenCalled();
  });

  test('a read that fails is a 404, not an exception', async () => {
    ctx.fs.promises.readFile.mockRejectedValueOnce(new Error('EIO'));
    await expect404(await bpmd('bpmd://vault/v1/img/pic.png'));
  });

  test('a failure while checking the file is a 404, not an exception', async () => {
    ctx.fs.promises.stat.mockImplementationOnce(() => { throw new Error('boom'); });
    await expect404(await bpmd('bpmd://vault/v1/img/pic.png'));
    expect(ctx.fs.promises.readFile).not.toHaveBeenCalled();
  });

  test('without an authorization function the open-vault lookup alone decides', async () => {
    const plain = setup({ isAuthorizedPath: undefined });
    plain.controller.registerBpmdProtocol();
    const response = await plain.handlers.get('bpmd')({ url: 'bpmd://vault/v1/img/pic.png' });
    expect(response.status).toBe(200);
    expect(plain.listOpenVaultRoots).not.toHaveBeenCalled();
    await expect404(await plain.handlers.get('bpmd')({ url: 'bpmd://vault/nope/img/pic.png' }));
  });
});

describe('app:// renderer bundle', () => {
  let ctx; let app;
  beforeEach(() => {
    ctx = setup();
    ctx.controller.registerAppProtocol();
    app = (url) => ctx.handlers.get('app')({ url });
  });

  test('serves the renderer document with its type and the framing policy', async () => {
    const response = await app('app://ui/src/renderer/index.html');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('<!doctype html><title>app</title>');
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('content-security-policy')).toBe("frame-ancestors 'none'");
    expect(ctx.fs.promises.readFile).toHaveBeenCalledWith(path.join(appRoot, 'src', 'renderer', 'index.html'));
  });

  test('serves a script and a vendored library with a script type and no document policy', async () => {
    for (const url of ['app://ui/src/renderer/app.js', 'app://ui/resources/vendor/lib.js']) {
      const response = await app(url);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
      expect(response.headers.get('content-security-policy')).toBeNull();
    }
  });

  test('a file outside the renderer and vendor folders is a 404 and is not read', async () => {
    await expect404(await app('app://ui/src/main/index.js'));
    await expect404(await app('app://ui/src/renderer/..%2Fmain%2Findex.js'));
    await expect404(await app('app://other/src/renderer/index.html'));
    await expect404(await app('bpmd://ui/src/renderer/index.html'));
    expect(ctx.fs.promises.readFile).not.toHaveBeenCalled();
  });

  test('a missing file is a 404 and is not read', async () => {
    await expect404(await app('app://ui/src/renderer/missing.js'));
    expect(ctx.fs.promises.readFile).not.toHaveBeenCalled();
  });

  test('a read that fails is a 404, not an exception', async () => {
    ctx.fs.promises.readFile.mockRejectedValueOnce(new Error('EIO'));
    await expect404(await app('app://ui/src/renderer/index.html'));
  });

  test('the real path of the app root is looked up once; each requested file every time', async () => {
    await app('app://ui/src/renderer/index.html');
    await app('app://ui/src/renderer/app.js');
    await app('app://ui/src/renderer/app.js');
    const targets = ctx.fs.realpathSync.mock.calls.map((call) => call[0]);
    expect(targets.filter((target) => target === appRoot)).toHaveLength(1);
    expect(targets.filter((target) => target === path.join(appRoot, 'src', 'renderer', 'app.js'))).toHaveLength(2);
    expect(targets).toHaveLength(4);
  });

  test('the remembered root is the real one: a link that leaves the app folder is refused', async () => {
    // The requested file resolves, by its real path, to somewhere outside the app root.
    ctx.fs.realpathSync.mockImplementation((target) => (target === appRoot ? appRoot : path.join(base, 'elsewhere', 'app.js')));
    await expect404(await app('app://ui/src/renderer/app.js'));
    await expect404(await app('app://ui/src/renderer/index.html'));
    expect(ctx.fs.promises.readFile).not.toHaveBeenCalled();
  });

  test('a root that is itself reached through a link still serves its own files', async () => {
    const realRoot = path.join(base, 'real-app');
    ctx.fs.realpathSync.mockImplementation((target) => (target === appRoot ? realRoot : target.replace(appRoot, realRoot)));
    expect((await app('app://ui/src/renderer/index.html')).status).toBe(200);
    expect((await app('app://ui/src/renderer/app.js')).status).toBe(200);
  });
});
