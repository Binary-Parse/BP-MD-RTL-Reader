import { describe, expect, test } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(path.join(root, 'index.html'), 'utf8');
const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const architectureDocs = [
  readFileSync(path.join(root, 'AGENTS.md'), 'utf8'),
  readFileSync(path.join(root, 'docs', 'BUILD.md'), 'utf8'),
].join('\n');
const styleFiles = [
  'src/renderer/styles/base.css',
  'src/renderer/styles/themes.css',
  'src/renderer/styles/components.css',
  'src/renderer/styles/responsive.css',
];

describe('ARCH-001 renderer stylesheet boundaries', () => {
  test('loads the four app stylesheets in deterministic cascade order with no inline style block', () => {
    expect(html).not.toMatch(/<style(?:\s|>)/i);
    const hrefs = [...html.matchAll(/<link\s+[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi)]
      .map((match) => match[1])
      .filter((href) => href.startsWith('src/renderer/styles/'));
    expect(hrefs).toEqual(styleFiles);
  });

  test('ships every stylesheet in the Electron application payload', () => {
    expect(packageJson.build.files).toContain('src/**/*.css');
    for (const file of styleFiles) {
      expect(existsSync(path.join(root, file)), `missing stylesheet: ${file}`).toBe(true);
    }
  });

  test('documents index.html as markup linked to external app stylesheets', () => {
    expect(architectureDocs).not.toMatch(/index\.html[^\n]*inline styles/i);
    expect(architectureDocs).toMatch(/src\/renderer\/styles\//);
  });
});
