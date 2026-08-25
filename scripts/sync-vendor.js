'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildSync } = require('esbuild');

const ROOT = path.resolve(__dirname, '..');
const CHECK = process.argv.includes('--check');
const TEMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'bpmd-vendor-'));
const mismatches = [];

const directCopies = [
  ['dompurify', 'dist/purify.min.js', 'resources/vendor/dompurify/purify.min.js'],
  ['katex', 'dist/katex.min.js', 'resources/vendor/katex/katex.min.js'],
  ['katex', 'dist/katex.min.css', 'resources/vendor/katex/katex.min.css'],
  ['marked', 'lib/marked.umd.js', 'resources/vendor/marked/marked.umd.js'],
  ['mermaid', 'dist/mermaid.min.js', 'resources/vendor/mermaid/mermaid.min.js'],
];

const iconMap = {
  folder: 'folder', file: 'file-text', 'file-plus': 'file-plus', sparkles: 'sparkles',
  flip: 'arrow-left-right', theme: 'circle-pile', bold: 'bold', italic: 'italic',
  strike: 'strikethrough', underline: 'underline', highlighter: 'highlighter',
  subscript: 'subscript', superscript: 'superscript', eraser: 'eraser', asterisk: 'asterisk',
  'indent-increase': 'list-indent-increase', 'indent-decrease': 'list-indent-decrease',
  code: 'code', 'code-block': 'square-code', link: 'link', wikilink: 'brackets',
  heading: 'heading', quote: 'quote', callout: 'info', list: 'list',
  'list-ordered': 'list-ordered', 'list-checks': 'list-checks', table: 'table',
  rule: 'minus', image: 'image', math: 'sigma', 'chevron-down': 'chevron-down',
  'calendar-plus': 'calendar-plus', save: 'save', 'file-code': 'file-code', printer: 'printer',
  x: 'x', 'undo-2': 'undo-2', 'redo-2': 'redo-2', scissors: 'scissors', copy: 'copy',
  'clipboard-paste': 'clipboard-paste', 'text-select': 'scan-text', search: 'search',
  'zoom-in': 'zoom-in', 'zoom-out': 'zoom-out', command: 'command', keyboard: 'keyboard',
  'refresh-cw': 'refresh-cw', info: 'info', 'panel-left': 'panel-left',
  'panel-right': 'panel-right', languages: 'languages', 'align-justify': 'text-align-justify',
  sun: 'sun', moon: 'moon', 'book-open': 'book-open', 'rotate-ccw': 'rotate-ccw',
  'sun-medium': 'sun-medium', pencil: 'pencil', expand: 'expand', shrink: 'shrink',
};

function packageDir(name, from = ROOT) {
  let cursor = path.dirname(require.resolve(name, { paths: [from] }));
  while (cursor !== path.dirname(cursor)) {
    const manifestPath = path.join(cursor, 'package.json');
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (manifest.name === name) return cursor;
    }
    cursor = path.dirname(cursor);
  }
  throw new Error('Could not locate package root for ' + name);
}

function readPackage(name, from = ROOT) {
  const dir = packageDir(name, from);
  return { dir, manifest: JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) };
}

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function put(targetRelative, content) {
  const target = path.join(ROOT, targetRelative);
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  if (CHECK) {
    if (!fs.existsSync(target) || !fs.readFileSync(target).equals(bytes)) mismatches.push(targetRelative);
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
}

function buildBundles() {
  const cmOutput = path.join(CHECK ? TEMP_ROOT : ROOT, 'resources/vendor/codemirror/codemirror.min.js');
  const highlightOutput = path.join(CHECK ? TEMP_ROOT : ROOT, 'resources/vendor/highlight/highlight.min.js');
  fs.mkdirSync(path.dirname(cmOutput), { recursive: true });
  fs.mkdirSync(path.dirname(highlightOutput), { recursive: true });

  buildSync({
    entryPoints: [path.join(ROOT, 'scripts/codemirror-entry.mjs')], bundle: true,
    format: 'iife', globalName: 'CM6', minify: true, outfile: cmOutput,
  });
  buildSync({
    entryPoints: [path.join(ROOT, 'scripts/highlight-entry.mjs')], bundle: true,
    format: 'iife', minify: true, outfile: highlightOutput,
  });

  if (CHECK) {
    put('resources/vendor/codemirror/codemirror.min.js', fs.readFileSync(cmOutput));
    put('resources/vendor/highlight/highlight.min.js', fs.readFileSync(highlightOutput));
  }
}

function syncDirectAssets() {
  for (const [name, sourceRelative, targetRelative] of directCopies) {
    put(targetRelative, fs.readFileSync(path.join(packageDir(name), sourceRelative)));
  }

  const katexFonts = path.join(packageDir('katex'), 'dist/fonts');
  for (const name of fs.readdirSync(katexFonts).filter((file) => file.endsWith('.woff2')).sort()) {
    put('resources/vendor/katex/fonts/' + name, fs.readFileSync(path.join(katexFonts, name)));
  }
}

function renderLucideSymbols() {
  const sprite = fs.readFileSync(path.join(packageDir('lucide-static'), 'sprite.svg'), 'utf8');
  const symbols = [];
  for (const [targetName, sourceName] of Object.entries(iconMap)) {
    const escaped = sourceName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = sprite.match(new RegExp('<symbol id="' + escaped + '"[\\s\\S]*?<\\/symbol>'));
    if (!match) throw new Error('lucide-static does not contain icon: ' + sourceName);
    const renamed = match[0].replace('id="' + sourceName + '"', 'id="ic-' + targetName + '"')
      .split(/\r?\n/).map((line) => '    ' + line.trim()).join('\n');
    symbols.push(renamed);
  }
  return symbols.join('\n');
}

function syncLucide() {
  const indexPath = path.join(ROOT, 'src', 'renderer', 'index.html');
  const current = fs.readFileSync(indexPath, 'utf8');
  const replacement = '<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">\n  <defs>\n'
    + renderLucideSymbols() + '\n  </defs>\n</svg>';
  const next = current.replace(/<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">[\s\S]*?<\/svg>/, replacement);
  if (next === current && !current.includes(replacement)) throw new Error('Could not locate inline Lucide sprite');
  put('src/renderer/index.html', next);
}

function collectRuntimeLicenses() {
  const roots = [
    'dompurify', 'katex', 'highlight.js', 'marked', 'mermaid', 'lucide-static',
    '@codemirror/state', '@codemirror/view', '@codemirror/commands',
    '@codemirror/language', '@codemirror/lang-markdown', '@codemirror/search', '@lezer/highlight',
  ];
  const packages = new Map();

  function visit(name, from = ROOT) {
    let found;
    try { found = readPackage(name, from); } catch { return; }
    const key = found.manifest.name + '@' + found.manifest.version;
    if (packages.has(key)) return;
    packages.set(key, found);
    for (const dependency of Object.keys(found.manifest.dependencies || {}).sort()) visit(dependency, found.dir);
  }
  roots.forEach((name) => visit(name));

  const sections = [];
  for (const [key, { dir, manifest }] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
    const licenseName = fs.readdirSync(dir).find((name) => /^(license|licence|copying)(\..*)?$/i.test(name));
    if (!licenseName) throw new Error('No complete license text found for ' + key);
    const license = fs.readFileSync(path.join(dir, licenseName), 'utf8').trim();
    sections.push('='.repeat(78) + '\n' + key + ' — ' + (manifest.license || 'see license text')
      + '\n' + '='.repeat(78) + '\n' + license);
  }
  return 'BP MD RTL Reader — bundled third-party license texts\n'
    + 'Generated by scripts/sync-vendor.js from package-lock.json.\n\n'
    + sections.join('\n\n') + '\n';
}

function generateManifest() {
  const assets = [];
  const targets = [
    ...directCopies.map(([, , target]) => target),
    'resources/vendor/codemirror/codemirror.min.js',
    'resources/vendor/highlight/highlight.min.js',
    ...fs.readdirSync(path.join(packageDir('katex'), 'dist/fonts')).filter((file) => file.endsWith('.woff2'))
      .sort().map((file) => 'resources/vendor/katex/fonts/' + file),
  ];
  for (const target of targets.sort()) {
    const file = path.join(ROOT, target);
    if (!fs.existsSync(file)) throw new Error('Missing generated vendor asset: ' + target);
    assets.push({ file: target, sha256: sha256(fs.readFileSync(file)) });
  }
  const sources = [...new Set([
    ...directCopies.map(([name]) => name), 'highlight.js', 'lucide-static',
    '@codemirror/state', '@codemirror/view', '@codemirror/commands', '@codemirror/language',
    '@codemirror/lang-markdown', '@codemirror/search', '@lezer/highlight',
  ])].sort().map((name) => {
    const { manifest } = readPackage(name);
    return { package: name, version: manifest.version };
  });
  return JSON.stringify({ schemaVersion: 1, sources, assets }, null, 2) + '\n';
}

try {
  buildBundles();
  syncDirectAssets();
  syncLucide();
  put('resources/vendor/THIRD-PARTY-LICENSES.txt', collectRuntimeLicenses());
  put('resources/vendor/vendor-manifest.json', generateManifest());

  if (mismatches.length) {
    console.error('Vendored assets are out of sync:\n' + mismatches.map((file) => ' - ' + file).join('\n'));
    process.exitCode = 1;
  } else {
    console.log(CHECK ? 'Vendored assets match exact locked sources.' : 'Vendored assets synchronized.');
  }
} finally {
  fs.rmSync(TEMP_ROOT, { recursive: true, force: true });
}
