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
