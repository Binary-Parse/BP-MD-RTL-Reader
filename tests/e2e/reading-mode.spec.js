// @ts-check
/**
 * reading-mode.spec.js — T-F17 Reading (display) mode. A note opens in a clean, read-only
 * rendered view (#noteContent shown, CM6 editor hidden): clicking/selecting text never reveals
 * raw Markdown and copying yields clean prose. A top-toolbar button + Ctrl+E + a palette command
 * toggle Reading ⇄ Edit; the choice is reading-first by default and persisted.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_URL = 'file:///' + path.resolve(__dirname, '../../src/renderer/index.html').replace(/\\/g, '/');
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

  // audit UX-14b: the button's static literal must match the renderer's in-memory default
  // ('edit' → NOT pressed). The packaged app then syncs it from the saved settings during
  // restore (settings-controller calls setViewMode), which the test above pins.
  test('without a settings bridge the button boots unpressed, matching the edit default', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForFunction(() => !!window._appState, null, { timeout: 8000 });
    await expect(page.locator('#viewModeBtn')).toHaveAttribute('aria-pressed', 'false');
    expect(await page.evaluate(() => window._appState.viewMode)).toBe('edit');
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

// ── T5.1c: highlights + margin notes ────────────────────────────────────────────────
// The bridge keeps the store in page memory, so the "close the note and reopen it" flow
// (the plan's acceptance criterion) exercises the same read-back path main provides.
const HL_NOTE = '# Heading One\n\nThe quick brown fox jumps over the lazy dog, twice over.\n\nA second paragraph with more prose to read.\n';

async function bootWithAnnotations(page, settings = {}) {
  await boot(page, settings);
  await page.evaluate(() => {
    window.__annotations = {};
    window.electronAPI.annotationsGet = async (key) => ({ highlights: window.__annotations[key] || [] });
    window.electronAPI.annotationsPut = async (payload) => {
      // Mirrors the real store: an empty list drops the document key entirely.
      if (payload.highlights.length === 0) delete window.__annotations[payload.docKey];
      else window.__annotations[payload.docKey] = payload.highlights.slice();
      return { ok: true, count: payload.highlights.length };
    };
  });
}

/** Select `needle` in the reading DOM and fire the mouseup the selection bar listens for. */
async function selectInNote(page, needle, { acrossParagraphs = false } = {}) {
  return page.evaluate(({ needle, acrossParagraphs }) => {
    const root = document.getElementById('noteContent');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let node = walker.nextNode();
    while (node) {
      const hay = node.nodeValue || '';
      const idx = hay.indexOf(needle);
      if (idx >= 0) {
        const range = document.createRange();
        range.setStart(node, idx);
        if (acrossParagraphs) {
          // Start in this paragraph, end in the next one: a multi-node selection.
          const next = root.querySelectorAll('p')[1]?.firstChild;
          if (!next) return { ok: false, reason: 'no second paragraph' };
          range.setEnd(next, 3);
        } else {
          range.setEnd(node, idx + needle.length);
        }
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        return { ok: true };
      }
      node = walker.nextNode();
    }
    return { ok: false, reason: 'text not found' };
  }, { needle, acrossParagraphs });
}

test.describe('Reading highlights + margin notes (T5.1c)', () => {
  test('highlight a passage → close the note → reopen it → the highlight is still there', async ({ page }) => {
    await bootWithAnnotations(page);
    await injectNote(page, HL_NOTE);

    expect(await selectInNote(page, 'quick brown fox')).toMatchObject({ ok: true });
    await expect(page.locator('#hlBar')).toBeVisible();
    await page.click('#hlBtn');

    await expect(page.locator('#noteContent mark.user-hl')).toHaveCount(1);
    expect(await page.locator('#noteContent mark.user-hl').textContent()).toBe('quick brown fox');
    // Stored through the bridge under the document's key.
    expect(await page.evaluate(() => Object.keys(window.__annotations))).toEqual(['loose:r.md']);
    expect(await page.evaluate(() => window.__annotations['loose:r.md'].length)).toBe(1);

    // Close the note (not dirty → no save prompt), then reopen the same file.
    await page.click('#tabList .tab .close');
    await expect(page.locator('#welcome')).toBeVisible();
    await injectNote(page, HL_NOTE);

    await expect(page.locator('#noteContent mark.user-hl')).toHaveCount(1);
    expect(await page.locator('#noteContent mark.user-hl').textContent()).toBe('quick brown fox');
  });

  test('the Inspector lists the highlight with a 60-char excerpt, and × deletes it', async ({ page }) => {
    await bootWithAnnotations(page);
    // A long paragraph so a long selection has to be truncated in the list.
    await injectNote(page, `# Heading\n\n${'Lorem ipsum dolor sit amet. '.repeat(6)}\n`);
    const longSelection = 'Lorem ipsum dolor sit amet. '.repeat(3).trim(); // 80 chars, one text node

    await selectInNote(page, longSelection);
    await page.click('#hlBtn');

    const row = page.locator('#noteList .note-row');
    await expect(row).toHaveCount(1);
    const excerpt = await row.locator('.n-text').textContent();
    expect(excerpt.endsWith('…')).toBe(true);
    expect(excerpt.length).toBe(60);
    expect(await row.locator('.n-time')).not.toBeEmpty();

    // The delete button unwraps the mark and empties the store for this document.
    await row.locator('.note-del').click();
    await expect(page.locator('#noteContent mark.user-hl')).toHaveCount(0);
    await expect(page.locator('#noteList .note-empty')).toBeVisible();
    expect(await page.evaluate(() => window.__annotations['loose:r.md'])).toBeUndefined();
    // The prose itself is untouched — only the <mark> wrapper goes away.
    expect(await page.evaluate(() => document.getElementById('noteContent').textContent))
      .toContain('Lorem ipsum dolor sit amet.');
  });

  test('the Note button opens the modal and stores the note with the highlight', async ({ page }) => {
    await bootWithAnnotations(page);
    await injectNote(page, HL_NOTE);

    await selectInNote(page, 'lazy dog');
    await page.click('#hlNoteBtn');
    await expect(page.locator('#modalOverlay')).toHaveClass(/open/);
    await page.fill('#noteField', 'Ask about this image');
    await page.click('#noteSaveBtn');

    await expect(page.locator('#modalOverlay')).not.toHaveClass(/open/);
    await expect(page.locator('#noteContent mark.user-hl')).toHaveCount(1);
    await expect(page.locator('#noteList .note-row .n-text')).toHaveText('Ask about this image');
    expect(await page.evaluate(() => window.__annotations['loose:r.md'][0].note)).toBe('Ask about this image');
  });

  // T10 BUG-2: the note modal can outlive its document — a keyboard shortcut fires while
  // it is open, loadAnnotations() re-points _annotationsKey at the new note, and the save
  // must NOT land in the new document's annotations.
  test('a note modal that outlives its document stores nothing in the new note', async ({ page }) => {
    await bootWithAnnotations(page);
    await injectNote(page, HL_NOTE);

    await selectInNote(page, 'lazy dog');
    await page.click('#hlNoteBtn');
    await expect(page.locator('#modalOverlay')).toHaveClass(/open/);

    // The shortcut's effect: a different document becomes active while the modal sits open
    // (renderFile → loadAnnotations swaps the annotations store to the new docKey).
    await page.evaluate(() => {
      window._appState.files.push({
        name: 'other.md', path: 'other.md', handle: null,
        content: '# Other\n\nDifferent prose entirely.\n', dirty: false,
      });
      window.renderFile(1);
    });
    await expect(page.locator('#propFile')).toHaveText('other.md');

    await page.fill('#noteField', 'meant for r.md');
    await page.click('#noteSaveBtn');
    await expect(page.locator('#modalOverlay')).not.toHaveClass(/open/);

    // The stale selection was discarded: no store entry anywhere, no mark in the new note.
    expect(await page.evaluate(() => Object.keys(window.__annotations))).toEqual([]);
    await expect(page.locator('#noteContent mark.user-hl')).toHaveCount(0);
    await expect(page.locator('#noteList .note-empty')).toBeVisible();
  });

  // T14 (post-review F3): the Highlight branch had no docKey guard — the bar survives a
  // Ctrl+W/O/E file switch whenever the outgoing pane never scrolls (scrollTop already 0
  // fires no scroll event), and clicking it then filed doc A's passage into doc B's store.
  test('a highlight bar that survives a no-scroll switch stores nothing in the new note', async ({ page }) => {
    await bootWithAnnotations(page);
    await injectNote(page, HL_NOTE);

    await selectInNote(page, 'lazy dog');
    await expect(page.locator('#hlBar')).toBeVisible();

    await page.evaluate(() => {
      window._appState.files.push({
        name: 'other.md', path: 'other.md', handle: null,
        content: '# Other\n\nDifferent prose entirely.\n', dirty: false,
      });
      window.renderFile(1);
    });
    await expect(page.locator('#propFile')).toHaveText('other.md');
    await expect(page.locator('#hlBar')).toBeHidden(); // a switch dismisses the bar

    // Even a forced click on the stale selection stores nothing, in either branch.
    await page.evaluate(() => window._addHighlight('highlight'));
    expect(await page.evaluate(() => Object.keys(window.__annotations))).toEqual([]);
    await expect(page.locator('#noteContent mark.user-hl')).toHaveCount(0);
    await expect(page.locator('#noteList .note-empty')).toBeVisible();
  });

  test('a cancelled note stores nothing, and Escape dismisses the bar', async ({ page }) => {
    await bootWithAnnotations(page);
    await injectNote(page, HL_NOTE);

    await selectInNote(page, 'lazy dog');
    await page.click('#hlNoteBtn');
    await page.click('#noteCancelBtn');
    await expect(page.locator('#noteContent mark.user-hl')).toHaveCount(0);
    expect(await page.evaluate(() => window.__annotations['loose:r.md'])).toBeUndefined();

    await selectInNote(page, 'lazy dog');
    await expect(page.locator('#hlBar')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#hlBar')).toBeHidden();
  });

  test('a selection spanning paragraphs offers no bar (single-text-node v1 gate)', async ({ page }) => {
    await bootWithAnnotations(page);
    await injectNote(page, HL_NOTE);
    expect(await selectInNote(page, 'quick brown fox', { acrossParagraphs: true })).toMatchObject({ ok: true });
    await expect(page.locator('#hlBar')).toBeHidden();
    await expect(page.locator('#noteContent mark.user-hl')).toHaveCount(0);
  });

  test('editing the note in Edit mode offers no highlight bar', async ({ page }) => {
    await bootWithAnnotations(page, { viewMode: 'edit' });
    await injectNote(page, HL_NOTE);
    await expect(page.locator('#editorArea')).not.toHaveClass(/reading/);
    expect(await selectInNote(page, 'quick brown fox')).toMatchObject({ ok: true });
    await expect(page.locator('#hlBar')).toBeHidden();
  });
});
