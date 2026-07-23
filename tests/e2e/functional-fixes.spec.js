// @ts-check
/**
 * functional-fixes.spec.js — regression tests for the post-verification fixes:
 *   M08  Save routes vault files through the fs:writeFile IPC bridge (not a Blob download)
 *   R09  [[wikilinks]] render as clickable anchors in the CM6 live-preview editor
 *   R10  note-relative images are rewritten to bpmd://vault/<rel>
 *
 * Drives the real renderer (index.html) in Chromium. The Electron bridge is mocked
 * on window so the renderer's Electron branches execute headlessly.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_URL = 'file:///' + path.resolve(__dirname, '../../src/renderer/index.html').replace(/\\/g, '/');

async function goto(page) {
  await page.goto(INDEX_URL);
  await page.waitForSelector('#app');
}

// ── M08: Save → fs:writeFile ────────────────────────────────────────────────
test.describe('[M08] Save writes vault files in place via IPC', () => {
  test('saveCurrent calls electronAPI.writeFile with document capability and conflict token', async ({ page }) => {
    await goto(page);
    const result = await page.evaluate(async () => {
      const calls = [];
      window.electronAPI = { writeFile: (p) => { calls.push(p); return Promise.resolve({ ok: true, meta: { hash: 'h' } }); } };
      window._appState.files = [{ name: 'note.md', path: 'sub/note.md', handle: null, content: '# edited', dirty: true, revision: 2, documentId: 'cap-note', vaultId: 'cap-vault', meta: { hash: 'base', bom: false, eol: '\n', finalNewline: false } }];
      window.renderFile(0);
      await window.saveCurrent();
      return { calls, dirty: window._appState.files[0].dirty };
    });
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0]).toMatchObject({ documentId: 'cap-note', content: '# edited', revision: 2, baseHash: 'base' });
    expect(result.dirty).toBe(false); // a successful write clears the dirty flag
  });

  test('a write error keeps the file dirty and does NOT fall back to a download', async ({ page }) => {
    await goto(page);
    const result = await page.evaluate(async () => {
      let downloads = 0;
      const origCreate = document.createElement.bind(document);
      document.createElement = (tag) => { const el = origCreate(tag); if (tag === 'a') { const oc = el.click.bind(el); el.click = () => { if (el.download) downloads++; else oc(); }; } return el; };
      window.electronAPI = { writeFile: () => Promise.resolve({ error: 'conflict' }) };
      window._appState.files = [{ name: 'n.md', path: 'n.md', handle: null, content: 'x', dirty: true, documentId: 'cap-note', vaultId: 'cap-vault', meta: { hash: 'base' } }];
      window.renderFile(0);
      await window.saveCurrent();
      return { dirty: window._appState.files[0].dirty, downloads };
    });
    expect(result.dirty).toBe(true);
    expect(result.downloads).toBe(0);
  });

  test('a non-vault file (no document capability, no handle, no IPC) still uses the Blob download fallback', async ({ page }) => {
    await goto(page);
    const download = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
    await page.evaluate(async () => {
      delete window.electronAPI;
      window._appState.files = [{ name: 'loose.md', path: 'loose.md', handle: null, content: 'hi', dirty: true }];
      window.renderFile(0);
      await window.saveCurrent();
    });
    expect(await download).not.toBeNull();
  });
});

// ── R09: wikilinks clickable in the CM6 editor ──────────────────────────────
test.describe('[R09] wikilinks render + navigate in the CM6 live-preview', () => {
  test('a paragraph [[link]] becomes a clickable anchor in .cm-mount and navigates on click', async ({ page }) => {
    await goto(page);
    await page.evaluate(() => {
      window._appState.files = [
        // Wikilink on line 3: the live-preview only renders it as an anchor on lines the
        // cursor is NOT on, so keep the caret on line 1 (set below).
        { name: 'Home.md', path: 'Home.md', content: '# Home\n\nSee [[Target Note]] for more.', dirty: false },
        { name: 'Target Note.md', path: 'Target Note.md', content: '# Target', dirty: false },
      ];
      window.renderFile(0);
    });
    await expect(page.locator('.cm-mount .cm-editor')).toHaveCount(1, { timeout: 8000 });
    await page.evaluate(() => window.getActiveCmAdapter().setSelection({ start: 0, end: 0 })); // caret on line 1
    const anchor = page.locator('.cm-mount a.wikilink');
    await expect(anchor).toHaveCount(1);
    await expect(anchor).toHaveText('Target Note');
    expect(await anchor.getAttribute('data-target')).toBe('Target Note');
    await anchor.click();
    // navWikilink resolves "Target Note" → switches the active file to index 1
    expect(await page.evaluate(() => window._appState.activeFile)).toBe(1);
  });
});

// ── R10: vault-relative images → bpmd:// ────────────────────────────────────
test.describe('[R10] note-relative images rewrite to bpmd://vault/<rel>', () => {
  test('a root-level note rewrites ![](pic.png) to bpmd://vault/pic.png', async ({ page }) => {
    await goto(page);
    const src = await page.evaluate(() => {
      window._appState.files = [{ name: 'n.md', path: 'n.md', content: '![alt](pic.png)', dirty: false, vaultId: 'cap-vault' }];
      window.renderFile(0);
      return document.querySelector('#noteContent img')?.getAttribute('src');
    });
    expect(src).toBe('bpmd://vault/pic.png');
  });

  test('a note in a subfolder resolves the image against the note directory', async ({ page }) => {
    await goto(page);
    const src = await page.evaluate(() => {
      window._appState.files = [{ name: 'note.md', path: 'sub/dir/note.md', content: '![](../pic%20a.png)', dirty: false, vaultId: 'cap-vault' }];
      window.renderFile(0);
      return document.querySelector('#noteContent img')?.getAttribute('src');
    });
    // ../ from sub/dir → sub; spaces percent-encoded per segment
    expect(src).toBe('bpmd://vault/sub/pic%20a.png');
  });

  test('absolute / http / data srcs and non-vault notes are left untouched', async ({ page }) => {
    await goto(page);
    const srcs = await page.evaluate(() => {
      window._appState.files = [{ name: 'n.md', path: 'n.md', content: '![](https://x/y.png)\n\n![](data:image/png;base64,AAA)', dirty: false, vaultId: 'cap-vault' }];
      window.renderFile(0);
      const imgs = [...document.querySelectorAll('#noteContent img')].map(i => i.getAttribute('src'));
      // a non-vault note (no vaultId) leaves a relative src alone
      window._appState.files = [{ name: 'm.md', path: 'm.md', content: '![](pic.png)', dirty: false }];
      window.renderFile(0);
      imgs.push(document.querySelector('#noteContent img')?.getAttribute('src'));
      return imgs;
    });
    expect(srcs[0]).toBe('https://x/y.png');
    expect(srcs[1]).toMatch(/^data:image\/png/);
    expect(srcs[2]).toBe('pic.png');
  });
});
