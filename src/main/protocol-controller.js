'use strict';

const { parseBpmdUrl, resolveAsset, validateAsset, resolveAppAsset, appResponseHeaders } = require('./protocol');

// Registers the bpmd:// (per-vault asset) and app:// (renderer bundle) custom protocol
// handlers. Extracted from index.js (B1, multi-folder workspaces) to keep index.js under
// its 350-line boundary as the vault-scoping logic grew past a single activeVault.
function createProtocolController({
  protocol,
  fs,
  path,
  rootDir,
  isAuthorizedPath,
  getOpenVault,
  listOpenVaultRoots,
}) {
  // Serve a bpmd://vault/<vaultId>/<rel> request: resolve the vaultId to its OWN root
  // (never "whichever folder was read last"), re-check that root is still one of the
  // currently-open vaults, and stream the file's bytes. Any miss/escape → 404; never
  // throws into Electron.
  function registerBpmdProtocol() {
    if (!protocol || typeof protocol.handle !== 'function') return;
    protocol.handle('bpmd', async (request) => {
      const parsed = parseBpmdUrl(request.url);
      const vaultId = parsed && parsed.vaultId;
      const entry = vaultId ? getOpenVault(vaultId) : null;
      const root = entry && entry.path;
      if (root && typeof isAuthorizedPath === 'function') {
        const openRoots = new Set(listOpenVaultRoots());
        if (!isAuthorizedPath(root, openRoots)) return new Response('Not found', { status: 404 });
      }
      const res = resolveAsset(request.url, root, path);
      if (res.error) return new Response('Not found', { status: 404 });
      try {
        const checked = await validateAsset(res.path, root, fs, path);
        if (checked.error) return new Response('Not found', { status: 404 });
        const data = await fs.promises.readFile(checked.path);
        return new Response(data, { headers: { 'content-type': checked.type, 'content-length': String(checked.size) } });
      } catch (_) {
        return new Response('Not found', { status: 404 });
      }
    });
  }

  function registerAppProtocol() {
    if (!protocol || typeof protocol.handle !== 'function') return;
    protocol.handle('app', async (request) => {
      const res = resolveAppAsset(request.url, rootDir, path);
      if (res.error) return new Response('Not found', { status: 404 });
      try {
        const data = await fs.promises.readFile(res.path);
        return new Response(data, { headers: appResponseHeaders(res.type) });
      } catch (_) {
        return new Response('Not found', { status: 404 });
      }
    });
  }

  return { registerBpmdProtocol, registerAppProtocol };
}

module.exports = { createProtocolController };
