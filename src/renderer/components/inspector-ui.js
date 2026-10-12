import { parseFrontMatter } from '../markdown/frontmatter.js';
import { crumbSegments, fileMeta } from './doc-meta.js';
import { parseAtxHeading, isFenceLine } from './outline.js';

const ENCODING_LABELS = new Map([
  ['utf8', 'UTF-8'],
  ['utf-8', 'UTF-8'],
  ['windows-1256', 'Windows-1256'],
  ['cp1256', 'Windows-1256'],
  ['utf16le', 'UTF-16 LE'],
  ['utf16be', 'UTF-16 BE'],
]);

// The first H1 outside fenced code, read with the shared linear heading scanner (audit H9: the
// former FIRST_H1/FENCED regexes backtracked cubically on a heading with trailing whitespace).
function firstH1Text(body) {
  let inFence = false;
  for (const line of body.split('\n')) {
    if (isFenceLine(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const heading = parseAtxHeading(line);
    if (heading && heading.level === 1 && heading.text) return heading.text;
  }
  return '';
}

export function docTitle(content, name) {
  const { body } = parseFrontMatter(content == null ? '' : content);
  const heading = firstH1Text(body).replace(/[*_`~]/g, '').trim();
  return heading || String(name || '').replace(/\.(md|markdown|txt)$/i, '');
}

export function encodingLabel(meta) {
  const raw = meta && typeof meta.encoding === 'string' ? meta.encoding : 'utf8';
  return ENCODING_LABELS.get(raw.toLowerCase()) || raw.toUpperCase();
}

export function eolLabel(meta, content) {
  // audit M5: a file with more than one ending style keeps each line's own ending on save.
  if (meta && meta.eolMixed === true) return 'Mixed';
  if (meta && (meta.eol === '\r\n' || meta.eol === '\n')) return meta.eol === '\r\n' ? 'CRLF' : 'LF';
  return /\r\n/.test(content || '') ? 'CRLF' : 'LF';
}

export function inspectorData({ file, ratio, rootName }) {
  if (!file) return null;
  const meta = fileMeta(file);
  const encoding = encodingLabel(file.meta);
  return {
    title: docTitle(file.content, file.name),
    path: crumbSegments(rootName, file.path || file.name).join(' / '),
    dir: meta.dir,
    words: meta.words,
    minutes: meta.minutes,
    percent: Math.round(ratio * 100),
    encoding,
    eol: eolLabel(file.meta, file.content),
    legacyEncoding: encoding !== 'UTF-8',
  };
}

function setText(doc, id, text) {
  const el = doc.getElementById(id);
  if (el) el.textContent = text;
}

function setProgressBar(doc, ratio) {
  const el = doc.getElementById('sbProgress');
  if (!el) return;
  if (ratio === null) {
    el.hidden = true;
    return;
  }
  el.style.setProperty('--p', String(Math.min(1, Math.max(0, ratio))));
  el.hidden = false;
}

export function zoomLabel(factor) {
  const value = Number(factor);
  return `${Number.isFinite(value) ? Math.round(value * 100) : 100}%`;
}

export function renderZoom(doc, factor) {
  setText(doc, 'zoomBtn', zoomLabel(factor));
}

export function renderInspectorDoc(doc, data) {
  const header = doc.getElementById('inspDoc');
  if (header) {
    header.hidden = !data;
    if (data) header.dataset.d = data.dir;
  }
  const stat = doc.getElementById('encodingStat');
  if (stat) stat.classList.toggle('warn', Boolean(data && data.legacyEncoding));
  setProgressBar(doc, data ? data.percent / 100 : null);
  if (!data) {
    setText(doc, 'propEncoding', '—');
    setText(doc, 'propEol', '—');
    setText(doc, 'encodingStat', 'UTF-8');
    return;
  }
  setText(doc, 'inspDocTitle', data.title);
  setText(doc, 'inspDocPath', data.path);
  setText(doc, 'statWords', new Intl.NumberFormat('en').format(data.words));
  setText(doc, 'statMin', String(data.minutes));
  setText(doc, 'statProgress', `${data.percent}%`);
  setText(doc, 'propEncoding', data.encoding);
  setText(doc, 'propEol', data.eol);
  setText(doc, 'encodingStat', `${data.encoding} · ${data.eol}`);
}

export function renderInspectorProgress(doc, ratio) {
  const clamped = Math.min(1, Math.max(0, ratio));
  setText(doc, 'statProgress', `${Math.round(clamped * 100)}%`);
  setProgressBar(doc, clamped);
}
