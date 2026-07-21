// @ts-check
/**
 * reading-mode.spec.js — T-F17 Reading (display) mode. A note opens in a clean, read-only
 * rendered view (#noteContent shown, CM6 editor hidden): clicking/selecting text never reveals
 * raw Markdown and copying yields clean prose. A top-toolbar button + Ctrl+E + a palette command
 * toggle Reading ⇄ Edit; the choice is reading-first by default and persisted.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_URL = 'file:///' + path.resolve(__dirname, '../index.html').replace(/\\/g, '/');
const FIX = '# Heading One\n\nThis is **bold** and *italic* and a [link](http://example.com).\n';

async function boot(page, settings = {}) {
  // viewMode defaults to 'reading' here (the packaged app's default, set in src/main/settings.js);
  // the renderer's in-memory default is 'edit', so this spec sets it explicitly. Individual tests
  // override with { viewMode: 'edit' }.
  const merged = { theme: 'paper', zoomFactor: 1, editorMode: 'live', viewMode: 'reading', recents: [], lastSession: null, ...settings };
  await page.addInitScript((s) => {
    window.__setSettingsCalls = [];
    window.electronAPI = {
      getSettings: async () => s,
      setSettings: async (patch) => { window.__setSettingsCalls.push(patch); },
      onOpenFile: () => {}, onVaultChanged: () => {},
    };
  }, merged);
  await page.goto(INDEX_URL);
  await page.waitForFunction(() => !!window._appState, null, { timeout: 8000 });
  // CM6 mounts on launch and adds .cm-single (the reading CSS keys on .cm-single.reading).
  await page.waitForFunction(() => document.getElementById('editorArea')?.classList.contains('cm-single'), null, { timeout: 8000 });
}

async function injectNote(page, content = FIX) {
  await page.evaluate((md) => {
    window._appState.files = [{ name: 'r.md', path: 'r.md', handle: null, content: md, dirty: false }];
    window.renderFile(0);
  }, content);
}

test.describe('Reading mode (T-F17)', () => {
  test('a note opens in Reading by default — rendered view shown, CM6 + writing toolbar hidden', async ({ page }) => {
    await boot(page);
    await injectNote(page);
    await expect(page.locator('#editorArea')).toHaveClass(/reading/);
    await expect(page.locator('.source-pane')).toBeHidden();
    await expect(page.locator('#noteContent')).toBeVisible();
    await expect(page.locator('#toolbarStrip')).toBeHidden();
    await expect(page.locator('#viewModeBtn')).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => window._appState.viewMode)).toBe('reading');
  });

  test('clicking #viewModeBtn toggles to Edit and back', async ({ page }) => {
    await boot(page);
    await injectNote(page);
    await page.click('#viewModeBtn');
    await expect(page.locator('#editorArea')).not.toHaveClass(/reading/);
    await expect(page.locator('.cm-mount .cm-editor')).toBeVisible();
    await expect(page.locator('#viewModeBtn')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#toolbarStrip')).toBeVisible();
    await page.click('#viewModeBtn');
    await expect(page.locator('#editorArea')).toHaveClass(/reading/);
  });
  test('switching from Reading to Edit wires CodeMirror outline synchronization', async ({ page }) => {
    await boot(page);
    const pad = (n) => Array.from({ length: n }, (_, i) => `line ${i}`).join('\n');
    await injectNote(page, `# One\n\n${pad(50)}\n\n## Two\n\n${pad(50)}\n\n### Three\n\n${pad(50)}\n`);
    await expect(page.locator('.toc-item')).toHaveCount(3);

    await page.click('#viewModeBtn');
    await expect(page.locator('#editorArea')).not.toHaveClass(/reading/);
    await page.evaluate(() => {
      const adapter = window.getActiveCmAdapter();
      adapter.scrollToPos(adapter.getValue().indexOf('### Three'), { select: false });
    });

    await expect.poll(() => page.evaluate(() => document.querySelector('.toc-item.active')?.textContent)).toBe('Three');
  });

  test('Ctrl+E toggles Reading ⇄ Edit', async ({ page }) => {
    await boot(page);
    await injectNote(page);
    await page.keyboard.press('Control+e');
    await expect(page.locator('#editorArea')).not.toHaveClass(/reading/);
    expect(await page.evaluate(() => window._appState.viewMode)).toBe('edit');
    await page.keyboard.press('Control+e');
    await expect(page.locator('#editorArea')).toHaveClass(/reading/);
    expect(await page.evaluate(() => window._appState.viewMode)).toBe('reading');
  });

  test('selecting text in Reading view yields clean prose (no Markdown markers)', async ({ page }) => {
    await boot(page);
    await injectNote(page);
    const text = await page.evaluate(() => {
      const nc = document.getElementById('noteContent');
      const range = document.createRange();
      range.selectNodeContents(nc);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      return sel.toString();
    });
    expect(text).toContain('Heading One');
    expect(text).toContain('bold');
    expect(text).not.toMatch(/\*\*/);     // no bold markers
    expect(text).not.toMatch(/(^|\n)#\s/); // no heading hash
    expect(text).not.toContain('](http'); // no link syntax
    // the note-meta chrome is excluded from real (drag) copies
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('#noteContent .doc-meta')).userSelect)).toBe('none');
  });

  test('clicking prose in Reading view does NOT reveal Markdown or switch to Edit', async ({ page }) => {
    await boot(page);
    await injectNote(page);
    await page.locator('#noteContent h1').click();
    expect(await page.evaluate(() => window._appState.viewMode)).toBe('reading');
    await expect(page.locator('.source-pane')).toBeHidden();
    expect(await page.locator('#noteContent h1').textContent()).not.toContain('#');
  });

  test('the reading container is keyboard-focusable + named, and gets focus on entering Reading', async ({ page }) => {
    await boot(page, { viewMode: 'edit' });
    await injectNote(page);
    await expect(page.locator('#noteContent')).toHaveAttribute('tabindex', '0');
    await expect(page.locator('#noteContent')).toHaveAttribute('aria-label', 'Reading view');
    await expect(page.locator('#noteContent')).not.toHaveAttribute('role', 'application');
    await page.click('#viewModeBtn'); // → reading
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('noteContent');
  });

  test('persisted viewMode "edit" restores to Edit; toggling persists the new mode', async ({ page }) => {
    await boot(page, { viewMode: 'edit' });
    await injectNote(page);
    expect(await page.evaluate(() => window._appState.viewMode)).toBe('edit');
    await expect(page.locator('#editorArea')).not.toHaveClass(/reading/);
    await page.click('#viewModeBtn'); // → reading; persistSettings is debounced ~200ms
    await page.waitForFunction(() => (window.__setSettingsCalls || []).some((c) => c.viewMode === 'reading'), null, { timeout: 3000 });
  });

  test('command palette exposes a Toggle Reading Mode entry', async ({ page }) => {
    await boot(page);
    await injectNote(page);
    await page.keyboard.press('Control+k');
    await expect(page.locator('.pal-item', { hasText: 'Toggle Reading Mode' }).first()).toBeVisible();
  });
});
