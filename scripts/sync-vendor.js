'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildSync } = require('esbuild');

const ROOT = path.resolve(__dirname, '..');
const CHECK = process.argv.includes('--check');
let TEMP_ROOT = null; // created by main(); nothing touches the disk when this file is only required
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
  sun: 'sun', moon: 'moon', palette: 'palette', 'book-open': 'book-open', 'rotate-ccw': 'rotate-ccw',
  'sun-medium': 'sun-medium', pencil: 'pencil', expand: 'expand', shrink: 'shrink',
  flame: 'flame',
  // T6.1c: the closed-book glyph for the "Export EPUB…" menu/palette entry (book-open already
  // belongs to the Reading/Edit toggle).
  book: 'book',
};

// Find an installed package the way Node does (nearest node_modules upwards from `from`),
// but by DIRECTORY, not by require.resolve: packages that are ESM-only or have no main entry
// (@mermaid-js/parser, @upsetjs/venn.js, @types/*) cannot be require.resolve'd, and they were
// silently left out of the licence file together with everything they depend on (audit B10).
function packageDir(name, from = ROOT) {
  let cursor = from;
  for (;;) {
    const candidate = path.join(cursor, 'node_modules', name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return fs.realpathSync(candidate);
    if (cursor === ROOT || cursor === path.dirname(cursor)) break;
    cursor = path.dirname(cursor);
  }
  throw new Error('Could not locate installed package ' + name + ' (required from ' + from + ')');
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

// Every package whose code ends up in a vendored file. Their whole `dependencies` closure is
// bundled into the browser builds, so the closure is what the licence file must cover.
const RUNTIME_ROOTS = [
  'dompurify', 'katex', 'highlight.js', 'marked', 'mermaid', 'lucide-static',
  '@codemirror/state', '@codemirror/view', '@codemirror/commands',
  '@codemirror/language', '@codemirror/lang-markdown', '@codemirror/search', '@lezer/highlight',
];

// Licence texts for packages that are INLINED in a prebuilt bundle but are not installed,
// because the upstream package that inlined them lists them as devDependencies
// (@mermaid-js/parser ships chevrotain and langium inside its dist files). Their texts cannot
// come from node_modules, so they are tracked here, one file per package@version.
const SUPPLEMENT_DIR = path.join(ROOT, 'scripts', 'license-supplements');

function readSupplements() {
  const manifest = JSON.parse(fs.readFileSync(path.join(SUPPLEMENT_DIR, 'manifest.json'), 'utf8'));
  return new Map(manifest.packages.map((entry) => [entry.name, entry]));
}

/**
 * Packages named by the `sources` of one source map.
 * @param {string[]} sources
 * @returns {Map<string, Set<string|null>>} name -> versions (null when the path has none)
 */
function packagesInSources(sources) {
  const found = new Map();
  for (const source of sources) {
    const marker = 'node_modules/';
    const at = source.lastIndexOf(marker);
    if (at < 0) continue;
    const rest = source.slice(at + marker.length).split('/');
    const name = rest[0].startsWith('@') ? rest[0] + '/' + rest[1] : rest[0];
    // pnpm layout: .pnpm/<name, with + for />@<version>[_peers]/node_modules/<name>/...
    // The store directory names this package only when it starts with the package's own name.
    const above = source.slice(0, at).split('/');
    const storeDir = above[above.length - 3] === '.pnpm' ? above[above.length - 2] : '';
    const prefix = name.replace('/', '+') + '@';
    const version = storeDir.startsWith(prefix)
      ? storeDir.slice(prefix.length).split('_')[0].split('(')[0]
      : null;
    const versions = found.get(name) || new Set();
    versions.add(version);
    found.set(name, versions);
  }
  return found;
}

function sourceMapsUnder(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { recursive: true }); } catch { return []; } // no dist/: nothing prebuilt
  return entries.map(String).filter((file) => file.endsWith('.map')).sort().map((file) => path.join(dir, file));
}

/**
 * Every package whose code is inside a prebuilt file of one of `packageDirs`, read from the
 * source maps those packages ship in `dist/`. This is where @mermaid-js/parser reveals the
 * chevrotain and langium code it carries. All dist variants are read, so the result can name
 * a package our own bundle does not contain; an extra licence text does no harm.
 * @returns {Map<string, Set<string|null>>} name -> versions seen (null when the map has none)
 */
const sourceMapCache = new Map(); // map file -> packages; the maps are tens of megabytes

function packagesInSourceMap(mapFile) {
  if (!sourceMapCache.has(mapFile)) {
    const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
    sourceMapCache.set(mapFile, packagesInSources(map.sources || []));
  }
  return sourceMapCache.get(mapFile);
}

function inlinedPackages(packageDirs) {
  const result = new Map();
  for (const dir of packageDirs) {
    for (const mapFile of sourceMapsUnder(path.join(dir, 'dist'))) {
      for (const [name, seen] of packagesInSourceMap(mapFile)) {
        const versions = result.get(name) || new Set();
        for (const version of seen) versions.add(version);
        result.set(name, versions);
      }
    }
  }
  return result;
}

function collectRuntimeLicenses(roots = RUNTIME_ROOTS, { supplements = readSupplements() } = {}) {
  const packages = new Map();

  // No try/catch: a dependency that cannot be located stops the run with a non-zero exit.
  // Skipping it quietly is how the licence file lost every package under mermaid's parser.
  function visit(name, from = ROOT) {
    const found = readPackage(name, from);
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
    sections.push({ key, text: '='.repeat(78) + '\n' + key + ' — ' + (manifest.license || 'see license text')
      + '\n' + '='.repeat(78) + '\n' + license });
  }

  // Packages inlined in a prebuilt file of the closure but not installed (audit B10). Each
  // must have a tracked licence text; one that has none stops the run.
  const covered = new Set([...packages.values()].map(({ manifest }) => manifest.name));
  const inlined = inlinedPackages([...packages.values()].map(({ dir }) => dir));
  for (const [name, versions] of [...inlined].sort(([a], [b]) => a.localeCompare(b))) {
    if (covered.has(name)) continue;
    const entry = supplements.get(name);
    if (!entry) {
      throw new Error('No license text for ' + name + ' (' + [...versions].filter(Boolean).join(', ')
        + '), which is inlined in a vendored bundle. Add it to scripts/license-supplements/.');
    }
    const known = [...versions].filter(Boolean);
    if (known.length && !known.includes(entry.version)) {
      throw new Error('License supplement for ' + name + ' is ' + entry.version + ' but the bundle inlines ' + known.join(', '));
    }
    const license = fs.readFileSync(path.join(SUPPLEMENT_DIR, entry.file), 'utf8').trim();
    if (sha256(license + '\n') !== entry.sha256) throw new Error('License supplement changed: ' + entry.file);
    const key = name + '@' + entry.version;
    sections.push({ key, text: '='.repeat(78) + '\n' + key + ' — ' + entry.license
      + '\n' + '='.repeat(78) + '\n' + license });
  }
  sections.sort((a, b) => a.key.localeCompare(b.key));

  return 'BP MD RTL Reader — bundled third-party license texts\n'
    + 'Generated by scripts/sync-vendor.js from package-lock.json and scripts/license-supplements/.\n\n'
    + sections.map((section) => section.text).join('\n\n') + '\n';
}

function generateManifest() {
  const assets = [];
  const targets = [
    ...directCopies.map(([, , target]) => target),
    'resources/vendor/codemirror/codemirror.min.js',
    'resources/vendor/highlight/highlight.min.js',
    ...fs.readdirSync(path.join(packageDir('katex'), 'dist/fonts')).filter((file) => file.endsWith('.woff2'))
      .sort().map((file) => 'resources/vendor/katex/fonts/' + file),
    ...fs.readdirSync(path.join(ROOT, 'resources/vendor/fonts')).filter((file) => file.endsWith('.woff2'))
      .sort().map((file) => 'resources/vendor/fonts/' + file),
    'build/x86-unicode/EnVar.dll',
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

function main() {
  TEMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'bpmd-vendor-'));
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
}

if (require.main === module) main();

module.exports = { RUNTIME_ROOTS, packageDir, collectRuntimeLicenses, inlinedPackages, packagesInSources };
