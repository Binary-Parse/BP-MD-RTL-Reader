import { THEMES } from '../theme.js';
import { svgIcon } from '../icons.js';
import { crumbSegments, fileDirKind } from './doc-meta.js';

export const THEME_SWATCH = Object.freeze({
  paper: ['#FCFCFB', '#CFD3D8'],
  ink: ['#131519', '#8E94FF'],
  sepia: ['#F4EBDB', '#C2B195'],
  oasis: ['#0A2321', '#6FE0A8'],
});

const ICONS = new Map([
  ['role:undo', 'undo-2'],
  ['role:redo', 'redo-2'],
  ['role:cut', 'scissors'],
  ['role:copy', 'copy'],
  ['role:paste', 'clipboard-paste'],
  ['role:selectAll', 'text-select'],
  ['open-link', 'link'],
  ['copy-link', 'copy'],
  ['copy-image', 'image'],
  ['copy-image-address', 'link'],
  ['save-image', 'save'],
  ['local:tab-close', 'x'],
  ['local:tab-close-others', 'tabs-other'],
  ['local:tab-close-all', 'tabs-close'],
  ['local:tab-duplicate', 'copy'],
  ['local:reveal', 'folder'],
  ['local:copy-path', 'link'],
  ['local:tree-open', 'book-open'],
  ['local:wiki-open', 'book-open'],
  ['local:wiki-copy', 'copy'],
  ['local:tab-save', 'save'],
  ['local:sel-highlight', 'highlighter'],
  ['local:sel-note', 'pencil'],
  ['local:sel-search', 'search'],
  ['local:fmt-bold', 'bold'],
  ['local:fmt-italic', 'italic'],
  ['local:fmt-strike', 'strike'],
  ['local:fmt-code', 'code'],
  ['local:fmt-link', 'link'],
  ['app:newNote', 'file-plus'],
  ['app:openFind', 'search'],
  ['app:openPalette', 'command'],
  ['app:toggleAutoHideTitlebar', 'bar-top'],
  ['app:toggleHideStatusBar', 'bar-bottom'],
  ['app:showSettings', 'gear'],
]);

export function ctxIconName(item) {
  if (!item) return null;
  let key = item.id;
  if (item.kind === 'role') key = `role:${item.role}`;
  else if (item.kind === 'app-command') key = `app:${item.id}`;
  return ICONS.get(key) || null;
}

export function ctxHeader(surface, file, rootName) {
  if (!surface) return null;
  if (surface.kind === 'wikilink') return { kind: 'wikilink', title: surface.target, sub: '', dir: 'ltr' };
  if ((surface.kind !== 'tab' && surface.kind !== 'tree') || surface.isDir || !file) return null;
  return {
    kind: 'file',
    title: String(file.name).replace(/\.(md|markdown|txt)$/i, ''),
    sub: crumbSegments(rootName, file.path || file.name).join(' / '),
    dir: fileDirKind(file.content, file.forcedDir ?? null),
  };
}

export function ctxRows({ forcedDir, theme, scale, hasDocument, labels }) {
  const rows = [];
  if (hasDocument) {
    const current = forcedDir || 'auto';
    rows.push({
      id: 'dir',
      kind: 'seg',
      label: labels.direction,
      icon: 'flip',
      options: ['auto', 'rtl', 'ltr'].map((v) => ({ id: `dir:${v}`, label: labels[`dir.${v}`], on: current === v })),
    });
  }
  rows.push({
    id: 'theme',
    kind: 'swatches',
    label: labels.theme,
    icon: 'palette',
    options: THEMES.map((v) => ({ id: `theme:${v}`, label: labels[`theme.${v}`], on: theme === v, v })),
  });
  if (hasDocument) {
    rows.push({
      id: 'scale',
      kind: 'stepper',
      label: labels.textSize,
      icon: 'zoom-in',
      keepOpen: true,
      options: [
        { id: 'scale:dec', label: 'A−' },
        { id: 'scale:reset', label: `${Math.round(scale * 100)}%`, pc: true },
        { id: 'scale:inc', label: 'A+' },
      ],
    });
  }
  return rows;
}

export function buildCtxHeader(doc, header) {
  const el = doc.createElement('div');
  el.className = 'ctx-head';
  el.dataset.d = header.dir;
  const title = doc.createElement('span');
  title.className = 'ch-title';
  if (header.kind === 'wikilink') {
    title.textContent = `[[${header.title}]]`;
  } else {
    const tick = doc.createElement('i');
    tick.className = 'ch-tick';
    const name = doc.createElement('bdi');
    name.textContent = header.title;
    title.append(tick, name);
  }
  el.appendChild(title);
  if (header.sub) {
    const sub = doc.createElement('span');
    sub.className = 'ch-sub';
    sub.setAttribute('dir', 'ltr');
    sub.textContent = header.sub;
    el.appendChild(sub);
  }
  return el;
}

export function buildCtxRow(doc, row) {
  const el = doc.createElement('div');
  el.className = 'ctx-row';
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', row.label);
  if (row.kind === 'swatches') el.classList.add('cr-swatches');
  if (row.kind === 'stepper') el.classList.add('cr-stepper');
  const label = doc.createElement('span');
  label.className = 'cr-label';
  label.appendChild(svgIcon(row.icon));
  const text = doc.createElement('span');
  text.textContent = row.label;
  label.appendChild(text);
  const opts = doc.createElement('span');
  opts.className = 'cr-opts';
  const radio = row.kind !== 'stepper';
  for (const option of row.options) {
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = `dd-opt${option.pc ? ' pc' : ''}`;
    btn.dataset.ctxOpt = option.id;
    btn.setAttribute('role', radio ? 'menuitemradio' : 'menuitem');
    if (radio) btn.setAttribute('aria-checked', option.on ? 'true' : 'false');
    if (row.kind === 'swatches') {
      const [a, b] = THEME_SWATCH[option.v];
      btn.style.setProperty('--a', a);
      btn.style.setProperty('--b', b);
      btn.dataset.tip = option.label;
      btn.setAttribute('aria-label', option.label);
    } else {
      btn.textContent = option.label;
    }
    opts.appendChild(btn);
  }
  el.append(label, opts);
  return el;
}

const SELECTION_LABEL_MAX = 24;

export function selectionLabel(text) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  return flat.length > SELECTION_LABEL_MAX ? `${flat.slice(0, SELECTION_LABEL_MAX)}…` : flat;
}

const FORMAT_ACTIONS = [
  { id: 'local:fmt-bold', key: 'ctx.bold' },
  { id: 'local:fmt-italic', key: 'ctx.italic' },
  { id: 'local:fmt-strike', key: 'ctx.strike' },
  { id: 'local:fmt-code', key: 'ctx.code' },
  { id: 'local:fmt-link', key: 'ctx.link' },
];

export function surfaceActions(surface, { dirty = false } = {}) {
  if (!surface) return [];
  if (surface.kind === 'tab') return dirty ? [{ id: 'local:tab-save', key: 'ctx.save' }] : [];
  if (surface.kind === 'selection') {
    return [
      { id: 'local:sel-highlight', key: 'ctx.highlight' },
      { id: 'local:sel-note', key: 'ctx.addNote' },
      { id: 'local:sel-search', key: 'ctx.searchLibrary', vars: { text: selectionLabel(surface.text) } },
    ];
  }
  if (surface.kind === 'text' && surface.inEditor) return FORMAT_ACTIONS.map((action) => ({ ...action }));
  return [];
}
