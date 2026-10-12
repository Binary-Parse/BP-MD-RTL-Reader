// @vitest-environment jsdom
import { describe, test, expect } from 'vitest';
import {
  ctxIconName, ctxHeader, ctxRows, buildCtxHeader, buildCtxRow, THEME_SWATCH, surfaceActions, selectionLabel,
} from '../../src/renderer/components/context-menu-items.js';

const LABELS = {
  direction: 'Text direction',
  theme: 'Theme',
  textSize: 'Text size',
  'dir.auto': 'Auto',
  'dir.rtl': 'RTL',
  'dir.ltr': 'LTR',
  'theme.paper': 'Paper',
  'theme.ink': 'Ink',
  'theme.sepia': 'Sepia',
  'theme.oasis': 'Oasis',
};

describe('ctxIconName', () => {
  test.each([
    [{ kind: 'role', role: 'undo' }, 'undo-2'],
    [{ kind: 'role', role: 'redo' }, 'redo-2'],
    [{ kind: 'role', role: 'cut' }, 'scissors'],
    [{ kind: 'role', role: 'copy' }, 'copy'],
    [{ kind: 'role', role: 'paste' }, 'clipboard-paste'],
    [{ kind: 'role', role: 'selectAll' }, 'text-select'],
    [{ kind: 'action', id: 'open-link' }, 'link'],
    [{ kind: 'action', id: 'copy-link' }, 'copy'],
    [{ kind: 'action', id: 'copy-image' }, 'image'],
    [{ kind: 'action', id: 'save-image' }, 'save'],
    [{ kind: 'action', id: 'local:tab-close' }, 'x'],
    [{ kind: 'action', id: 'local:tab-close-others' }, 'tabs-other'],
    [{ kind: 'action', id: 'local:tab-close-all' }, 'tabs-close'],
    [{ kind: 'action', id: 'local:tab-duplicate' }, 'copy'],
    [{ kind: 'action', id: 'local:reveal' }, 'folder'],
    [{ kind: 'action', id: 'local:copy-path' }, 'link'],
    [{ kind: 'action', id: 'local:tree-open' }, 'book-open'],
    [{ kind: 'action', id: 'local:wiki-open' }, 'book-open'],
    [{ kind: 'action', id: 'local:wiki-copy' }, 'copy'],
    [{ kind: 'action', id: 'local:tab-save' }, 'save'],
    [{ kind: 'action', id: 'local:sel-highlight' }, 'highlighter'],
    [{ kind: 'action', id: 'local:sel-note' }, 'pencil'],
    [{ kind: 'action', id: 'local:sel-search' }, 'search'],
    [{ kind: 'action', id: 'local:fmt-bold' }, 'bold'],
    [{ kind: 'action', id: 'local:fmt-italic' }, 'italic'],
    [{ kind: 'action', id: 'local:fmt-strike' }, 'strike'],
    [{ kind: 'action', id: 'local:fmt-code' }, 'code'],
    [{ kind: 'action', id: 'local:fmt-link' }, 'link'],
    [{ kind: 'app-command', id: 'newNote' }, 'file-plus'],
    [{ kind: 'app-command', id: 'openFind' }, 'search'],
    [{ kind: 'app-command', id: 'openPalette' }, 'command'],
    [{ kind: 'app-command', id: 'toggleAutoHideTitlebar' }, 'bar-top'],
    [{ kind: 'app-command', id: 'toggleHideStatusBar' }, 'bar-bottom'],
    [{ kind: 'app-command', id: 'showSettings' }, 'gear'],
  ])('%j uses the %s icon', (item, icon) => {
    expect(ctxIconName(item)).toBe(icon);
  });

  test('unknown items have no icon', () => {
    expect(ctxIconName({ kind: 'action', id: 'replace-misspelling' })).toBeNull();
    expect(ctxIconName({ kind: 'role', role: 'mystery' })).toBeNull();
    expect(ctxIconName(null)).toBeNull();
  });
});

describe('ctxHeader', () => {
  const file = { name: 'essay.md', path: 'notes/essay.md', content: 'Hello\n\nWorld', forcedDir: null };

  test('a tab or tree row shows the note title, its trail and its direction', () => {
    expect(ctxHeader({ kind: 'tab' }, file, 'Notes')).toEqual({
      kind: 'file', title: 'essay', sub: 'Notes / notes / essay.md', dir: 'ltr',
    });
    expect(ctxHeader({ kind: 'tree', isDir: false }, { ...file, content: 'مرحبا' }, 'Notes').dir).toBe('rtl');
  });

  test('a forced direction wins in the header', () => {
    expect(ctxHeader({ kind: 'tab' }, { ...file, forcedDir: 'rtl' }, 'Notes').dir).toBe('rtl');
  });

  test('a wikilink shows its target', () => {
    expect(ctxHeader({ kind: 'wikilink', target: 'Reading list' }, null, 'Notes')).toEqual({
      kind: 'wikilink', title: 'Reading list', sub: '', dir: 'ltr',
    });
  });

  test('directory rows, plain text and a missing file have no header', () => {
    expect(ctxHeader({ kind: 'tree', isDir: true }, file, 'Notes')).toBeNull();
    expect(ctxHeader({ kind: 'text' }, file, 'Notes')).toBeNull();
    expect(ctxHeader({ kind: 'tab' }, null, 'Notes')).toBeNull();
    expect(ctxHeader(null, file, 'Notes')).toBeNull();
  });
});

describe('ctxRows', () => {
  test('with a document: direction, theme and text size rows', () => {
    const rows = ctxRows({ forcedDir: 'rtl', theme: 'ink', scale: 1.2, hasDocument: true, labels: LABELS });
    expect(rows.map((r) => r.kind)).toEqual(['seg', 'swatches', 'stepper']);
    const [dir, theme, size] = rows;
    expect(dir.label).toBe('Text direction');
    expect(dir.options.map((o) => [o.id, o.label, o.on])).toEqual([
      ['dir:auto', 'Auto', false], ['dir:rtl', 'RTL', true], ['dir:ltr', 'LTR', false],
    ]);
    expect(theme.options.map((o) => [o.id, o.on])).toEqual([
      ['theme:paper', false], ['theme:ink', true], ['theme:sepia', false], ['theme:oasis', false],
    ]);
    expect(theme.options.map((o) => o.label)).toEqual(['Paper', 'Ink', 'Sepia', 'Oasis']);
    expect(size.keepOpen).toBe(true);
    expect(size.options.map((o) => [o.id, o.label])).toEqual([
      ['scale:dec', 'A−'], ['scale:reset', '120%'], ['scale:inc', 'A+'],
    ]);
  });

  test('automatic direction lights the Auto option', () => {
    const rows = ctxRows({ forcedDir: null, theme: 'paper', scale: 1, hasDocument: true, labels: LABELS });
    expect(rows[0].options.map((o) => o.on)).toEqual([true, false, false]);
    expect(rows[2].options[1].label).toBe('100%');
  });

  test('without a document only the theme row remains', () => {
    const rows = ctxRows({ forcedDir: null, theme: 'sepia', scale: 1, hasDocument: false, labels: LABELS });
    expect(rows.map((r) => r.kind)).toEqual(['swatches']);
  });
});

describe('buildCtxHeader', () => {
  test('renders the title in a bdi, the trail and the direction', () => {
    const el = buildCtxHeader(document, { kind: 'file', title: 'فن القراءة', sub: 'Notes / essays / x.md', dir: 'rtl' });
    expect(el.className).toBe('ctx-head');
    expect(el.dataset.d).toBe('rtl');
    expect(el.querySelector('.ch-title bdi').textContent).toBe('فن القراءة');
    expect(el.querySelector('.ch-sub').textContent).toBe('Notes / essays / x.md');
  });

  test('a wikilink title is wrapped in brackets and has no trail', () => {
    const el = buildCtxHeader(document, { kind: 'wikilink', title: 'Target', sub: '', dir: 'ltr' });
    expect(el.querySelector('.ch-title').textContent).toBe('[[Target]]');
    expect(el.querySelector('.ch-sub')).toBeNull();
  });
});

describe('buildCtxRow', () => {
  test('a segmented row exposes radio buttons keyed by option id', () => {
    const rows = ctxRows({ forcedDir: 'ltr', theme: 'paper', scale: 1, hasDocument: true, labels: LABELS });
    const el = buildCtxRow(document, rows[0]);
    expect(el.className).toBe('ctx-row');
    expect(el.getAttribute('role')).toBe('group');
    expect(el.getAttribute('aria-label')).toBe('Text direction');
    const buttons = [...el.querySelectorAll('button.dd-opt')];
    expect(buttons.map((b) => b.dataset.ctxOpt)).toEqual(['dir:auto', 'dir:rtl', 'dir:ltr']);
    expect(buttons.map((b) => b.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true']);
    expect(buttons.map((b) => b.getAttribute('role'))).toEqual(['menuitemradio', 'menuitemradio', 'menuitemradio']);
    expect(buttons[1].textContent).toBe('RTL');
    expect(el.querySelector('.cr-label svg use').getAttribute('href')).toBe('#ic-flip');
  });

  test('swatch buttons carry their palette and a tooltip, not text', () => {
    const rows = ctxRows({ forcedDir: null, theme: 'oasis', scale: 1, hasDocument: false, labels: LABELS });
    const el = buildCtxRow(document, rows[0]);
    const swatches = [...el.querySelectorAll('button.dd-opt')];
    expect(swatches.map((b) => b.textContent)).toEqual(['', '', '', '']);
    expect(swatches[3].getAttribute('aria-checked')).toBe('true');
    expect(swatches[0].dataset.tip).toBe('Paper');
    expect(swatches[0].getAttribute('aria-label')).toBe('Paper');
    expect(swatches[0].style.getPropertyValue('--a')).toBe(THEME_SWATCH.paper[0]);
    expect(swatches[0].style.getPropertyValue('--b')).toBe(THEME_SWATCH.paper[1]);
    expect(el.classList.contains('cr-swatches')).toBe(true);
  });

  test('a stepper row is a plain menuitem group and marks its percent button', () => {
    const rows = ctxRows({ forcedDir: null, theme: 'paper', scale: 1.5, hasDocument: true, labels: LABELS });
    const el = buildCtxRow(document, rows[2]);
    const buttons = [...el.querySelectorAll('button.dd-opt')];
    expect(buttons.map((b) => b.textContent)).toEqual(['A−', '150%', 'A+']);
    expect(buttons.map((b) => b.getAttribute('role'))).toEqual(['menuitem', 'menuitem', 'menuitem']);
    expect(buttons[1].classList.contains('pc')).toBe(true);
    expect(el.classList.contains('cr-stepper')).toBe(true);
  });
});

describe('THEME_SWATCH', () => {
  test('lists a two-colour pair for each of the four themes', () => {
    expect(Object.keys(THEME_SWATCH)).toEqual(['paper', 'ink', 'sepia', 'oasis']);
    expect(THEME_SWATCH.ink).toEqual(['#131519', '#8E94FF']);
  });
});

describe('selectionLabel', () => {
  test('keeps short text and collapses whitespace', () => {
    expect(selectionLabel('  slow   tools\nbeget  ')).toBe('slow tools beget');
  });

  test('cuts long text at 24 characters with an ellipsis', () => {
    expect(selectionLabel('abcdefghijklmnopqrstuvwxyz0123')).toBe('abcdefghijklmnopqrstuvwx…');
    expect(selectionLabel('abcdefghijklmnopqrstuvwx')).toBe('abcdefghijklmnopqrstuvwx');
  });

  test('handles empty and missing text', () => {
    expect(selectionLabel('')).toBe('');
    expect(selectionLabel(undefined)).toBe('');
  });
});

describe('surfaceActions', () => {
  test('a dirty tab offers Save first', () => {
    expect(surfaceActions({ kind: 'tab' }, { dirty: true })).toEqual([{ id: 'local:tab-save', key: 'ctx.save' }]);
  });

  test('a clean tab, a tree row and a wikilink add nothing', () => {
    expect(surfaceActions({ kind: 'tab' }, { dirty: false })).toEqual([]);
    expect(surfaceActions({ kind: 'tree' }, { dirty: true })).toEqual([]);
    expect(surfaceActions({ kind: 'wikilink' })).toEqual([]);
  });

  test('a reading-view selection offers Highlight, Note and Search with the quoted text', () => {
    expect(surfaceActions({ kind: 'selection', text: 'slow tools' })).toEqual([
      { id: 'local:sel-highlight', key: 'ctx.highlight' },
      { id: 'local:sel-note', key: 'ctx.addNote' },
      { id: 'local:sel-search', key: 'ctx.searchLibrary', vars: { text: 'slow tools' } },
    ]);
  });

  test('the editor offers the Format group', () => {
    expect(surfaceActions({ kind: 'text', inEditor: true })).toEqual([
      { id: 'local:fmt-bold', key: 'ctx.bold' },
      { id: 'local:fmt-italic', key: 'ctx.italic' },
      { id: 'local:fmt-strike', key: 'ctx.strike' },
      { id: 'local:fmt-code', key: 'ctx.code' },
      { id: 'local:fmt-link', key: 'ctx.link' },
    ]);
  });

  test('a plain text field and an empty surface offer none', () => {
    expect(surfaceActions({ kind: 'text', inEditor: false })).toEqual([]);
    expect(surfaceActions({ kind: 'text' })).toEqual([]);
    expect(surfaceActions(null)).toEqual([]);
    expect(surfaceActions({ kind: null })).toEqual([]);
  });
});
