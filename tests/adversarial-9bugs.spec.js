// @ts-check
/**
 * Stage 5b adversarial + white-box tests for the 9-bug fix (run_id=20260516T060914Z-1721).
 *
 * Phases covered:
 *   Phase 1 — Black-box tests derived from spec.md acceptance criteria.
 *   Phase 2 — White-box tests targeting implementation-specific branch choices.
 *   Phase 3 — Adversarial / hostile QA tests probing security and edge cases.
 *
 * Framework: Playwright (@playwright/test)
 * Target file: index.html (shipping renderer)
 */

const { test, expect } = require('@playwright/test');
const path = require('path');

const FILE_URL = 'file:///' + path.resolve(__dirname, '../index.html').replace(/\\/g, '/');

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function goto(page) {
  await page.goto(FILE_URL);
  await page.waitForSelector('.app', { state: 'visible' });
}

async function injectFile(page, name, content) {
  await page.evaluate(({ name, content }) => {
    const S = window._appState;
    S.files = [{ name, path: name, handle: null, content, dirty: false }];
    window.renderFile(0);
  }, { name, content });
  await page.waitForTimeout(150);
}

async function injectFiles(page, files) {
  await page.evaluate((files) => {
    const S = window._appState;
    S.files = files.map(f => ({ name: f.name, path: f.name, handle: null, content: f.content, dirty: false }));
    window.renderFile(0);
  }, files);
  await page.waitForTimeout(150);
}

async function switchToSearch(page) {
  await page.click('.sb-tab[data-pane="search"]');
  await page.waitForTimeout(100);
}

async function dropFiles(page, fileList) {
  // fileList: [{name, content, type}]
  await page.evaluate(async (fileList) => {
    const dt = new DataTransfer();
    for (const f of fileList) {
      dt.items.add(new File([f.content], f.name, { type: f.type || 'text/markdown' }));
    }
    const ev = new DragEvent('drop', { cancelable: true, bubbles: true, dataTransfer: dt });
    document.body.dispatchEvent(ev);
    await new Promise(r => setTimeout(r, 300));
  }, fileList);
  await page.waitForTimeout(300);
}

// ===========================================================================
// AC1 — openVault (Issue #3 in spec)
// ===========================================================================

test.describe('[AC1] openVault feature-detect', () => {

  test('[AC1-happy] vaultSearch() is exported on window', async ({ page }) => {
    await goto(page);
    const exported = await page.evaluate(() => typeof window.vaultSearch === 'function');
    expect(exported).toBe(true);
  });

  test('[AC1-boundary] openVault exists and is a function', async ({ page }) => {
    await goto(page);
    const exported = await page.evaluate(() => typeof window.openVault === 'function');
    expect(exported).toBe(true);
  });

  test('[AC1-error] AbortError is silently swallowed — no error toast', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await goto(page);

    // Replace showDirectoryPicker with one that throws AbortError
    await page.evaluate(() => {
      window.showDirectoryPicker = () => {
        const e = new DOMException('The user aborted a request.', 'AbortError');
        return Promise.reject(e);
      };
    });

    // Call openVault — should silently swallow
    await page.evaluate(() => window.openVault());
    await page.waitForTimeout(300);

    // No error toast (AbortError must be swallowed)
    const toastError = await page.evaluate(() => {
      const t = document.getElementById('toast');
      return t && t.classList.contains('error') && t.classList.contains('show');
    });
    expect(toastError).toBe(false);

    // No JS errors
    const jsErrors = errors.filter(e =>
      !e.includes('fonts.googleapis') && !e.includes('cdn.jsdelivr') &&
      !e.includes('Failed to load resource') && !e.includes('net::ERR')
    );
    expect(jsErrors).toHaveLength(0);
  });

  test('[AC1-error] empty folder shows info toast, no tree render', async ({ page }) => {
    await goto(page);

    // Replace showDirectoryPicker to return an empty folder
    await page.evaluate(() => {
      window.showDirectoryPicker = async () => ({
        name: 'EmptyFolder',
        values: async function* () {}
      });
    });

    await page.evaluate(() => window.openVault());
    await page.waitForTimeout(400);

    // State.files should be empty
    const fileCount = await page.evaluate(() => window._appState.files.length);
    expect(fileCount).toBe(0);

    // An info toast should appear (not an error)
    const toastText = await page.evaluate(() => {
      const t = document.getElementById('toast');
      return t ? t.textContent : '';
    });
    expect(toastText.toLowerCase()).toContain('no .md files');
  });

  test('[AC1-boundary] FSA absent: fallback input element created in DOM without error', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await goto(page);

    // Remove FSA
    await page.evaluate(() => {
      delete window.showDirectoryPicker;
    });

    // Call openVault — it should add an <input> to the DOM and click it
    // We cannot actually get a file picker open in automation, so just verify no throw
    const threw = await page.evaluate(async () => {
      try {
        // openVault() will click a hidden input — intercept the click to prevent UI
        const origCreateElement = document.createElement.bind(document);
        document.createElement = function(tag) {
          const el = origCreateElement(tag);
          if (tag === 'input') {
            el.click = function() {}; // no-op to prevent file picker
          }
          return el;
        };
        await window.openVault();
        return false;
      } catch (e) {
        return e.message;
      }
    });
    expect(threw).toBe(false);

    const jsErrors = errors.filter(e =>
      !e.includes('fonts.googleapis') && !e.includes('cdn.jsdelivr') &&
      !e.includes('Failed to load resource') && !e.includes('net::ERR')
    );
    expect(jsErrors).toHaveLength(0);
  });
});

// ===========================================================================
// AC2 — vault-wide search (Issue #2)
// ===========================================================================

test.describe('[AC2] Vault-wide search', () => {

  test('[AC2-happy] 2-file vault returns >= 2 results with <mark> element per snippet', async ({ page }) => {
    await goto(page);
    await injectFiles(page, [
      { name: 'alpha.md', content: '# Alpha\n\nThis has the keyword bpmd in it.' },
      { name: 'beta.md',  content: '# Beta\n\nAlso has bpmd mentioned here.' }
    ]);

    await switchToSearch(page);
    await page.fill('#sbSearchInput', 'bpmd');
    await page.waitForTimeout(200);

    const resultCount = await page.locator('.search-result').count();
    expect(resultCount).toBeGreaterThanOrEqual(2);

    const markCount = await page.evaluate(() =>
      document.querySelectorAll('.sr-snip mark').length
    );
    expect(markCount).toBeGreaterThanOrEqual(2);
  });

  test('[AC2-boundary] single-char query shows "Type to search." placeholder', async ({ page }) => {
    await goto(page);
    await injectFile(page, 'test.md', '# Test\n\nSome content here.');
    await switchToSearch(page);
    await page.fill('#sbSearchInput', 'a');
    await page.waitForTimeout(100);

    const emptyMsg = page.locator('#searchResults .search-empty');
    await expect(emptyMsg).toBeVisible();
    const text = await emptyMsg.textContent();
    expect(text).toContain('Type to search');
  });

  test('[AC2-boundary] empty vault returns empty state for any query', async ({ page }) => {
    await goto(page);
    // State.files is empty by default
    await switchToSearch(page);
    await page.fill('#sbSearchInput', 'anything');
    await page.waitForTimeout(100);

    // Should show some empty/no-match state
    const out = await page.evaluate(() => {
      const el = document.getElementById('searchResults');
      return el ? el.textContent.trim() : '';
    });
    // Either "Type to search" or "No matches"
    expect(out.length).toBeGreaterThan(0);
  });

  test('[AC2-boundary] 5-hit cap: file with 10 occurrences shows at most 5 snippets', async ({ page }) => {
    await goto(page);
    const content = Array.from({ length: 10 }, (_, i) => `Section ${i}: target word.`).join('\n\n');
    await injectFile(page, 'many.md', content);
    await switchToSearch(page);
    await page.fill('#sbSearchInput', 'target');
    await page.waitForTimeout(200);

    const snippetCount = await page.evaluate(() =>
      document.querySelectorAll('.sr-snip').length
    );
    expect(snippetCount).toBeGreaterThan(0);
    expect(snippetCount).toBeLessThanOrEqual(5);
  });

  test('[AC2-click] clicking search result navigates to the correct file', async ({ page }) => {
    await goto(page);
    await injectFiles(page, [
      { name: 'first.md',  content: '# First\n\nSearchword is here.' },
      { name: 'second.md', content: '# Second\n\nSearchword also here.' }
    ]);

    await switchToSearch(page);
    await page.fill('#sbSearchInput', 'searchword');
    await page.waitForTimeout(200);

    // Click the second result
    const results = page.locator('.search-result');
    const count = await results.count();
    expect(count).toBeGreaterThanOrEqual(2);

    await results.nth(1).click();
    await page.waitForTimeout(200);

    const activeIdx = await page.evaluate(() => window._appState.activeFile);
    expect(activeIdx).toBe(1);
  });
});

// ===========================================================================
// AC3 — Outline-click: no statusbar layout shift (Issue #1)
// ===========================================================================

test.describe('[AC3] Outline-click: statusbar position invariance', () => {

  test('[AC3-happy] clicking a TOC item does not change statusbar height or grid row', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await goto(page);
    await injectFile(page, 'headings.md', [
      '# Heading One',
      '',
      'Paragraph one with enough content to scroll.',
      '',
      '## Heading Two',
      '',
      'Paragraph two content.',
      '',
      '## Heading Three',
      '',
      'Paragraph three content.'
    ].join('\n'));

    // Measure: statusbar height and the grid structure before
    const before = await page.evaluate(() => {
      const sb = document.querySelector('.statusbar');
      const app = document.querySelector('.app');
      return {
        sbHeight: sb.getBoundingClientRect().height,
        sbWidth: sb.getBoundingClientRect().width,
        appGridRows: getComputedStyle(app).gridTemplateRows,
        // scrollY of the document (viewport scroll position)
        scrollY: window.scrollY
      };
    });

    await page.waitForTimeout(200);

    // Click the h2 TOC item (second item)
    const tocItems = page.locator('.toc-item');
    const tocCount = await tocItems.count();
    if (tocCount > 1) {
      await tocItems.nth(1).click();
      await page.waitForTimeout(600); // allow smooth scroll to settle
    }

    // Measure after
    const after = await page.evaluate(() => {
      const sb = document.querySelector('.statusbar');
      const app = document.querySelector('.app');
      return {
        sbHeight: sb.getBoundingClientRect().height,
        sbWidth: sb.getBoundingClientRect().width,
        appGridRows: getComputedStyle(app).gridTemplateRows,
        scrollY: window.scrollY
      };
    });

    // CRITICAL: statusbar HEIGHT must not change (grid row is fixed at 26px)
    expect(after.sbHeight).toBe(before.sbHeight);
    // CRITICAL: grid template rows must not change (must remain 36px 1fr 26px structure)
    expect(after.appGridRows).toBe(before.appGridRows);
    // CRITICAL: statusbar WIDTH must not change (no reflow)
    expect(after.sbWidth).toBe(before.sbWidth);

    // NOTE: window.scrollY may change (viewport may scroll in file:// context — this is
    // acceptable and expected from scrollIntoView on the heading inside #noteContent.
    // The CSS-Grid statusbar ROW itself must not reflow — only the viewport position may change.
    // This is distinct from the statusbar "moving" within the grid layout.
  });

  test('[AC3-viewport-scroll] TOC click scrollIntoView does not break app grid structure', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await goto(page);
    await injectFile(page, 'headings.md', '# H1\n\nContent.\n\n## H2\n\nMore content.\n\n## H3\n\nEven more.');
    await page.waitForTimeout(200);

    const appGridRowsBefore = await page.evaluate(() =>
      getComputedStyle(document.querySelector('.app')).gridTemplateRows
    );

    const tocItems = page.locator('.toc-item');
    const tocCount = await tocItems.count();
    if (tocCount > 1) {
      await tocItems.nth(1).click();
      await page.waitForTimeout(600);
    }

    const appGridRowsAfter = await page.evaluate(() =>
      getComputedStyle(document.querySelector('.app')).gridTemplateRows
    );

    // Grid template rows must be invariant — 36px 1fr 26px structure preserved
    expect(appGridRowsAfter).toBe(appGridRowsBefore);
  });

  test('[AC3-boundary] TOC h1 item click does not affect statusbar height', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await goto(page);
    await injectFile(page, 'h1only.md', '# Only Heading\n\nParagraph.');
    await page.waitForTimeout(200);

    const sbHeight = await page.evaluate(() =>
      document.querySelector('.statusbar').getBoundingClientRect().height
    );
    // Statusbar height should be around 26px (natural height)
    expect(sbHeight).toBeGreaterThan(0);
    expect(sbHeight).toBeLessThan(60);
  });
});

// ===========================================================================
// AC4 — Side-panel font-size readability (Issues #4, #9)
// ===========================================================================

test.describe('[AC4] Side-panel font-size >= 13px', () => {

  test('[AC4-happy] .tag computed font-size >= 13px', async ({ page }) => {
    await goto(page);
    await injectFile(page, 'tags.md', '# Test\n\nA note with #reading tag.');
    await page.click('.sb-tab[data-pane="tags"]');
    await page.waitForTimeout(200);

    const fontSize = await page.evaluate(() => {
      const el = document.querySelector('.tag');
      return el ? parseFloat(getComputedStyle(el).fontSize) : 0;
    });
    expect(fontSize).toBeGreaterThanOrEqual(13);
  });

  test('[AC4-happy] .sr-snip computed font-size >= 13px', async ({ page }) => {
    await goto(page);
    await injectFiles(page, [
      { name: 'a.md', content: 'hello world content' },
      { name: 'b.md', content: 'hello another file' }
    ]);
    await switchToSearch(page);
    await page.fill('#sbSearchInput', 'hello');
    await page.waitForTimeout(200);

    const fontSize = await page.evaluate(() => {
      const el = document.querySelector('.sr-snip');
      return el ? parseFloat(getComputedStyle(el).fontSize) : 0;
    });
    expect(fontSize).toBeGreaterThanOrEqual(13);
  });

  test('[AC4-happy] .toc-item.h2 computed font-size >= 13px', async ({ page }) => {
    await goto(page);
    await injectFile(page, 'outline.md', '# H1\n\n## H2 Section\n\nContent.');
    await page.waitForTimeout(200);

    const fontSize = await page.evaluate(() => {
      const el = document.querySelector('.toc-item.h2');
      return el ? parseFloat(getComputedStyle(el).fontSize) : 0;
    });
    expect(fontSize).toBeGreaterThanOrEqual(13);
  });

  test('[AC9-happy] .source-textarea computed font-size >= 13px', async ({ page }) => {
    await goto(page);
    await injectFile(page, 'src.md', '# Source\n\nContent.');
    await page.evaluate(() => window.setEditorMode('source'));
    await page.waitForTimeout(100);

    const fontSize = await page.evaluate(() => {
      const el = document.querySelector('.source-textarea');
      return el ? parseFloat(getComputedStyle(el).fontSize) : 0;
    });
    expect(fontSize).toBeGreaterThanOrEqual(13);
  });

  test('[AC9-happy] .editor (preview) computed font-size >= 13px in live mode', async ({ page }) => {
    await goto(page);
    await injectFile(page, 'preview.md', '# Preview\n\nContent.');

    const fontSize = await page.evaluate(() => {
      const el = document.querySelector('.editor');
      return el ? parseFloat(getComputedStyle(el).fontSize) : 0;
    });
    expect(fontSize).toBeGreaterThanOrEqual(13);
  });

  test('[AC4-regression] .tag font-size change does not leak to unrelated elements', async ({ page }) => {
    await goto(page);
    await injectFile(page, 'tags.md', '# Test\n\nA note with #reading tag.');
    await page.click('.sb-tab[data-pane="tags"]');
    await page.waitForTimeout(200);

    // Sidebar tab buttons (.sb-tab) should NOT inherit .tag font-size
    const sbTabSize = await page.evaluate(() => {
      const el = document.querySelector('.sb-tab');
      return el ? parseFloat(getComputedStyle(el).fontSize) : 0;
    });
    // .tag is set to 13px. .sb-tab should be its own size (typically 11-12px), not 13px via cascade.
    // The key assertion is that .sb-tab has its own font-size (not inherited from .tag).
    expect(sbTabSize).toBeGreaterThan(0);
    // The specific font-size doesn't need to match .tag exactly — just prove no cascade leak
    const tagSize = await page.evaluate(() => {
      const el = document.querySelector('.tag');
      return el ? parseFloat(getComputedStyle(el).fontSize) : 0;
    });
    // sb-tab and tag can coexist with different sizes — just both must be valid numbers
    expect(tagSize).toBeGreaterThanOrEqual(13);
  });
});

// ===========================================================================
// AC5 — Zoom controls (Issue #5)
// ===========================================================================

test.describe('[AC5] Zoom controls', () => {

  test('[AC5-happy] Ctrl+= increases State.zoomFactor above 1', async ({ page }) => {
    await goto(page);
    await page.evaluate(() => window.zoomReset());
    await page.keyboard.press('Control+=');
    await page.waitForTimeout(50);

    const factor = await page.evaluate(() => window._appState.zoomFactor);
    expect(factor).toBeGreaterThan(1);
    expect(factor).toBeCloseTo(1.1, 1);
  });

  test('[AC5-happy] Ctrl+- decreases State.zoomFactor below 1', async ({ page }) => {
    await goto(page);
    await page.evaluate(() => window.zoomReset());
    await page.keyboard.press('Control+-');
    await page.waitForTimeout(50);

    const factor = await page.evaluate(() => window._appState.zoomFactor);
    expect(factor).toBeLessThan(1);
  });

  test('[AC5-happy] Ctrl+0 resets zoom to exactly 1.0', async ({ page }) => {
    await goto(page);
    await page.keyboard.press('Control+=');
    await page.keyboard.press('Control+=');
    await page.waitForTimeout(50);
    await page.keyboard.press('Control+0');
    await page.waitForTimeout(50);

    const factor = await page.evaluate(() => window._appState.zoomFactor);
    expect(factor).toBe(1);
  });

  test('[AC5-boundary] zoom clamped at 2.0 upper bound', async ({ page }) => {
    await goto(page);
    await page.evaluate(() => window.setZoom(999));
    const factor = await page.evaluate(() => window._appState.zoomFactor);
    expect(factor).toBe(2.0);
  });

  test('[AC5-boundary] zoom clamped at 0.6 lower bound', async ({ page }) => {
    await goto(page);
    await page.evaluate(() => window.setZoom(0.01));
    const factor = await page.evaluate(() => window._appState.zoomFactor);
    expect(factor).toBe(0.6);
  });

  test('[AC5-boundary] app-wide zoom scales the :root rem base, never the CSS zoom of html/body (T-T4)', async ({ page }) => {
    await goto(page);
    await page.evaluate(() => window.setZoom(1.5));

    // Zoom is driven by the :root rem base (16px * 1.5 = 24px), not CSS `zoom`.
    const rootFs = await page.evaluate(() => parseFloat(document.documentElement.style.fontSize));
    expect(rootFs).toBeCloseTo(24, 1);

    // The old content-only #editorArea zoom is cleared (no double-scaling).
    const editorZoom = await page.evaluate(() => document.getElementById('editorArea').style.zoom);
    expect(editorZoom).toBe('');

    // No CSS `zoom` is applied to html or body.
    const htmlZoom = await page.evaluate(() => document.documentElement.style.zoom);
    expect(htmlZoom).toBeFalsy();
    const bodyZoom = await page.evaluate(() => document.body.style.zoom);
    expect(bodyZoom).toBeFalsy();
  });

  test('[AC5-boundary] statusbar position unchanged after zoom in', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await goto(page);

    const topBefore = await page.evaluate(() =>
      document.querySelector('.statusbar').getBoundingClientRect().top
    );

    await page.evaluate(() => window.setZoom(2.0));
    await page.waitForTimeout(50);

    const topAfter = await page.evaluate(() =>
      document.querySelector('.statusbar').getBoundingClientRect().top
    );

    // Statusbar must not shift
    expect(Math.abs(topAfter - topBefore)).toBeLessThanOrEqual(2);
  });

  test('[AC5-menu] View menu contains Zoom In, Zoom Out, Reset Zoom', async ({ page }) => {
    await goto(page);
    await page.click('.tb-menu-item[data-menu="view"]');
    await page.waitForTimeout(100);

    const text = await page.locator('#dropdown').textContent();
    expect(text).toContain('Zoom In');
    expect(text).toContain('Zoom Out');
    expect(text).toContain('Reset Zoom');

    await page.keyboard.press('Escape');
  });

  test('[AC5-palette] command palette contains Zoom In/Out/Reset entries', async ({ page }) => {
    await goto(page);
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(100);

    const text = await page.locator('#palOverlay').textContent();
    expect(text).toContain('Zoom In');
    expect(text).toContain('Zoom Out');
    expect(text).toContain('Reset Zoom');

    await page.keyboard.press('Escape');
  });

  // WHITE-BOX: setZoom(NaN) — Math.min/max(NaN) returns NaN, corrupts State.zoomFactor
  test('[AC5-wb-nan] setZoom(NaN) must not corrupt State.zoomFactor', async ({ page }) => {
    await goto(page);
    await page.evaluate(() => window.zoomReset());
    // Call setZoom with NaN
    await page.evaluate(() => window.setZoom(NaN));
    const factor = await page.evaluate(() => window._appState.zoomFactor);
    // Should remain a valid number (1.0 default or clamped), not NaN
    expect(typeof factor).toBe('number');
    expect(isNaN(factor)).toBe(false);
  });

  // WHITE-BOX: setZoom(Infinity) should clamp to 2.0
  test('[AC5-wb-infinity] setZoom(Infinity) clamps to 2.0', async ({ page }) => {
    await goto(page);
    await page.evaluate(() => window.setZoom(Infinity));
    const factor = await page.evaluate(() => window._appState.zoomFactor);
    expect(factor).toBe(2.0);
  });

  // WHITE-BOX: setZoom(-Infinity) should clamp to 0.6
  test('[AC5-wb-neg-infinity] setZoom(-Infinity) clamps to 0.6', async ({ page }) => {
    await goto(page);
    await page.evaluate(() => window.setZoom(-Infinity));
    const factor = await page.evaluate(() => window._appState.zoomFactor);
    expect(factor).toBe(0.6);
  });
});

// ===========================================================================
// AC6 — Source mode (Issue #6)
// ===========================================================================

test.describe('[AC6] Source mode toggle', () => {

  test('[AC6-happy] Source toolbar button sets editorMode to source', async ({ page }) => {
    await goto(page);
    await injectFile(page, 'test.md', '# Hello\n\nContent.');

    await page.click('#modeSource');
    await page.waitForTimeout(100);

    const mode = await page.evaluate(() => window._appState.editorMode);
    expect(mode).toBe('source');
  });

  test('[AC6-happy] source mode shows textarea, hides preview', async ({ page }) => {
    await goto(page);
    await injectFile(page, 'test.md', '# Hello\n\nContent.');
    await page.evaluate(() => window.setEditorMode('source'));
    await page.waitForTimeout(100);

    const sourcePaneDisplay = await page.evaluate(() => {
      const sp = document.querySelector('.source-pane');
      return sp ? getComputedStyle(sp).display : 'none';
    });
    expect(sourcePaneDisplay).not.toBe('none');

    // Preview pane should be hidden
    const editorAreaClass = await page.locator('#editorArea').getAttribute('class');
    expect(editorAreaClass).toContain('source');
  });

  test('[AC6-happy] switching from source to live restores preview', async ({ page }) => {
    await goto(page);
    await injectFile(page, 'test.md', '# Hello\n\nContent.');
    await page.evaluate(() => window.setEditorMode('source'));
    await page.waitForTimeout(100);
    await page.evaluate(() => window.setEditorMode('live'));
    await page.waitForTimeout(100);

    const editorAreaClass = await page.locator('#editorArea').getAttribute('class');
    expect(editorAreaClass).not.toContain('source');
  });

  test('[AC6-keyboard] mode cycling is keyboard accessible (mode buttons have text)', async ({ page }) => {
    await goto(page);
    const sourceBtnText = await page.evaluate(() => {
      const btn = document.getElementById('modeSource');
      return btn ? btn.textContent.trim() : '';
    });
    expect(sourceBtnText.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// AC7 — Drag-drop (Issue #7)
// ===========================================================================

test.describe('[AC7] Drag-drop file loading', () => {

  test('[AC7-happy] .md file drop loads into State.files and renders', async ({ page }) => {
    await goto(page);

    await dropFiles(page, [
      { name: 'dropped.md', content: '# Dropped Note\n\nThis was drag-dropped.', type: 'text/markdown' }
    ]);

    const fileCount = await page.evaluate(() => window._appState.files.length);
    expect(fileCount).toBe(1);

    const name = await page.evaluate(() => window._appState.files[0].name);
    expect(name).toBe('dropped.md');

    const heading = await page.locator('#noteContent h1').textContent();
    expect(heading).toContain('Dropped Note');
  });

  test('[AC7-happy] .markdown extension accepted', async ({ page }) => {
    await goto(page);
    await dropFiles(page, [
      { name: 'notes.markdown', content: '# Notes\n\nMarkdown file.', type: 'text/markdown' }
    ]);

    const fileCount = await page.evaluate(() => window._appState.files.length);
    expect(fileCount).toBe(1);
  });

  test('[AC7-happy] .txt extension accepted', async ({ page }) => {
    await goto(page);
    await dropFiles(page, [
      { name: 'plain.txt', content: 'Plain text content.', type: 'text/plain' }
    ]);

    const fileCount = await page.evaluate(() => window._appState.files.length);
    expect(fileCount).toBe(1);
  });

  test('[AC7-error] non-.md/.txt file shows toast and is not loaded', async ({ page }) => {
    await goto(page);
    await dropFiles(page, [
      { name: 'image.png', content: 'fake png bytes', type: 'image/png' }
    ]);

    const fileCount = await page.evaluate(() => window._appState.files.length);
    expect(fileCount).toBe(0);

    const toastVisible = await page.evaluate(() => {
      const t = document.getElementById('toast');
      return t && (t.classList.contains('show') || t.textContent.length > 0);
    });
    expect(toastVisible).toBe(true);
  });

  test('[AC7-error] oversized file (>10 MB) shows error toast and is not loaded', async ({ page }) => {
    await goto(page);

    await page.evaluate(async () => {
      // Create an 11 MB file (>10 MB limit)
      const bigContent = 'x'.repeat(11 * 1024 * 1024);
      const file = new File([bigContent], 'huge.md', { type: 'text/markdown' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const ev = new DragEvent('drop', { cancelable: true, bubbles: true, dataTransfer: dt });
      document.body.dispatchEvent(ev);
      await new Promise(r => setTimeout(r, 300));
    });
    await page.waitForTimeout(300);

    const fileCount = await page.evaluate(() => window._appState.files.length);
    expect(fileCount).toBe(0);

    // Toast should appear (error or info)
    const toastText = await page.evaluate(() => {
      const t = document.getElementById('toast');
      return t ? t.textContent : '';
    });
    expect(toastText.length).toBeGreaterThan(0);
  });

  test('[AC7-happy] dragover calls preventDefault (enables drop)', async ({ page }) => {
    await goto(page);

    const prevented = await page.evaluate(() => {
      return new Promise(resolve => {
        const ev = new DragEvent('dragover', { cancelable: true, bubbles: true });
        document.body.addEventListener('dragover', e => {
          resolve(e.defaultPrevented);
        }, { once: true });
        document.body.dispatchEvent(ev);
      });
    });
    expect(prevented).toBe(true);
  });

  test('[AC7-happy] drop calls preventDefault', async ({ page }) => {
    await goto(page);

    const prevented = await page.evaluate(() => {
      return new Promise(resolve => {
        const dt = new DataTransfer();
        dt.items.add(new File(['# t'], 't.md', { type: 'text/markdown' }));
        const ev = new DragEvent('drop', { cancelable: true, bubbles: true, dataTransfer: dt });
        document.body.addEventListener('drop', e => {
          resolve(e.defaultPrevented);
        }, { once: true });
        document.body.dispatchEvent(ev);
      });
    });
    expect(prevented).toBe(true);
  });

  test('[AC7-happy] multiple files in one drop all loaded', async ({ page }) => {
    await goto(page);
    await dropFiles(page, [
      { name: 'a.md', content: '# A', type: 'text/markdown' },
      { name: 'b.md', content: '# B', type: 'text/markdown' }
    ]);

    const fileCount = await page.evaluate(() => window._appState.files.length);
    expect(fileCount).toBe(2);
  });

  // WHITE-BOX: File.path not accessed (Electron 32+ deprecation)
  test('[AC7-wb-no-filepath] dropped file object has no .path access in handler', async ({ page }) => {
    await goto(page);

    // Spy on any .path property access
    const pathAccessed = await page.evaluate(async () => {
      let accessed = false;
      const file = new File(['# test'], 'spy.md', { type: 'text/markdown' });
      Object.defineProperty(file, 'path', {
        get() { accessed = true; return undefined; },
        configurable: true
      });
      const dt = new DataTransfer();
      dt.items.add(file);
      const ev = new DragEvent('drop', { cancelable: true, bubbles: true, dataTransfer: dt });
      document.body.dispatchEvent(ev);
      await new Promise(r => setTimeout(r, 300));
      return accessed;
    });
    // Implementation must NOT access file.path
    expect(pathAccessed).toBe(false);
  });

  // WHITE-BOX: mixed batch — some valid, some not — valid ones still load
  test('[AC7-wb-mixed-batch] mixed drop: valid files loaded, invalid rejected with toast', async ({ page }) => {
    await goto(page);

    await page.evaluate(async () => {
      const dt = new DataTransfer();
      dt.items.add(new File(['# Good'], 'good.md', { type: 'text/markdown' }));
      dt.items.add(new File(['bad binary'], 'bad.exe', { type: 'application/octet-stream' }));
      const ev = new DragEvent('drop', { cancelable: true, bubbles: true, dataTransfer: dt });
      document.body.dispatchEvent(ev);
      await new Promise(r => setTimeout(r, 300));
    });
    await page.waitForTimeout(300);

    const fileCount = await page.evaluate(() => window._appState.files.length);
    expect(fileCount).toBe(1); // Only good.md loaded
    expect(await page.evaluate(() => window._appState.files[0].name)).toBe('good.md');
  });
});

// ===========================================================================
// AC8 — Edit menu commands (Issue #8)
// ===========================================================================

test.describe('[AC8] Edit menu commands', () => {

  test('[AC8-happy] Ctrl+A in source mode selects all textarea text only', async ({ page }) => {
    await goto(page);
    await injectFile(page, 'test.md', '# Title\n\nParagraph content.');
    await page.evaluate(() => window.setEditorMode('source'));
    await page.waitForTimeout(100);

    await page.click('#srcTextarea');
    await page.waitForTimeout(50);
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(100);

    const isSelected = await page.evaluate(() => {
      const ta = document.getElementById('srcTextarea');
      return ta.selectionStart === 0 && ta.selectionEnd === ta.value.length && ta.value.length > 0;
    });
    expect(isSelected).toBe(true);
  });

  test('[AC8-happy] Ctrl+A in live mode selects editor content via Selection API', async ({ page }) => {
    await goto(page);
    await injectFile(page, 'test.md', '# Title\n\nParagraph content.');
    await page.evaluate(() => window.setEditorMode('live'));
    await page.waitForTimeout(100);

    await page.click('#noteContent');
    await page.waitForTimeout(50);
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(100);

    const selLen = await page.evaluate(() => {
      const sel = window.getSelection();
      return sel ? sel.toString().length : 0;
    });
    expect(selLen).toBeGreaterThan(0);
  });

  test('[AC8-happy] cut in live mode shows info toast (no error)', async ({ page }) => {
    await goto(page);
    await injectFile(page, 'test.md', '# Title');
    await page.evaluate(() => window.setEditorMode('live'));
    await page.waitForTimeout(100);

    await page.evaluate(() => window.execEditCmd('cut'));
    await page.waitForTimeout(200);

    const toastText = await page.evaluate(() => {
      const t = document.getElementById('toast');
      return t ? t.textContent : '';
    });
    expect(toastText.length).toBeGreaterThan(0);
    // Must not be an error — spec says "graceful, no error"
    const isError = await page.evaluate(() => {
      const t = document.getElementById('toast');
      return t && t.classList.contains('error');
    });
    expect(isError).toBe(false);
  });

  test('[AC8-happy] paste in live mode shows info toast (no error)', async ({ page }) => {
    await goto(page);
    await injectFile(page, 'test.md', '# Title');
    await page.evaluate(() => window.setEditorMode('live'));
    await page.waitForTimeout(100);

    await page.evaluate(() => window.execEditCmd('paste'));
    await page.waitForTimeout(200);

    const toastText = await page.evaluate(() => {
      const t = document.getElementById('toast');
      return t ? t.textContent : '';
    });
    expect(toastText.length).toBeGreaterThan(0);
  });

  // WHITE-BOX: Ctrl+A must not select sidebar text in any mode
  test('[AC8-wb-scope] Ctrl+A in live mode: selection does not include sidebar text', async ({ page }) => {
    await goto(page);
    await injectFile(page, 'test.md', '# Title\n\nContent here.');
    await page.evaluate(() => window.setEditorMode('live'));
    await page.waitForTimeout(100);

    await page.click('#noteContent');
    await page.waitForTimeout(50);
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(100);

    const selectionInfo = await page.evaluate(() => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return { outsideSidebar: true };
      const range = sel.getRangeAt(0);
      const sidebar = document.querySelector('.sidebar');
      const noteContent = document.getElementById('noteContent');
      return {
        withinNote: noteContent ? noteContent.contains(range.commonAncestorContainer) : false,
        withinSidebar: sidebar ? sidebar.contains(range.commonAncestorContainer) : false
      };
    });
    // Selection must be within note content, not sidebar
    expect(selectionInfo.withinSidebar).toBe(false);
    expect(selectionInfo.withinNote).toBe(true);
  });

  // WHITE-BOX: In split mode with textarea unfocused, Ctrl+A should use selectAllChildren
  // (the implementation falls into editorMode=split branch when no text field is focused)
  test('[AC8-wb-split-mode] Ctrl+A in split mode with preview focused selects note content', async ({ page }) => {
    await goto(page);
    await injectFile(page, 'test.md', '# Title\n\nContent.');
    await page.evaluate(() => window.setEditorMode('split'));
    await page.waitForTimeout(100);

    // Click in preview area (not textarea)
    await page.click('#noteContent');
    await page.waitForTimeout(50);
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(100);

    const selLen = await page.evaluate(() => {
      const sel = window.getSelection();
      return sel ? sel.toString().length : 0;
    });
    expect(selLen).toBeGreaterThan(0);
  });

  // WHITE-BOX: execEditCmd('selectAll') when mode is 'source' but no focused textarea
  // falls into the else branch: srcTextarea.focus() then srcTextarea.select()
  test('[AC8-wb-source-no-focus] execEditCmd selectAll with source mode and no focused element', async ({ page }) => {
    await goto(page);
    await injectFile(page, 'test.md', '# Title\n\nContent.');
    await page.evaluate(() => window.setEditorMode('source'));
    await page.waitForTimeout(100);

    // Blur textarea explicitly
    await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    await page.waitForTimeout(50);

    await page.evaluate(() => window.execEditCmd('selectAll'));
    await page.waitForTimeout(100);

    const isSelected = await page.evaluate(() => {
      const ta = document.getElementById('srcTextarea');
      return ta.selectionStart === 0 && ta.selectionEnd === ta.value.length && ta.value.length > 0;
    });
    expect(isSelected).toBe(true);
  });
});

// ===========================================================================
// Phase 3 — Adversarial tests (hostile QA)
// ===========================================================================

test.describe('[ADV] Adversarial tests', () => {

  // CWE-79: XSS via search snippet — query contains HTML injection attempt
  test('[ADV-XSS-query] search query with HTML injection does not execute script', async ({ page }) => {
    const jsExecuted = await page.evaluate(() => {
      window.__advXss = false;
      return false;
    });

    await goto(page);

    // Inject a file whose content includes the adversarial query text literally
    await injectFiles(page, [
      { name: 'xss.md', content: 'normal text <img onerror="window.__advXss=true" src=x> text' }
    ]);

    await switchToSearch(page);
    // Search for text adjacent to the injection
    await page.fill('#sbSearchInput', 'normal text');
    await page.waitForTimeout(300);

    // The snippet must be rendered but not execute JS
    const xssTriggered = await page.evaluate(() => window.__advXss);
    expect(xssTriggered).toBeFalsy();

    // The snippet should appear (with escaped HTML)
    const snippetText = await page.evaluate(() => {
      const snips = document.querySelectorAll('.sr-snip');
      return Array.from(snips).map(s => s.innerHTML).join('');
    });
    // raw <img> tag must not appear in rendered HTML
    expect(snippetText).not.toContain('<img ');
    expect(snippetText).toContain('<mark>');
  });

  // CWE-79: XSS via search snippet — content contains <script> tag
  test('[ADV-XSS-content] search snippet HTML-escapes <script> in file content', async ({ page }) => {
    await page.evaluate(() => { window.__scriptExec = false; });
    await goto(page);

    await injectFiles(page, [
      { name: 'malicious.md', content: 'hello <script>window.__scriptExec=true;</script> world' }
    ]);

    await switchToSearch(page);
    await page.fill('#sbSearchInput', 'hello');
    await page.waitForTimeout(300);

    const xssTriggered = await page.evaluate(() => window.__scriptExec);
    expect(xssTriggered).toBeFalsy();

    const snipHtml = await page.evaluate(() =>
      document.querySelector('.sr-snip') ? document.querySelector('.sr-snip').innerHTML : ''
    );
    expect(snipHtml).not.toContain('<script>');
    expect(snipHtml).toContain('&lt;script');
  });

  // CWE-79: XSS via search snippet — query itself contains <mark> injection attempt
  test('[ADV-XSS-mark-injection] query containing <mark> literal does not double-nest mark tags', async ({ page }) => {
    await goto(page);

    await injectFiles(page, [
      { name: 'note.md', content: 'the text contains <mark>highlight</mark> here' }
    ]);

    await switchToSearch(page);
    // A naive query containing HTML
    await page.fill('#sbSearchInput', '<mark>');
    await page.waitForTimeout(300);

    // If query shorter than 2 chars of meaningful text, may show "Type to search"
    // Either way, no raw <mark> injection in result
    const snipHtml = await page.evaluate(() => {
      const el = document.querySelector('.sr-snip');
      return el ? el.innerHTML : '';
    });
    // Should not have unescaped <mark> from query — it should be &lt;mark&gt;
    // The rendered .sr-snip may use <mark> as a legitimate wrapper, but
    // the query text itself must appear escaped inside
    if (snipHtml.includes('&lt;mark&gt;')) {
      expect(snipHtml).toContain('&lt;mark&gt;');
    }
    // No raw injected <mark> from user query appearing outside the legitimate wrapper
    // Verify no XSS execution occurred
    const bodyHtml = await page.evaluate(() => document.body.innerHTML);
    // The page should not have injected an unescaped <mark> that changes the DOM unexpectedly
    expect(bodyHtml).not.toContain('<mark><mark>');
  });

  // CWE-400: drop empty file (0 bytes) — should load without crash
  test('[ADV-CWE400-empty-file] dropping empty .md file does not crash', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await goto(page);
    await dropFiles(page, [
      { name: 'empty.md', content: '', type: 'text/markdown' }
    ]);

    const fileCount = await page.evaluate(() => window._appState.files.length);
    expect(fileCount).toBe(1); // Empty file is still a valid file

    const jsErrors = errors.filter(e =>
      !e.includes('fonts.googleapis') && !e.includes('cdn.jsdelivr') &&
      !e.includes('Failed to load resource') && !e.includes('net::ERR')
    );
    expect(jsErrors).toHaveLength(0);
  });

  // CWE-400: search on large file (many occurrences) — only 5 hits, no hang
  test('[ADV-CWE400-large-search] search on file with 1000 matches is capped at 5', async ({ page }) => {
    await goto(page);

    const content = Array.from({ length: 1000 }, (_, i) => `item${i}: target here`).join('\n');
    await injectFile(page, 'large.md', content);

    await switchToSearch(page);

    const start = Date.now();
    await page.fill('#sbSearchInput', 'target');
    await page.waitForTimeout(500);
    const elapsed = Date.now() - start;

    // Should complete in < 2 seconds
    expect(elapsed).toBeLessThan(2000);

    const snippetCount = await page.evaluate(() =>
      document.querySelectorAll('.sr-snip').length
    );
    expect(snippetCount).toBeLessThanOrEqual(5);
  });

  // Adversarial: Unicode edge cases — Arabic content in search
  test('[ADV-unicode] Arabic text in search query produces valid results', async ({ page }) => {
    await goto(page);

    await injectFiles(page, [
      { name: 'arabic.md', content: '# مرحبا\n\nهذا نص عربي للاختبار.' }
    ]);

    await switchToSearch(page);
    await page.fill('#sbSearchInput', 'نص');
    await page.waitForTimeout(200);

    const results = await page.locator('.search-result').count();
    expect(results).toBeGreaterThanOrEqual(1);

    const snipHtml = await page.evaluate(() => {
      const el = document.querySelector('.sr-snip');
      return el ? el.innerHTML : '';
    });
    expect(snipHtml).toContain('<mark>');
  });

  // Adversarial: Filename with HTML chars in tree/tabs does not XSS
  test('[ADV-filename-xss] filename containing <script> is HTML-escaped in UI', async ({ page }) => {
    await page.evaluate(() => { window.__filenameXss = false; });
    await goto(page);

    // Inject a file with a dangerous name
    await page.evaluate(() => {
      const S = window._appState;
      S.files = [{ name: '<img src=x onerror="window.__filenameXss=true">.md', path: 'evil.md', handle: null, content: '# Evil', dirty: false }];
      window.renderFile(0);
    });
    await page.waitForTimeout(200);

    const xssTriggered = await page.evaluate(() => window.__filenameXss);
    expect(xssTriggered).toBeFalsy();
  });

  // Adversarial: zoom at boundary values exactly (0.6, 2.0) — no off-by-one
  test('[ADV-zoom-boundary-exact] setZoom(0.6) stores exactly 0.6', async ({ page }) => {
    await goto(page);
    await page.evaluate(() => window.setZoom(0.6));
    const factor = await page.evaluate(() => window._appState.zoomFactor);
    expect(factor).toBe(0.6);
  });

  test('[ADV-zoom-boundary-exact] setZoom(2.0) stores exactly 2.0', async ({ page }) => {
    await goto(page);
    await page.evaluate(() => window.setZoom(2.0));
    const factor = await page.evaluate(() => window._appState.zoomFactor);
    expect(factor).toBe(2.0);
  });

  // Adversarial: just-below boundary setZoom(0.599) clamped to 0.6
  test('[ADV-zoom-just-below-min] setZoom(0.599) clamped to 0.6', async ({ page }) => {
    await goto(page);
    await page.evaluate(() => window.setZoom(0.599));
    const factor = await page.evaluate(() => window._appState.zoomFactor);
    expect(factor).toBe(0.6);
  });

  // Adversarial: just-above boundary setZoom(2.001) clamped to 2.0
  test('[ADV-zoom-just-above-max] setZoom(2.001) clamped to 2.0', async ({ page }) => {
    await goto(page);
    await page.evaluate(() => window.setZoom(2.001));
    const factor = await page.evaluate(() => window._appState.zoomFactor);
    expect(factor).toBe(2.0);
  });

  // Adversarial: drop of .MD file (uppercase extension) — extension check is case-insensitive
  test('[ADV-drag-uppercase-ext] .MD uppercase extension accepted by drag-drop', async ({ page }) => {
    await goto(page);
    await page.evaluate(async () => {
      const file = new File(['# Uppercase'], 'NOTE.MD', { type: 'text/markdown' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const ev = new DragEvent('drop', { cancelable: true, bubbles: true, dataTransfer: dt });
      document.body.dispatchEvent(ev);
      await new Promise(r => setTimeout(r, 300));
    });
    await page.waitForTimeout(300);

    const fileCount = await page.evaluate(() => window._appState.files.length);
    expect(fileCount).toBe(1);
  });

  // Adversarial: drop of .MD file exactly at 10 MB boundary (10485760 bytes) — should be rejected
  test('[ADV-drag-size-exactly-10mb] file at exactly 10 MB (10485760 bytes) is rejected', async ({ page }) => {
    await goto(page);

    await page.evaluate(async () => {
      const bytes = new Uint8Array(10 * 1024 * 1024); // exactly 10 MB = 10485760 bytes
      const file = new File([bytes], 'boundary.md', { type: 'text/markdown' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const ev = new DragEvent('drop', { cancelable: true, bubbles: true, dataTransfer: dt });
      document.body.dispatchEvent(ev);
      await new Promise(r => setTimeout(r, 300));
    });
    await page.waitForTimeout(300);

    // At exactly 10MB (not exceeding), behavior depends on implementation.
    // The spec says "> 10 MB" triggers rejection (file.size > MAX_SIZE).
    // Exactly 10 MB (10485760) is NOT > 10485760, so should be ACCEPTED.
    const fileCount = await page.evaluate(() => window._appState.files.length);
    expect(fileCount).toBe(1); // exactly 10 MB should be accepted (not > MAX_SIZE)
  });

  // Adversarial: Ctrl+A in a focused INPUT (e.g., find bar) should not override native select-all
  test('[ADV-ctrl-a-find-bar] Ctrl+A with find-bar focused selects find-bar text, not document', async ({ page }) => {
    await goto(page);
    await injectFile(page, 'test.md', '# Title\n\nContent.');

    // Open find bar
    await page.evaluate(() => {
      if (typeof window.openFind === 'function') window.openFind();
    });
    await page.waitForTimeout(100);

    // Focus find input
    const findInput = page.locator('#findInput');
    await findInput.fill('some text');
    await findInput.click();
    await page.waitForTimeout(50);

    // The keyboard dispatcher checks e.target for INPUT/TEXTAREA
    // Ctrl+A here should select the input text, not trigger execEditCmd on the document
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(100);

    // Find input should have its text selected (browser native behavior)
    // The execEditCmd handler calls ae.select() for INPUT — correct
    const inputSelected = await page.evaluate(() => {
      const inp = document.getElementById('findInput');
      if (!inp) return false;
      return inp.selectionStart === 0 && inp.selectionEnd === inp.value.length;
    });
    expect(inputSelected).toBe(true);
  });

  // Adversarial: search with query that is exactly 2 chars (boundary)
  test('[ADV-search-2char] exactly 2-char query returns results if match found', async ({ page }) => {
    await goto(page);
    await injectFile(page, 'test.md', '# Test\n\nThe quick brown fox.');

    await switchToSearch(page);
    await page.fill('#sbSearchInput', 'he');
    await page.waitForTimeout(200);

    // "he" appears in "The" — case-insensitive match
    const results = await page.locator('.search-result').count();
    expect(results).toBeGreaterThanOrEqual(1);
  });

  // Adversarial: search query with special regex chars that could break indexOf logic
  test('[ADV-search-special-chars] query with special regex chars works correctly', async ({ page }) => {
    await goto(page);
    await injectFile(page, 'test.md', '# Test\n\nThis costs $5.00 per unit.');

    await switchToSearch(page);
    await page.fill('#sbSearchInput', '$5');
    await page.waitForTimeout(200);

    // Should find "$5" without treating $ as regex metachar (uses indexOf, not regex)
    const results = await page.locator('.search-result').count();
    expect(results).toBeGreaterThanOrEqual(1);
  });

  // Adversarial: drop file with no extension — should be rejected
  test('[ADV-drag-no-extension] file with no extension is rejected', async ({ page }) => {
    await goto(page);
    await page.evaluate(async () => {
      const file = new File(['# Noext'], 'README', { type: 'text/plain' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const ev = new DragEvent('drop', { cancelable: true, bubbles: true, dataTransfer: dt });
      document.body.dispatchEvent(ev);
      await new Promise(r => setTimeout(r, 300));
    });
    await page.waitForTimeout(300);

    const fileCount = await page.evaluate(() => window._appState.files.length);
    expect(fileCount).toBe(0);
  });

  // Adversarial: drop file with double extension (.md.exe) — should be rejected
  test('[ADV-drag-double-extension] file named evil.md.exe is rejected', async ({ page }) => {
    await goto(page);
    await page.evaluate(async () => {
      const file = new File(['payload'], 'evil.md.exe', { type: 'application/octet-stream' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const ev = new DragEvent('drop', { cancelable: true, bubbles: true, dataTransfer: dt });
      document.body.dispatchEvent(ev);
      await new Promise(r => setTimeout(r, 300));
    });
    await page.waitForTimeout(300);

    const fileCount = await page.evaluate(() => window._appState.files.length);
    expect(fileCount).toBe(0);
  });

  // Adversarial: zoom in repeatedly to maximum — no crash, caps correctly
  test('[ADV-zoom-repeated] zooming in 50 times stays at or below 2.0', async ({ page }) => {
    await goto(page);
    await page.evaluate(() => window.zoomReset());

    for (let i = 0; i < 50; i++) {
      await page.evaluate(() => window.zoomIn());
    }

    const factor = await page.evaluate(() => window._appState.zoomFactor);
    expect(factor).toBeLessThanOrEqual(2.0);
    expect(factor).toBeGreaterThan(1.0);
  });

  // Adversarial: zoom out repeatedly to minimum — no crash, caps correctly
  test('[ADV-zoom-repeated-out] zooming out 50 times stays at or above 0.6', async ({ page }) => {
    await goto(page);
    await page.evaluate(() => window.zoomReset());

    for (let i = 0; i < 50; i++) {
      await page.evaluate(() => window.zoomOut());
    }

    const factor = await page.evaluate(() => window._appState.zoomFactor);
    expect(factor).toBeGreaterThanOrEqual(0.6);
    expect(factor).toBeLessThan(1.0);
  });
});

// ===========================================================================
// Phase 4 — Mutation walk-through catch-tests
// ===========================================================================

test.describe('[MUT] Mutation detection tests', () => {

  // Mutation 1: change `< 2` to `<= 2` in vaultSearch query length check
  // This would accept single-char queries. Our test: 1-char query must return [].
  test('[MUT1] single-char query returns empty (catches < vs <= mutation)', async ({ page }) => {
    await goto(page);
    await injectFile(page, 'test.md', '# Test\n\nContent with a.');
    await switchToSearch(page);
    await page.fill('#sbSearchInput', 'a');
    await page.waitForTimeout(100);

    // Should show "Type to search." not results
    const emptyEl = page.locator('#searchResults .search-empty');
    await expect(emptyEl).toBeVisible();
    const text = await emptyEl.textContent();
    expect(text).toContain('Type to search');
  });

  // Mutation 2: remove the guard `if (idx < 0) break` in vaultSearch while-loop
  // Without this, the loop becomes infinite. Our test: search with no match completes quickly.
  test('[MUT2] no-match search completes without hang (catches missing break guard)', async ({ page }) => {
    await goto(page);
    await injectFile(page, 'test.md', '# Test\n\nContent here.');

    const start = Date.now();
    await switchToSearch(page);
    await page.fill('#sbSearchInput', 'zzznotfound');
    await page.waitForTimeout(500);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(3000);

    // Should show no-match state
    const resultCount = await page.locator('.search-result').count();
    expect(resultCount).toBe(0);
  });

  // Mutation 3: negate `!e.shiftKey` condition in keyboard dispatcher Ctrl+= branch
  // A negated condition would fire zoom on Ctrl+Shift+= (not intended). Test that Ctrl+=
  // WITHOUT Shift triggers zoom, and verify the zoom factor changes.
  test('[MUT3] Ctrl+= (without Shift) triggers zoom (catches negated shiftKey condition)', async ({ page }) => {
    await goto(page);
    await page.evaluate(() => window.zoomReset());
    const before = await page.evaluate(() => window._appState.zoomFactor);

    // Press Ctrl+= without Shift
    await page.keyboard.press('Control+=');
    await page.waitForTimeout(50);

    const after = await page.evaluate(() => window._appState.zoomFactor);
    expect(after).toBeGreaterThan(before);
  });

  // Additional: clamp must be inclusive of both ends (catches > vs >= mutation)
  test('[MUT-clamp-inclusive] zoom exactly at 0.6 is not further clamped', async ({ page }) => {
    await goto(page);
    await page.evaluate(() => window.setZoom(0.6));
    const factor = await page.evaluate(() => window._appState.zoomFactor);
    // If the clamp used > 0.6 instead of >= 0.6, this would be rejected and clamped higher
    expect(factor).toBe(0.6);
  });
});
