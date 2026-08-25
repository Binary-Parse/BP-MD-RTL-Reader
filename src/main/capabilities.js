/**
 * Main-process filesystem capability registry.
 *
 * Absolute paths never cross the preload boundary. Native picker results are
 * canonicalized here, persisted in a main-owned file, and represented to the
 * renderer by unguessable opaque IDs. Renderer settings may remember those IDs,
 * but cannot create authority by writing a path into settings.
 */

const CAPABILITY_VERSION = 1;
const CAPABILITY_ID = /^cap-[A-Za-z0-9_-]{1,128}$/;

function isInside(child, root, path) {
  const rel = path.relative(root, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function createCapabilityRegistry({ fs, path, userDataDir, randomId } = {}) {
  const file = path.join(userDataDir, 'capabilities.json');
  const makeId = randomId || (() => `cap-${require('crypto').randomUUID()}`);
  const vaults = new Map();
  const documents = new Map();

  function validRecord(record) {
    return record && typeof record === 'object' && CAPABILITY_ID.test(record.id)
      && typeof record.path === 'string' && path.isAbsolute(record.path)
      && !record.path.startsWith('\\\\') && !record.path.startsWith('//');
  }

  function load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!parsed || parsed.version !== CAPABILITY_VERSION) return;
      if (Array.isArray(parsed.vaults)) {
        for (const record of parsed.vaults) {
          if (validRecord(record)) vaults.set(record.id, { id: record.id, path: record.path, generation: Number(record.generation) || 1 });
        }
      }
      if (Array.isArray(parsed.documents)) {
        for (const record of parsed.documents) {
          if (!validRecord(record) || !/\.(md|markdown)$/i.test(record.path)) continue;
          const vaultId = CAPABILITY_ID.test(record.vaultId || '') && vaults.has(record.vaultId) ? record.vaultId : null;
          documents.set(record.id, { id: record.id, path: record.path, vaultId });
        }
      }
    } catch (_) { /* missing/corrupt registry starts empty */ }
  }

  function persist() {
    const tmp = `${file}.tmp`;
    const data = JSON.stringify({
      version: CAPABILITY_VERSION,
      vaults: [...vaults.values()],
      documents: [...documents.values()],
    }, null, 2);
    fs.writeFileSync(tmp, data, 'utf8');
    fs.renameSync(tmp, file);
  }

  function canonical(candidate) {
    if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) throw new Error('Invalid absolute path');
    if (candidate.startsWith('\\\\') || candidate.startsWith('//')) throw new Error('Network paths are not supported');
    return fs.realpathSync(candidate);
  }

  function nextId() {
    for (let attempt = 0; attempt < 10; attempt++) {
      const id = makeId();
      if (!CAPABILITY_ID.test(id)) throw new Error('Invalid capability ID');
      if (!vaults.has(id) && !documents.has(id)) return id;
    }
    throw new Error('Could not allocate capability ID');
  }

  function grantVault(candidate) {
    const real = canonical(candidate);
    const stat = fs.statSync(real);
    if (!stat || !stat.isDirectory()) throw new Error('Vault must be a directory');
    const existing = [...vaults.values()].find(record => record.path === real);
    if (existing) return { id: existing.id, name: path.basename(real), generation: existing.generation };
    const record = { id: nextId(), path: real, generation: 1 };
    vaults.set(record.id, record);
    persist();
    return { id: record.id, name: path.basename(real), generation: record.generation };
  }

  function grantDocument(candidate, { vaultId = null, persistGrant = true } = {}) {
    const real = canonical(candidate);
    if (!/\.(md|markdown)$/i.test(real)) throw new Error('Document must be Markdown');
    const stat = fs.statSync(real);
    if (!stat || !stat.isFile()) throw new Error('Document must be a regular file');
    if (vaultId != null) {
      const vault = vaults.get(vaultId);
      if (!vault || !isInside(real, vault.path, path)) throw new Error('Document must be inside vault');
    }
    const existing = [...documents.values()].find(record => record.path === real);
    if (existing) {
      if (vaultId && !existing.vaultId) { existing.vaultId = vaultId; if (persistGrant) persist(); }
      return { id: existing.id, name: path.basename(real), vaultId: existing.vaultId };
    }
    const record = { id: nextId(), path: real, vaultId };
    documents.set(record.id, record);
    if (persistGrant) persist();
    return { id: record.id, name: path.basename(real), vaultId };
  }

  function resolveVault(id) {
    const record = typeof id === 'string' ? vaults.get(id) : null;
    return record ? { ...record } : null;
  }

  function resolveDocument(id) {
    const record = typeof id === 'string' ? documents.get(id) : null;
    return record ? { ...record } : null;
  }

  load();
  return {
    grantVault,
    grantDocument,
    resolveVault,
    resolveDocument,
    listVaults: () => [...vaults.values()].map((record) => ({ ...record })),
    listDocuments: () => [...documents.values()].map((record) => ({ ...record })),
    flush: persist,
    file,
  };
}

module.exports = { CAPABILITY_VERSION, createCapabilityRegistry, isInside };
