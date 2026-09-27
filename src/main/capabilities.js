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
const { atomicWriteJson } = require('./json-store');

function isInside(child, root, path) {
  const rel = path.relative(root, child);
  return rel !== '' && !rel.split(path.sep).includes('..') && !path.isAbsolute(rel);
}

function createCapabilityRegistry({ fs, path, userDataDir, randomId } = {}) {
  const file = path.join(userDataDir, 'capabilities.json');
  const makeId = randomId || (() => `cap-${require('crypto').randomUUID()}`);
  const vaults = new Map();
  const documents = new Map();
  // Path indexes (audit PERF-03): grant lookups used to scan every record on each grant.
  const vaultsByPath = new Map();
  const documentsByPath = new Map();

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
          // audit SEC-05: validRecord only checks SHAPE. A hand-edited (or tampered)
          // registry could otherwise restore authority for a document that names an
          // unknown vault or sits outside the vault it claims. Re-validate containment
          // structurally — string level, no disk access, so an unmounted drive can never
          // shed an otherwise-valid grant.
          const vaultRef = record.vaultId != null ? vaults.get(record.vaultId) : null;
          if (record.vaultId != null && (!vaultRef || !isInside(record.path, vaultRef.path, path))) continue;
          const vaultId = CAPABILITY_ID.test(record.vaultId || '') && vaults.has(record.vaultId) ? record.vaultId : null;
          documents.set(record.id, { id: record.id, path: record.path, vaultId });
        }
      }
    } catch (_) { /* missing/corrupt registry starts empty */ }
    for (const record of vaults.values()) vaultsByPath.set(record.path, record);
    for (const record of documents.values()) documentsByPath.set(record.path, record);
  }

  function persist() {
    // Session-only records (persistGrant:false, minted per vault read) exist for conflict
    // bookkeeping inside this run alone; serializing them would write the vault's whole
    // file listing to disk. They persist only after an explicit re-grant promotes them.
    const result = atomicWriteJson(fs, file, JSON.stringify({
      version: CAPABILITY_VERSION,
      vaults: [...vaults.values()],
      documents: [...documents.values()].filter((record) => !record.sessionOnly),
    }, null, 2));
    if (result.error) throw new Error('persist-failed');
  }

  function relocateVault(id, realPath) {
    const record = vaults.get(id);
    if (!record || typeof realPath !== 'string' || !path.isAbsolute(realPath)) return false;
    // Same UNC rejection canonical() enforces at grant time: a local directory replaced
    // by a junction/mount between sessions must not re-pin a record onto a network path
    // that validRecord would then silently drop on the next load.
    if (realPath.startsWith('\\\\') || realPath.startsWith('//')) return false;
    if (realPath === record.path) return true;
    vaultsByPath.delete(record.path);
    record.path = realPath;
    vaultsByPath.set(realPath, record);
    return true;
  }

  function relocateDocument(id, realPath) {
    const record = documents.get(id);
    if (!record || typeof realPath !== 'string' || !path.isAbsolute(realPath)) return false;
    if (realPath.startsWith('\\\\') || realPath.startsWith('//')) return false;
    if (realPath === record.path) return true;
    documentsByPath.delete(record.path);
    record.path = realPath;
    documentsByPath.set(realPath, record);
    return true;
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
    const existing = vaultsByPath.get(real);
    if (existing) return { id: existing.id, name: path.basename(real), generation: existing.generation };
    const record = { id: nextId(), path: real, generation: 1 };
    vaults.set(record.id, record);
    vaultsByPath.set(real, record);
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
    const existing = documentsByPath.get(real);
    if (existing) {
      let changed = false;
      // v1.3.0 (S-M1): only a PERSISTED grant may convert a standalone record into a
      // vault-owned one. The per-read session lane (persistGrant:false, every vault
      // file) used to merge vaultId unconditionally — closing the folder then flipped
      // the still-open standalone tab's authority to a closed vault, and its autosave
      // died silently. Session reads keep the record's own identity; the documentGrant
      // merge in ipc-controller accepts either lane.
      if (persistGrant && vaultId && !existing.vaultId) { existing.vaultId = vaultId; changed = true; }
      if (persistGrant && existing.sessionOnly) { existing.sessionOnly = false; changed = true; }
      if (changed && persistGrant) persist();
      return { id: existing.id, name: path.basename(real), vaultId: existing.vaultId };
    }
    const record = { id: nextId(), path: real, vaultId };
    if (!persistGrant) record.sessionOnly = true;
    documents.set(record.id, record);
    documentsByPath.set(real, record);
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

  function revokeDocument(id) {
    const record = documents.get(id);
    if (record) { documents.delete(id); documentsByPath.delete(record.path); }
  }
  function revokeVault(id) {
    const record = vaults.get(id);
    if (record) {
      vaults.delete(id);
      vaultsByPath.delete(record.path);
      for (const [docId, doc] of [...documents.entries()]) {
        if (doc.vaultId === id) revokeDocument(docId);
      }
    }
  }
  // Audit SEC-01: the registry used to accumulate every path ever granted, forever.
  // Prune to what settings still reference (recents + lastSession); returns counts.
  function prune({ keepVaultIds, keepDocumentIds } = {}) {
    const keepV = keepVaultIds instanceof Set ? keepVaultIds : new Set(keepVaultIds || []);
    const keepD = keepDocumentIds instanceof Set ? keepDocumentIds : new Set(keepDocumentIds || []);
    let removedVaults = 0;
    let removedDocuments = 0;
    for (const [id, record] of [...vaults.entries()]) {
      if (keepV.has(id)) continue;
      vaults.delete(id); vaultsByPath.delete(record.path); removedVaults++;
    }
    for (const [id, record] of [...documents.entries()]) {
      if (record.vaultId && keepV.has(record.vaultId)) continue;
      if (!record.vaultId && keepD.has(id)) continue;
      documents.delete(id); documentsByPath.delete(record.path); removedDocuments++;
    }
    persist();
    return { removedVaults, removedDocuments };
  }

  load();
  /** Promote session-only documents to persisted grants in ONE atomic write. */
  function promoteDocuments(ids) {
    let changed = false;
    for (const id of ids || []) {
      const record = documents.get(id);
      if (record && record.sessionOnly) {
        record.sessionOnly = false;
        changed = true;
      }
    }
    if (changed) persist();
    return { changed };
  }

  return {
    grantVault,
    grantDocument,
    promoteDocuments,
    resolveVault,
    resolveDocument,
    revokeDocument,
    revokeVault,
    relocateVault,
    relocateDocument,
    prune,
    listVaults: () => [...vaults.values()].map((record) => ({ ...record })),
    listDocuments: () => [...documents.values()].map((record) => ({ ...record })),
    flush: persist,
    file,
  };
}

module.exports = { CAPABILITY_VERSION, createCapabilityRegistry, isInside };
