/**
 * context-menu.test.js — T-B12 pure builder.
 */
import { describe, test, expect } from 'vitest';
import { buildContextMenuTemplate } from '../../src/main/context-menu.js';
import { isExternallyOpenable } from '../../src/main/navigation.js';

const deps = { isExternallyOpenable };
const ids = (t) => t.filter(i => i.kind === 'action').map(i => i.id);
const roles = (t) => t.filter(i => i.kind === 'role').map(i => i.role);

describe('buildContextMenuTemplate', () => {
  test('https link → open + copy link', () => {
    const t = buildContextMenuTemplate({ linkURL: 'https://x.com', isEditable: false }, deps);
    expect(ids(t)).toEqual(expect.arrayContaining(['open-link', 'copy-link']));
    const open = t.find(i => i.id === 'open-link');
    expect(open.url).toBe('https://x.com');
  });

  test('non-http link → copy only, no open (EC-B5)', () => {
    const t = buildContextMenuTemplate({ linkURL: 'javascript:alert(1)', isEditable: false }, deps);
    expect(ids(t)).toContain('copy-link');
    expect(ids(t)).not.toContain('open-link');
  });

  test('image → copy/copy-address/save', () => {
    const t = buildContextMenuTemplate({ mediaType: 'image', srcURL: 'bpmd://vault/p.png', isEditable: false }, deps);
    expect(ids(t)).toEqual(expect.arrayContaining(['copy-image', 'copy-image-address', 'save-image']));
  });

  test('editable → exact role order + 2 separators', () => {
    const t = buildContextMenuTemplate({ isEditable: true, editFlags: { canUndo: true, canCopy: false } }, deps);
    expect(roles(t)).toEqual(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']);
    expect(t.filter(i => i.kind === 'separator')).toHaveLength(2);
    expect(t.find(i => i.role === 'undo').enabled).toBe(true);
    expect(t.find(i => i.role === 'copy').enabled).toBe(false);
  });

  test('selection (non-editable) → copy enabled + selectAll', () => {
    const t = buildContextMenuTemplate({ isEditable: false, selectionText: 'hi', editFlags: { canCopy: true, canSelectAll: true } }, deps);
    expect(roles(t)).toEqual(['copy', 'selectAll']);
    expect(t.find(i => i.role === 'copy').enabled).toBe(true);
  });

  test('empty area → menu still present, copy disabled', () => {
    const t = buildContextMenuTemplate({ isEditable: false, selectionText: '  ', editFlags: { canSelectAll: true } }, deps);
    expect(roles(t)).toEqual(['copy', 'selectAll']);
    expect(t.find(i => i.role === 'copy').enabled).toBe(false);
    expect(t.find(i => i.role === 'selectAll').enabled).toBe(true);
  });

  test('spellcheck → suggestions + add to dictionary', () => {
    const t = buildContextMenuTemplate({
      isEditable: true, misspelledWord: 'helo',
      dictionarySuggestions: ['hello', 'help'], editFlags: {},
    }, deps);
    const acts = t.filter(i => i.kind === 'action');
    expect(acts.some(i => i.id === 'replace-misspelling' && i.replacement === 'hello')).toBe(true);
    expect(acts.some(i => i.id === 'add-to-dictionary' && i.word === 'helo')).toBe(true);
  });

  test('no dangling separators', () => {
    const t = buildContextMenuTemplate({ linkURL: 'https://x', isEditable: false, editFlags: {} }, deps);
    expect(t[0].kind).not.toBe('separator');
    expect(t[t.length - 1].kind).not.toBe('separator');
  });
});

// ── Mutation-hardening (audit F-3): exact descriptors, labels, ids, enabled flags. ──
const D = { isExternallyOpenable: (u) => /^https?:/i.test(u) };
const descKinds = (m) => m.map((i) => i.id || i.role || i.kind);

describe('buildContextMenuTemplate — link context (exact)', () => {
  test('openable link → open-link + copy-link with exact labels/urls + separator', () => {
    const m = buildContextMenuTemplate({ linkURL: 'https://x' }, D);
    const open = m.find((i) => i.id === 'open-link');
    const copy = m.find((i) => i.id === 'copy-link');
    expect(open).toEqual({ kind: 'action', id: 'open-link', label: 'Open Link in Browser', url: 'https://x' });
    expect(copy).toEqual({ kind: 'action', id: 'copy-link', label: 'Copy Link Address', url: 'https://x' });
    expect(m.some((i) => i.kind === 'separator')).toBe(true);
  });
  test('non-openable link (e.g. javascript:) → NO open-link, copy-link still present', () => {
    const m = buildContextMenuTemplate({ linkURL: 'javascript:evil' }, D);
    expect(m.find((i) => i.id === 'open-link')).toBeUndefined();
    expect(m.find((i) => i.id === 'copy-link').url).toBe('javascript:evil');
  });
  test('missing isExternallyOpenable dep → treated as not openable (no open-link)', () => {
    const m = buildContextMenuTemplate({ linkURL: 'https://x' }, {});
    expect(m.find((i) => i.id === 'open-link')).toBeUndefined();
  });
});

describe('buildContextMenuTemplate — image context (exact)', () => {
  test('image with srcURL → copy-image, copy-image-address, save-image (exact labels)', () => {
    const m = buildContextMenuTemplate({ mediaType: 'image', srcURL: 'bpmd://vault/p.png' }, D);
    expect(m.find((i) => i.id === 'copy-image')).toEqual({ kind: 'action', id: 'copy-image', label: 'Copy Image' });
    expect(m.find((i) => i.id === 'copy-image-address')).toEqual({ kind: 'action', id: 'copy-image-address', label: 'Copy Image Address', url: 'bpmd://vault/p.png' });
    expect(m.find((i) => i.id === 'save-image')).toEqual({ kind: 'action', id: 'save-image', label: 'Save Image', url: 'bpmd://vault/p.png' });
  });
  test('image WITHOUT srcURL → no copy-image-address; save-image still offered', () => {
    const m = buildContextMenuTemplate({ mediaType: 'image' }, D);
    expect(m.find((i) => i.id === 'copy-image-address')).toBeUndefined();
    expect(m.find((i) => i.id === 'save-image')).toBeTruthy();
  });
});

describe('buildContextMenuTemplate — editable: spellcheck + edit roles (exact enabled)', () => {
  test('misspelled word WITH suggestions → replace items (label=suggestion) + add-to-dictionary', () => {
    const m = buildContextMenuTemplate({ isEditable: true, misspelledWord: 'teh', dictionarySuggestions: ['the', 'tea'] }, D);
    const repl = m.filter((i) => i.id === 'replace-misspelling');
    expect(repl.map((i) => i.label)).toEqual(['the', 'tea']);
    expect(repl[0]).toEqual({ kind: 'action', id: 'replace-misspelling', label: 'the', replacement: 'the' });
    expect(m.find((i) => i.id === 'add-to-dictionary')).toEqual({ kind: 'action', id: 'add-to-dictionary', label: 'Add to Dictionary', word: 'teh' });
  });
  test('misspelled word with NO suggestions → no replace items, add-to-dictionary present', () => {
    const m = buildContextMenuTemplate({ isEditable: true, misspelledWord: 'zzz', dictionarySuggestions: [] }, D);
    expect(m.filter((i) => i.id === 'replace-misspelling')).toEqual([]);
    expect(m.find((i) => i.id === 'add-to-dictionary')).toBeTruthy();
  });
  test('edit roles reflect editFlags EXACTLY (each enabled flag pinned true AND false)', () => {
    const all = buildContextMenuTemplate({ isEditable: true, editFlags: { canUndo: true, canRedo: true, canCut: true, canCopy: true, canPaste: true, canSelectAll: true } }, D);
    for (const role of ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']) {
      expect(all.find((i) => i.role === role).enabled).toBe(true);
    }
    const none = buildContextMenuTemplate({ isEditable: true, editFlags: {} }, D);
    for (const role of ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']) {
      expect(none.find((i) => i.role === role).enabled).toBe(false);
    }
  });
});

describe('buildContextMenuTemplate — non-editable copy depends on selection', () => {
  test('copy enabled only when there is a non-blank selection AND canCopy', () => {
    expect(buildContextMenuTemplate({ selectionText: 'hi', editFlags: { canCopy: true } }, D).find((i) => i.role === 'copy').enabled).toBe(true);
    expect(buildContextMenuTemplate({ selectionText: '', editFlags: { canCopy: true } }, D).find((i) => i.role === 'copy').enabled).toBe(false);
    expect(buildContextMenuTemplate({ selectionText: '   ', editFlags: { canCopy: true } }, D).find((i) => i.role === 'copy').enabled).toBe(false); // whitespace-only → no selection
    expect(buildContextMenuTemplate({ selectionText: 'hi', editFlags: { canCopy: false } }, D).find((i) => i.role === 'copy').enabled).toBe(false); // canCopy false
    expect(buildContextMenuTemplate({}, D).find((i) => i.role === 'selectAll')).toBeTruthy(); // selectAll always present
  });
  test('a plain right-click (no link/image/selection) still yields copy + selectAll', () => {
    expect(descKinds(buildContextMenuTemplate({}, D))).toEqual(['copy', 'selectAll']);
  });
});
