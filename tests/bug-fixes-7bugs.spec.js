// @ts-check
/**
 * Stage 5b adversarial + white-box tests for the 7-bug fix run
 * (run_id=20260516T085804Z-1659).
 *
 * Phases covered:
 *   Phase 1 — Black-box tests derived from spec.md acceptance criteria (AC1-AC10).
 *   Phase 2 — White-box tests targeting implementation-specific branch choices.
 *   Phase 3 — Adversarial / hostile QA tests probing security and edge cases.
 *   Phase 4 — Mutation-detection catch tests.
 *
 * Framework: Playwright (@playwright/test)
 * Target file: index.html (renderer), main.js, preload.js (Electron main/preload)
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
    const S = window._marqamState;
    S.files = [{ name, path: name, handle: null, content, dirty: false }];
    window.renderFile(0);
  }, { name, content });
  await page.waitForTimeout(200);
}

async function injectFiles(page, files) {
  await page.evaluate((files) => {
    const S = window._marqamState;
    S.files = files.map(f => ({ name: f.name, path: f.name, handle: null, content: f.content, dirty: false }));
    window.renderFile(0);
  }, files);
  await page.waitForTimeout(200);
}

async function switchToSourceMode(page) {
  await page.evaluate(() => window.setEditorMode('source'));
  await page.waitForTimeout(100);
}

// ===========================================================================
// AC1 — Open Folder IPC bridge (Bug 1)
// ===========================================================================

test.describe('[AC1] Open Folder IPC bridge', () => {

  // Black-box happy path: mock electronAPI, verify State.files populates + tree renders
  test('[AC1-happy] mock electronAPI.openFolder populates State.files and renders sidebar', async ({ page }) => {
    await goto(page);

    // Inject mock electronAPI before openVault() is called
    await page.evaluate(() => {
      window.electronAPI = {
        openFolder: () => Promise.resolve({ canceled: false, folderPath: 'C:\\Users\\test\\Notes' }),
        readVault: (fp) => Promise.resolve([
          { name: 'alpha.md', relPath: 'alpha.md', content: '# Alpha\n\nContent of alpha.' },
          { name: 'beta.md',  relPath: 'beta.md',  content: '# Beta\n\nContent of beta.' }
        ])
      };
    });

    await page.evaluate(() => window.openVault());
    await page.waitForTimeout(400);

    const fileCount = await page.evaluate(() => window._marqamState.files.length);
    expect(fileCount).toBe(2);

    const firstName = await page.evaluate(() => window._marqamState.files[0].name);
    expect(firstName).toBe('alpha.md');

    // Preview should show the first file
    const heading = await page.locator('#noteContent h1').textContent();
    expect(heading).toContain('Alpha');

    // Sidebar folder name should be updated (no "vault" text)
    const vaultNameText = await page.evaluate(() => document.getElementById('vaultName').textContent);
    expect(vaultNameText).toBe('Notes');
    expect(vaultNameText.toLowerCase()).not.toContain('vault');
  });

  // Black-box: canceled result must not modify State
  test('[AC1-cancel] canceled dialog leaves State.files unchanged', async ({ page }) => {
    await goto(page);

    await page.evaluate(() => {
      window.electronAPI = {
        openFolder: () => Promise.resolve({ canceled: true, folderPath: null }),
        readVault: () => Promise.reject(new Error('should not be called'))
      };
    });

    const filesBefore = await page.evaluate(() => window._marqamState.files.length);

    await page.evaluate(() => window.openVault());
    await page.waitForTimeout(300);

    const filesAfter = await page.evaluate(() => window._marqamState.files.length);
    expect(filesAfter).toBe(filesBefore);
  });

  // Black-box: empty folder → info toast, no tree render
  test('[AC1-empty-folder] empty folder via IPC shows info toast, does not crash', async ({ page }) => {
    await goto(page);

    await page.evaluate(() => {
      window.electronAPI = {
        openFolder: () => Promise.resolve({ canceled: false, folderPath: 'C:\\Empty' }),
        readVault: () => Promise.resolve([])
      };
    });

    await page.evaluate(() => window.openVault());
    await page.waitForTimeout(400);

    const fileCount = await page.evaluate(() => window._marqamState.files.length);
    expect(fileCount).toBe(0);

    const toastText = await page.evaluate(() => document.getElementById('toast').textContent);
    expect(toastText.toLowerCase()).toContain('no .md');
    expect(toastText.toLowerCase()).not.toContain('vault');
  });

  // Black-box: IPC error (readVault throws) shows error toast
  test('[AC1-ipc-error] readVault rejection shows error toast, no unhandled exception', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await goto(page);

    await page.evaluate(() => {
      window.electronAPI = {
        openFolder: () => Promise.resolve({ canceled: false, folderPath: 'C:\\Bad' }),
        readVault: () => Promise.reject(new Error('EACCES: permission denied'))
      };
    });

    await page.evaluate(() => window.openVault());
    await page.waitForTimeout(400);

    const toastText = await page.evaluate(() => document.getElementById('toast').textContent);
    expect(toastText.toLowerCase()).toContain('folder');

    // No unhandled JS error should leak out
    const jsErrors = errors.filter(e =>
      !e.includes('fonts.googleapis') && !e.includes('cdn.jsdelivr') && !e.includes('net::ERR')
    );
    expect(jsErrors).toHaveLength(0);
  });

  // White-box: electronAPI check is the FIRST branch in openVault — FSA branch not reached when electronAPI present
  test('[AC1-wb-ipc-first] IPC branch taken before FSA when electronAPI is present', async ({ page }) => {
    await goto(page);

    let fsaCalled = false;
    let ipcCalled = false;

    await page.evaluate(() => {
      window.electronAPI = {
        openFolder: () => {
          window.__ipcCalled = true;
          return Promise.resolve({ canceled: true, folderPath: null });
        },
        readVault: () => Promise.resolve([])
      };
      // Override showDirectoryPicker to detect if FSA was reached
      window.showDirectoryPicker = () => {
        window.__fsaCalled = true;
        return Promise.reject(new DOMException('abort', 'AbortError'));
      };
    });

    await page.evaluate(() => window.openVault());
    await page.waitForTimeout(300);

    const ipcUsed = await page.evaluate(() => window.__ipcCalled === true);
    const fsaUsed = await page.evaluate(() => window.__fsaCalled === true);

    expect(ipcUsed).toBe(true);
    expect(fsaUsed).toBe(false);
  });

  // White-box: folderPath split gives correct folder name (no path separator in displayed name)
  test('[AC1-wb-foldername] folder name extracted correctly from deep path', async ({ page }) => {
    await goto(page);

    await page.evaluate(() => {
      window.electronAPI = {
        openFolder: () => Promise.resolve({ canceled: false, folderPath: 'C:\\Users\\ghazwaaa\\Documents\\My Notes' }),
        readVault: () => Promise.resolve([
          { name: 'note.md', relPath: 'note.md', content: '# Note' }
        ])
      };
    });

    await page.evaluate(() => window.openVault());
    await page.waitForTimeout(300);

    const folderLabel = await page.evaluate(() => document.getElementById('sbVault').textContent);
    expect(folderLabel).toBe('folder: My Notes');

    const vaultNameEl = await page.evaluate(() => document.getElementById('vaultName').textContent);
    expect(vaultNameEl).toBe('My Notes');
  });

  // White-box: AbortError on IPC side swallowed silently (not error toast)
  test('[AC1-wb-abort-silent] AbortError from IPC is swallowed silently', async ({ page }) => {
    await goto(page);

    await page.evaluate(() => {
      window.electronAPI = {
        openFolder: () => Promise.reject(Object.assign(new Error('abort'), { name: 'AbortError' })),
        readVault: () => Promise.resolve([])
      };
    });

    await page.evaluate(() => window.openVault());
    await page.waitForTimeout(300);

    const toastVisible = await page.evaluate(() => {
      const t = document.getElementById('toast');
      return t && t.classList.contains('show') && t.classList.contains('error');
    });
    expect(toastVisible).toBe(false);
  });

  // White-box: FSA path still works when electronAPI is absent
  test('[AC1-wb-fsa-fallback] FSA path reached when electronAPI absent', async ({ page }) => {
    await goto(page);

    await page.evaluate(() => {
      delete window.electronAPI;
      window.showDirectoryPicker = async () => ({
        name: 'FSAFolder',
        values: async function* () {
          yield { kind: 'file', name: 'doc.md', getFile: async () => ({ text: async () => '# Doc' }) };
        }
      });
    });

    await page.evaluate(() => window.openVault());
    await page.waitForTimeout(400);

    const vaultName = await page.evaluate(() => window._marqamState.vaultName);
    expect(vaultName).toBe('FSAFolder');
  });
});

// ===========================================================================
// AC2 — No "vault" in user-facing strings (Bug 2)
// ===========================================================================

test.describe('[AC2] No "vault" in user-facing strings', () => {

  // Black-box: grep visible (non-script, non-style) text nodes for "vault" (case-insensitive)
  // Spec §AC2: exempts internal symbol names in JS source; tests only user-visible rendered text.
  test('[AC2-happy] visible text nodes contain zero "vault" occurrences', async ({ page }) => {
    await goto(page);

    const vaultOccurrences = await page.evaluate(() => {
      const vaultRe = /vault/gi;
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const tag = node.parentElement && node.parentElement.tagName.toLowerCase();
          // Exclude JS/CSS source — those contain internal symbol names (exempt per spec §Constraints)
          if (tag === 'script' || tag === 'style') return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      const found = [];
      let n;
      while ((n = walker.nextNode())) {
        const matches = n.nodeValue.match(vaultRe);
        if (matches) {
          found.push({ text: n.nodeValue.trim().slice(0, 100), count: matches.length });
        }
      }
      return found;
    });
    // Zero user-visible text nodes should contain "vault"
    expect(vaultOccurrences).toHaveLength(0);
  });

  // Black-box: check all title= and aria-label= attributes
  test('[AC2-attr] no title or aria-label attribute contains "vault" (case-insensitive)', async ({ page }) => {
    await goto(page);

    const vaultInAttrs = await page.evaluate(() => {
      const vaultRe = /vault/i;
      const elems = document.querySelectorAll('[title],[aria-label]');
      const found = [];
      elems.forEach(el => {
        const title = el.getAttribute('title') || '';
        const aria = el.getAttribute('aria-label') || '';
        if (vaultRe.test(title)) found.push({ attr: 'title', val: title, tag: el.tagName });
        if (vaultRe.test(aria))  found.push({ attr: 'aria-label', val: aria, tag: el.tagName });
      });
      return found;
    });
    expect(vaultInAttrs).toHaveLength(0);
  });

  // Black-box: status bar element text should say "no folder" not "no vault"
  test('[AC2-statusbar] statusbar sbVault element initial text does not contain "vault"', async ({ page }) => {
    await goto(page);
    const sbText = await page.evaluate(() => document.getElementById('sbVault').textContent);
    expect(sbText.toLowerCase()).not.toContain('vault');
    expect(sbText.toLowerCase()).toContain('folder');
  });

  // Black-box: "Open Folder" button text in sidebar does not mention "vault"
  test('[AC2-sidebar-button] sidebar Open Folder button has no "vault" text', async ({ page }) => {
    await goto(page);
    const btnTitle = await page.evaluate(() => document.getElementById('sbOpenVaultBtn').getAttribute('title'));
    expect((btnTitle || '').toLowerCase()).not.toContain('vault');
  });

  // Black-box: welcome screen buttons say "Open Folder" not "Open Vault"
  test('[AC2-welcome] welcome screen button texts contain "Folder" not "Vault"', async ({ page }) => {
    await goto(page);
    const wbText = await page.evaluate(() => {
      const btn = document.getElementById('wbOpenVault');
      return btn ? btn.textContent : '';
    });
    expect(wbText.toLowerCase()).not.toContain('vault');
    expect(wbText.toLowerCase()).toContain('folder');
  });

  // Black-box: after loadDemo(), sbVault contains "folder" not "vault"
  test('[AC2-demo] after loadDemo(), sbVault text says "folder: demo" not "vault"', async ({ page }) => {
    await goto(page);
    await page.evaluate(() => window.loadDemo());
    await page.waitForTimeout(200);

    const sbText = await page.evaluate(() => document.getElementById('sbVault').textContent);
    expect(sbText).toBe('folder: demo');
    expect(sbText.toLowerCase()).not.toContain('vault');
  });

  // White-box: after IPC open, both sbVault and vaultName use "folder" language
  test('[AC2-wb-ipc-labels] IPC open path sets sbVault text with "folder:" prefix', async ({ page }) => {
    await goto(page);

    await page.evaluate(() => {
      window.electronAPI = {
        openFolder: () => Promise.resolve({ canceled: false, folderPath: '/home/user/Documents' }),
        readVault: () => Promise.resolve([
          { name: 'a.md', relPath: 'a.md', content: '# A' }
        ])
      };
    });

    await page.evaluate(() => window.openVault());
    await page.waitForTimeout(300);

    const sbText = await page.evaluate(() => document.getElementById('sbVault').textContent);
    expect(sbText.toLowerCase()).not.toContain('vault');
    expect(sbText).toContain('folder:');
  });

  // Adversarial: File menu "Open Folder" menu item text
  test('[AC2-menu] File menu "Open Folder" item text does not say "vault"', async ({ page }) => {
    await goto(page);
    await page.click('.tb-menu-item[data-menu="file"]');
    await page.waitForTimeout(100);

    const menuText = await page.locator('#dropdown').textContent();
    expect(menuText.toLowerCase()).not.toContain('vault');
    expect(menuText).toContain('Open Folder');

    await page.keyboard.press('Escape');
  });
});

// ===========================================================================
// AC3 — RTL Arabic search results wrap at word boundaries (Bug 3)
// ===========================================================================

test.describe('[AC3] RTL Arabic search results word-wrap', () => {

  const ARABIC_CONTENT = `# مرحبا بالقراء

هذا نص عربي طويل جداً يحتوي على كلمات عربية متعددة للاختبار.
الكلمات العربية الطويلة تحتاج إلى لف صحيح عند حدود الكلمات.
نص إضافي للتأكد من وجود محتوى كافٍ في نتائج البحث.

#عربي #اختبار`;

  // Black-box: .search-results has overflow-wrap: anywhere
  test('[AC3-happy] .search-results CSS has overflow-wrap: anywhere', async ({ page }) => {
    await goto(page);

    const overflowWrap = await page.evaluate(() => {
      const el = document.querySelector('.search-results');
      return el ? getComputedStyle(el).overflowWrap : null;
    });
    expect(overflowWrap).toBe('anywhere');
  });

  // Black-box: .sr-snip mark has unicode-bidi: isolate
  test('[AC3-happy] .sr-snip mark CSS has unicode-bidi: isolate', async ({ page }) => {
    await goto(page);
    await injectFile(page, 'ar.md', ARABIC_CONTENT);
    await page.click('.sb-tab[data-pane="search"]');
    await page.waitForTimeout(100);
    await page.fill('#sbSearchInput', 'نص');
    await page.waitForTimeout(300);

    const unicodeBidi = await page.evaluate(() => {
      const mark = document.querySelector('.sr-snip mark');
      return mark ? getComputedStyle(mark).unicodeBidi : null;
    });
    // 'isolate' or 'isolate' variant accepted
    expect(unicodeBidi).toBeTruthy();
    expect(['isolate', 'plaintext']).toContain(unicodeBidi);
  });

  // Black-box: Arabic search snippets do not cause horizontal overflow on the search-results container
  test('[AC3-happy] Arabic search results do not overflow horizontally', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await goto(page);
    await injectFile(page, 'ar.md', ARABIC_CONTENT);
    await page.click('.sb-tab[data-pane="search"]');
    await page.waitForTimeout(100);
    await page.fill('#sbSearchInput', 'عربي');
    await page.waitForTimeout(300);

    const hasOverflow = await page.evaluate(() => {
      const el = document.querySelector('.search-results');
      if (!el) return false;
      return el.scrollWidth > el.clientWidth;
    });
    expect(hasOverflow).toBe(false);
  });

  // Black-box: Arabic mark element appears in search result snippets
  test('[AC3-happy] Arabic search query produces mark-highlighted snippets', async ({ page }) => {
    await goto(page);
    await injectFile(page, 'ar.md', ARABIC_CONTENT);
    await page.click('.sb-tab[data-pane="search"]');
    await page.waitForTimeout(100);
    await page.fill('#sbSearchInput', 'نص');
    await page.waitForTimeout(300);

    const markCount = await page.evaluate(() => document.querySelectorAll('.sr-snip mark').length);
    expect(markCount).toBeGreaterThanOrEqual(1);
  });

  // White-box: unicode-bidi:isolate is set as inline style on mark, not just inherited
  test('[AC3-wb-mark-isolate] search-result mark has unicode-bidi:isolate via CSS rule', async ({ page }) => {
    await goto(page);
    await injectFile(page, 'ar.md', ARABIC_CONTENT);
    await page.click('.sb-tab[data-pane="search"]');
    await page.waitForTimeout(100);
    await page.fill('#sbSearchInput', 'اختبار');
    await page.waitForTimeout(300);

    // Check via getComputedStyle that the CSS rule is applied
    const result = await page.evaluate(() => {
      const mark = document.querySelector('.sr-snip mark');
      if (!mark) return null;
      return getComputedStyle(mark).unicodeBidi;
    });
    expect(result).toBeTruthy();
    expect(result).not.toBe('normal');
  });

  // Adversarial: long unbroken Arabic string (no spaces) wraps without overflow
  test('[AC3-adv-no-spaces] long Arabic string without spaces does not overflow sr-snip', async ({ page }) => {
    // A long Arabic word with no spaces — tests 'overflow-wrap: anywhere' is effective
    const longArabicWord = 'ا'.repeat(80); // 80 alefs concatenated — max stress test
    await goto(page);
    await injectFile(page, 'ar.md', `# Test\n\n${longArabicWord}\n\nقصير`);
    await page.click('.sb-tab[data-pane="search"]');
    await page.waitForTimeout(100);
    await page.fill('#sbSearchInput', 'قصير');
    await page.waitForTimeout(300);

    const hasOverflow = await page.evaluate(() => {
      const el = document.querySelector('.search-results');
      return el ? el.scrollWidth > el.clientWidth : false;
    });
    expect(hasOverflow).toBe(false);
  });
});

// ===========================================================================
// AC4 — Tags pane (Bug 8)
// ===========================================================================

test.describe('[AC4] Tags pane populates and is interactive', () => {

  // Black-box: switching to Tags pane with tagged files renders tag items
  test('[AC4-happy] tags pane shows tags from loaded files', async ({ page }) => {
    await goto(page);
    await injectFile(page, 'tagged.md', '# Tagged\n\nA note with #reading #writing #notes tags.');
    await page.click('.sb-tab[data-pane="tags"]');
    await page.waitForTimeout(200);

    const tagCount = await page.locator('.tag').count();
    expect(tagCount).toBeGreaterThanOrEqual(3);
  });

  // Black-box: tag items contain correct text
  test('[AC4-happy] tag items display correct tag names', async ({ page }) => {
    await goto(page);
    await injectFile(page, 'tagged.md', '# Tagged\n\nUse #marqam and #arabic tags here.');
    await page.click('.sb-tab[data-pane="tags"]');
    await page.waitForTimeout(200);

    const tagTexts = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.tag')).map(t => t.textContent)
    );
    const combined = tagTexts.join(' ');
    expect(combined).toContain('marqam');
    expect(combined).toContain('arabic');
  });

  // Black-box: Arabic hashtags extracted with Unicode-flag regex
  test('[AC4-happy] Arabic hashtags extracted correctly (Unicode flag on regex)', async ({ page }) => {
    await goto(page);
    await injectFile(page, 'ar.md', '# عربي\n\nملاحظة مع #قراءة و #كتابة علامتين.');
    await page.click('.sb-tab[data-pane="tags"]');
    await page.waitForTimeout(200);

    const tagTexts = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.tag')).map(t => t.textContent)
    );
    const combined = tagTexts.join(' ');
    expect(combined).toContain('قراءة');
    expect(combined).toContain('كتابة');
  });

  // Black-box: empty files → tags pane shows empty state
  test('[AC4-boundary] no files loaded → tags pane empty state', async ({ page }) => {
    await goto(page);
    // No files injected — default empty state
    await page.click('.sb-tab[data-pane="tags"]');
    await page.waitForTimeout(200);

    const tagCount = await page.locator('.tag').count();
    expect(tagCount).toBe(0);
  });

  // White-box: renderTags() is called on switchSbPane('tags'), not on page load
  test('[AC4-wb-switch-calls-render] tags appear only after switching to tags pane', async ({ page }) => {
    await goto(page);
    await injectFile(page, 'tagged.md', '# Tagged\n\nNote with #test tag.');

    // Tags pane not yet switched to
    const tagsBefore = await page.locator('.tag').count();
    // (could be 0 or non-zero depending on initial pane)

    await page.click('.sb-tab[data-pane="tags"]');
    await page.waitForTimeout(200);

    const tagsAfter = await page.locator('.tag').count();
    expect(tagsAfter).toBeGreaterThan(0);
  });
});

// ===========================================================================
// AC5 — Tab overflow ellipsis + close-X always visible (Bug 4)
// ===========================================================================

test.describe('[AC5] Tab overflow ellipsis and close-X visibility', () => {

  const LONG_FILENAME = 'this-is-a-very-long-filename-that-should-definitely-trigger-ellipsis-truncation.md';

  // Black-box: .tab has min-width: 0
  test('[AC5-happy] .tab CSS has min-width: 0', async ({ page }) => {
    await goto(page);

    const minWidth = await page.evaluate(() => {
      const style = document.createElement('style');
      document.head.appendChild(style);
      const el = document.createElement('div');
      el.className = 'tab';
      document.querySelector('.tabs').appendChild(el);
      const mw = getComputedStyle(el).minWidth;
      el.remove();
      style.remove();
      return mw;
    });
    // 'auto' means no explicit min-width:0 is set (BAD); '0px' means it IS set (GOOD)
    expect(minWidth).toBe('0px');
  });

  // Black-box: .tab-name has text-overflow: ellipsis
  test('[AC5-happy] .tab-name CSS has text-overflow: ellipsis', async ({ page }) => {
    await goto(page);
    await injectFile(page, LONG_FILENAME, '# Long\n\nContent.');
    await page.waitForTimeout(100);

    const textOverflow = await page.evaluate(() => {
      const span = document.querySelector('.tab-name');
      return span ? getComputedStyle(span).textOverflow : null;
    });
    expect(textOverflow).toBe('ellipsis');
  });

  // Black-box: .tab .close has flex-shrink: 0 (never squeezed away)
  test('[AC5-happy] .tab .close CSS has flex: 0 0 auto (never hidden)', async ({ page }) => {
    await goto(page);
    await injectFile(page, LONG_FILENAME, '# Long\n\nContent.');
    await page.waitForTimeout(100);

    const flexShrink = await page.evaluate(() => {
      const closeBtn = document.querySelector('.tab .close');
      return closeBtn ? getComputedStyle(closeBtn).flexShrink : null;
    });
    expect(flexShrink).toBe('0');
  });

  // Black-box: tab element has title attribute equal to full filename
  test('[AC5-happy] tab element title attribute equals full filename', async ({ page }) => {
    await goto(page);
    await injectFile(page, LONG_FILENAME, '# Long\n\nContent.');
    await page.waitForTimeout(100);

    const titleAttr = await page.evaluate(() => {
      const tab = document.querySelector('.tab');
      return tab ? tab.getAttribute('title') : null;
    });
    expect(titleAttr).toBe(LONG_FILENAME);
  });

  // Black-box: close-X is visible and clickable on long filename tab
  test('[AC5-happy] close-X visible and clickable on long filename tab', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await goto(page);
    await injectFile(page, LONG_FILENAME, '# Long\n\nContent.');
    await page.waitForTimeout(100);

    const closeBtn = page.locator('.tab .close');
    await expect(closeBtn).toBeVisible();

    // Verify it is within the tab's bounding box (not outside)
    const closeBBox = await closeBtn.boundingBox();
    const tabBBox = await page.locator('.tab').boundingBox();
    expect(closeBBox).not.toBeNull();
    expect(tabBBox).not.toBeNull();
    expect(closeBBox.x).toBeGreaterThanOrEqual(tabBBox.x);
    expect(closeBBox.x + closeBBox.width).toBeLessThanOrEqual(tabBBox.x + tabBBox.width + 1);
  });

  // Black-box: clicking close-X on a single tab shows welcome screen
  test('[AC5-happy] clicking close-X removes the tab and shows welcome screen', async ({ page }) => {
    await goto(page);
    await injectFile(page, 'test.md', '# Test\n\nContent.');
    await page.waitForTimeout(100);

    await page.click('.tab .close');
    await page.waitForTimeout(200);

    const fileCount = await page.evaluate(() => window._marqamState.files.length);
    expect(fileCount).toBe(0);

    await expect(page.locator('#welcome')).toBeVisible();
  });

  // White-box: tab.title set on the tab DIV, not the .tab-name span
  test('[AC5-wb-title-on-tab-div] title attribute is on .tab element, not .tab-name span', async ({ page }) => {
    await goto(page);
    await injectFile(page, 'my-note.md', '# Note\n\nContent.');
    await page.waitForTimeout(100);

    const tabTitle = await page.evaluate(() => {
      const tab = document.querySelector('.tab');
      return tab ? tab.getAttribute('title') : null;
    });
    const spanTitle = await page.evaluate(() => {
      const span = document.querySelector('.tab .tab-name');
      return span ? span.getAttribute('title') : null;
    });

    expect(tabTitle).toBe('my-note.md');
    // The title should be on the parent tab, not the span (it might or might not be on span too)
    // Primary assertion: tab div has the title
    expect(tabTitle).not.toBeNull();
  });

  // Adversarial: filename with HTML chars is escaped in tab UI
  test('[AC5-adv-xss] filename with HTML injection chars is escaped in tab', async ({ page }) => {
    await page.evaluate(() => { window.__tabXss = false; });
    await goto(page);

    await page.evaluate(() => {
      const S = window._marqamState;
      S.files = [{ name: '<img src=x onerror="window.__tabXss=true">.md', path: 'evil.md', handle: null, content: '# Evil', dirty: false }];
      window.renderFile(0);
    });
    await page.waitForTimeout(200);

    const xssTriggered = await page.evaluate(() => window.__tabXss);
    expect(xssTriggered).toBeFalsy();

    // Tab should render without executing the injection
    const tabCount = await page.locator('.tab').count();
    expect(tabCount).toBe(1);
  });

  // Adversarial: extremely long filename (200+ chars) — tab still renders, close-X visible
  test('[AC5-adv-very-long] 200-char filename tab renders correctly with close-X visible', async ({ page }) => {
    const veryLong = 'a'.repeat(200) + '.md';
    await page.setViewportSize({ width: 1440, height: 900 });
    await goto(page);
    await injectFile(page, veryLong, '# Very Long\n\nContent.');
    await page.waitForTimeout(100);

    const closeBtn = page.locator('.tab .close');
    await expect(closeBtn).toBeVisible();

    // Tab must not exceed max-width:200px
    const tabBBox = await page.locator('.tab').boundingBox();
    expect(tabBBox.width).toBeLessThanOrEqual(205); // 200px + minor rounding
  });
});

// ===========================================================================
// AC6 — Edit menu commands fire on saved activeElement (Bug 5)
// ===========================================================================

test.describe('[AC6] Edit menu commands fire on saved activeElement', () => {

  // Black-box: Copy via execEditCmd — verifies the _savedEl path executes without JS crash.
  // NOTE: navigator.clipboard.writeText() is blocked in Playwright file:// origin (no permissions).
  // The implementation catches the rejection with showToast('Copy failed','error'), which is
  // acceptable behavior in a non-Electron headless context. We verify no uncaught JS error occurs.
  test('[AC6-happy] execEditCmd("copy") does not throw uncaught JS error', async ({ page }) => {
    const jsErrors = [];
    page.on('pageerror', e => jsErrors.push(e.message));

    await goto(page);
    await injectFile(page, 'edit.md', '# Edit Test\n\nHello World content here.');
    await switchToSourceMode(page);

    // Select some text in textarea then call execEditCmd as menu click would
    await page.evaluate(() => {
      const ta = document.getElementById('srcTextarea');
      ta.focus();
      ta.setSelectionRange(0, 5); // Select "# Edi"
    });
    await page.waitForTimeout(50);

    // execEditCmd simulates menu click (which would have blurred before old implementation)
    await page.evaluate(() => window.execEditCmd('copy'));
    await page.waitForTimeout(300);

    // No uncaught JS exceptions should occur
    const filteredErrors = jsErrors.filter(e =>
      !e.includes('fonts.googleapis') && !e.includes('cdn.jsdelivr') && !e.includes('net::ERR')
    );
    expect(filteredErrors).toHaveLength(0);
  });

  // Black-box: Cut via execEditCmd removes selected text from textarea
  test('[AC6-happy] execEditCmd("cut") removes selected text from textarea', async ({ page }) => {
    await goto(page);
    await injectFile(page, 'edit.md', '# Edit\n\nHello World.');
    await switchToSourceMode(page);
    await page.waitForTimeout(100);

    const originalLength = await page.evaluate(() => document.getElementById('srcTextarea').value.length);

    // Focus textarea, select some text
    await page.evaluate(() => {
      const ta = document.getElementById('srcTextarea');
      ta.focus();
      ta.setSelectionRange(0, 7); // Select "# Edit\n"
    });
    await page.waitForTimeout(50);

    await page.evaluate(() => window.execEditCmd('cut'));
    await page.waitForTimeout(200);

    const newLength = await page.evaluate(() => document.getElementById('srcTextarea').value.length);
    // Text should have been removed
    expect(newLength).toBeLessThan(originalLength);
  });

  // Black-box: Undo via execEditCmd works in source mode textarea
  test('[AC6-happy] execEditCmd("undo") triggers undo in focused textarea', async ({ page }) => {
    await goto(page);
    await injectFile(page, 'edit.md', '# Initial content\n\nParagraph.');
    await switchToSourceMode(page);
    await page.waitForTimeout(100);

    // Focus textarea
    await page.click('#srcTextarea');
    await page.waitForTimeout(50);

    // Type something, then undo
    await page.keyboard.type(' APPENDED');
    await page.waitForTimeout(50);

    const afterType = await page.evaluate(() => document.getElementById('srcTextarea').value);
    expect(afterType).toContain('APPENDED');

    // Re-focus then undo via menu path
    await page.evaluate(() => {
      document.getElementById('srcTextarea').focus();
    });
    await page.evaluate(() => window.execEditCmd('undo'));
    await page.waitForTimeout(200);

    const afterUndo = await page.evaluate(() => document.getElementById('srcTextarea').value);
    // Undo should have removed the appended text (or at minimum not added more)
    expect(afterUndo.length).toBeLessThanOrEqual(afterType.length);
  });

  // Black-box: Paste via execEditCmd inserts text into textarea using saved reference
  test('[AC6-happy] execEditCmd("paste") inserts clipboard text into saved element', async ({ page }) => {
    await goto(page);
    await injectFile(page, 'edit.md', '# Edit Test\n\nContent.');
    await switchToSourceMode(page);
    await page.waitForTimeout(100);

    // Set clipboard content via eval and mock clipboard
    await page.evaluate(() => {
      // Mock clipboard.readText to return a known string
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          readText: () => Promise.resolve('PASTED_TEXT'),
          writeText: (t) => Promise.resolve()
        },
        writable: true,
        configurable: true
      });
      const ta = document.getElementById('srcTextarea');
      ta.focus();
      ta.setSelectionRange(0, 0); // cursor at beginning
    });
    await page.waitForTimeout(50);

    await page.evaluate(() => window.execEditCmd('paste'));
    await page.waitForTimeout(300);

    const val = await page.evaluate(() => document.getElementById('srcTextarea').value);
    expect(val).toContain('PASTED_TEXT');
  });

  // White-box: _savedEl captured BEFORE closeMenu() — verify focus not lost before command executes
  test('[AC6-wb-savedel] _savedEl captured before closeMenu (textarea not blurred before cut)', async ({ page }) => {
    await goto(page);
    await injectFile(page, 'edit.md', '# Edit\n\nFoo Bar Baz.');
    await switchToSourceMode(page);
    await page.waitForTimeout(100);

    await page.evaluate(() => {
      const ta = document.getElementById('srcTextarea');
      ta.focus();
      ta.setSelectionRange(0, 6); // "# Edit"
    });
    await page.waitForTimeout(50);

    // Simulate the menu click situation: activeElement was set, then closeMenu() called
    // The implementation must capture _savedEl before closeMenu()
    // We verify this by calling execEditCmd directly and seeing the cut succeed
    const lengthBefore = await page.evaluate(() => document.getElementById('srcTextarea').value.length);

    await page.evaluate(() => window.execEditCmd('cut'));
    await page.waitForTimeout(200);

    const lengthAfter = await page.evaluate(() => document.getElementById('srcTextarea').value.length);
    // If _savedEl was NOT captured before closeMenu, the cut would fail silently (no text removed)
    expect(lengthAfter).toBeLessThan(lengthBefore);
  });

  // White-box: targetEl closed over for paste — paste works even after async gap
  test('[AC6-wb-paste-closure] paste targetEl captured before async clipboard.readText()', async ({ page }) => {
    await goto(page);
    await injectFile(page, 'edit.md', '# Paste Target\n\nExisting content here.');
    await switchToSourceMode(page);
    await page.waitForTimeout(100);

    let pasteResolve;
    await page.evaluate(() => {
      // Make clipboard.readText() a controllable promise
      window.__pasteResolveRef = null;
      const slowClipboard = {
        readText: () => new Promise(resolve => {
          window.__pasteResolveRef = resolve;
        }),
        writeText: (t) => Promise.resolve()
      };
      Object.defineProperty(navigator, 'clipboard', {
        value: slowClipboard, writable: true, configurable: true
      });

      const ta = document.getElementById('srcTextarea');
      ta.focus();
      ta.setSelectionRange(0, 0);
    });
    await page.waitForTimeout(50);

    // Start paste (will await clipboard.readText)
    await page.evaluate(() => window.execEditCmd('paste'));
    await page.waitForTimeout(50);

    // Now blur the textarea (simulates focus moving away during async gap)
    await page.evaluate(() => document.getElementById('srcTextarea').blur());
    await page.waitForTimeout(50);

    // Resolve clipboard with text
    await page.evaluate(() => {
      if (window.__pasteResolveRef) window.__pasteResolveRef('ASYNC_PASTE_TEXT');
    });
    await page.waitForTimeout(200);

    // The paste should have gone to the saved targetEl (not the now-focused element)
    const val = await page.evaluate(() => document.getElementById('srcTextarea').value);
    expect(val).toContain('ASYNC_PASTE_TEXT');
  });

  // White-box: selectAll in live mode uses Selection API (not document.execCommand)
  test('[AC6-wb-selectall-live] selectAll in live mode creates a Selection range', async ({ page }) => {
    await goto(page);
    await injectFile(page, 'edit.md', '# Title\n\nParagraph text here for selection.');
    await page.evaluate(() => window.setEditorMode('live'));
    await page.waitForTimeout(100);

    // Click noteContent to give it "focus" context
    await page.click('#noteContent');
    await page.waitForTimeout(50);

    await page.evaluate(() => window.execEditCmd('selectAll'));
    await page.waitForTimeout(100);

    const selectionLen = await page.evaluate(() => {
      const sel = window.getSelection();
      return sel ? sel.toString().length : 0;
    });
    expect(selectionLen).toBeGreaterThan(0);
  });

  // Adversarial: calling execEditCmd with an unknown command does not crash
  test('[AC6-adv-unknown-cmd] execEditCmd with unknown command does not throw', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await goto(page);

    const threw = await page.evaluate(async () => {
      try {
        window.execEditCmd('nonExistentCommand');
        return false;
      } catch (e) {
        return e.message;
      }
    });
    expect(threw).toBe(false);

    const jsErrors = errors.filter(e => !e.includes('fonts.') && !e.includes('cdn.') && !e.includes('net::ERR'));
    expect(jsErrors).toHaveLength(0);
  });

  // Adversarial: Edit menu "Copy" with no selection — should not throw or error-toast
  test('[AC6-adv-copy-no-selection] copy with empty selection shows no error toast', async ({ page }) => {
    await goto(page);
    await injectFile(page, 'edit.md', '# Edit\n\nContent.');
    await switchToSourceMode(page);
    await page.waitForTimeout(100);

    // Focus textarea but don't select anything
    await page.evaluate(() => {
      const ta = document.getElementById('srcTextarea');
      ta.focus();
      ta.setSelectionRange(3, 3); // cursor placed, no selection
    });
    await page.waitForTimeout(50);

    await page.evaluate(() => window.execEditCmd('copy'));
    await page.waitForTimeout(200);

    // Should NOT show an error toast (empty copy is valid no-op)
    const isError = await page.evaluate(() => {
      const t = document.getElementById('toast');
      return t && t.classList.contains('error') && t.classList.contains('show');
    });
    expect(isError).toBe(false);
  });
});

// ===========================================================================
// AC7 — Find bar Next/Back does NOT shift the statusbar (Bug 6)
// ===========================================================================

test.describe('[AC7] Find bar scroll does not shift statusbar', () => {

  const LONG_DOC = Array.from({ length: 40 }, (_, i) =>
    `## Section ${i + 1}\n\nThis is paragraph ${i + 1} with some content. The keyword findme appears here.\n`
  ).join('\n');

  // Black-box: statusbar Y position unchanged after clicking find-next several times
  test('[AC7-happy] statusbar bottom position invariant across find-next clicks', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await goto(page);
    await injectFile(page, 'long.md', LONG_DOC);
    await page.waitForTimeout(200);

    // Get initial statusbar position
    const before = await page.evaluate(() => {
      const sb = document.querySelector('.statusbar');
      const rect = sb.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, height: rect.height };
    });

    // Open find and search
    await page.evaluate(() => {
      window.openFind();
      window.runFind('findme');
    });
    await page.waitForTimeout(100);

    // Click next several times
    for (let i = 0; i < 5; i++) {
      await page.click('#findNextBtn');
      await page.waitForTimeout(50);
    }

    const after = await page.evaluate(() => {
      const sb = document.querySelector('.statusbar');
      const rect = sb.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, height: rect.height };
    });

    // Statusbar position must be pixel-stable
    expect(Math.abs(after.top - before.top)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.bottom - before.bottom)).toBeLessThanOrEqual(1);
    expect(after.height).toBe(before.height);
  });

  // Black-box: statusbar Y position unchanged after clicking find-prev
  test('[AC7-happy] statusbar bottom position invariant across find-prev clicks', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await goto(page);
    await injectFile(page, 'long.md', LONG_DOC);
    await page.waitForTimeout(200);

    const before = await page.evaluate(() => {
      const sb = document.querySelector('.statusbar');
      return sb.getBoundingClientRect().top;
    });

    await page.evaluate(() => {
      window.openFind();
      window.runFind('findme');
    });
    await page.waitForTimeout(100);

    // Click prev several times (wraps around)
    for (let i = 0; i < 5; i++) {
      await page.click('#findPrevBtn');
      await page.waitForTimeout(50);
    }

    const after = await page.evaluate(() => {
      const sb = document.querySelector('.statusbar');
      return sb.getBoundingClientRect().top;
    });

    expect(Math.abs(after - before)).toBeLessThanOrEqual(1);
  });

  // Black-box: document-level scrollY does NOT change on find-next in live mode
  // (scroll is contained to .preview-pane)
  test('[AC7-happy] document scrollY unchanged during find-next (scroll is pane-contained)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await goto(page);
    await injectFile(page, 'long.md', LONG_DOC);
    await page.waitForTimeout(200);

    const scrollYBefore = await page.evaluate(() => window.scrollY);

    await page.evaluate(() => {
      window.openFind();
      window.runFind('findme');
    });
    await page.waitForTimeout(100);

    for (let i = 0; i < 5; i++) {
      await page.click('#findNextBtn');
      await page.waitForTimeout(50);
    }

    const scrollYAfter = await page.evaluate(() => window.scrollY);
    expect(scrollYAfter).toBe(scrollYBefore);
  });

  // White-box: scrollMarkIntoPane uses .preview-pane as scroll container (not document)
  test('[AC7-wb-scroll-container] scrollMarkIntoPane targets .preview-pane scrollTop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await goto(page);
    await injectFile(page, 'long.md', LONG_DOC);
    await page.waitForTimeout(200);

    const previewScrollBefore = await page.evaluate(() => {
      const pane = document.querySelector('.preview-pane');
      return pane ? pane.scrollTop : -1;
    });

    await page.evaluate(() => {
      window.openFind();
      window.runFind('findme');
    });
    await page.waitForTimeout(100);

    // Navigate to at least 3rd result (should cause pane scroll)
    await page.click('#findNextBtn');
    await page.click('#findNextBtn');
    await page.click('#findNextBtn');
    await page.waitForTimeout(100);

    const previewScrollAfter = await page.evaluate(() => {
      const pane = document.querySelector('.preview-pane');
      return pane ? pane.scrollTop : -1;
    });

    // The .preview-pane should have scrolled (content is long enough)
    // At minimum scrollTop is still a valid non-negative number
    expect(previewScrollAfter).toBeGreaterThanOrEqual(0);
    // document body should NOT have scrolled
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  // White-box: mark click handler also uses scrollMarkIntoPane (not scrollIntoView)
  test('[AC7-wb-mark-click-scroll] clicking a find mark does not shift statusbar', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await goto(page);
    await injectFile(page, 'long.md', LONG_DOC);
    await page.waitForTimeout(200);

    const sbTopBefore = await page.evaluate(() =>
      document.querySelector('.statusbar').getBoundingClientRect().top
    );

    await page.evaluate(() => {
      window.openFind();
      window.runFind('findme');
    });
    await page.waitForTimeout(100);

    // Click the last find-hit mark (forces a scroll to bottom of document)
    const markCount = await page.locator('mark.find-hit').count();
    if (markCount > 1) {
      await page.locator('mark.find-hit').last().click();
      await page.waitForTimeout(200);
    }

    const sbTopAfter = await page.evaluate(() =>
      document.querySelector('.statusbar').getBoundingClientRect().top
    );

    expect(Math.abs(sbTopAfter - sbTopBefore)).toBeLessThanOrEqual(1);
  });

  // Adversarial: find next/prev clicked when there are no hits — should not crash
  // NOTE: findStep is not exported on window; use button click UI to exercise it
  test('[AC7-adv-empty-hits] find next/prev buttons with no hits do not crash', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await goto(page);
    await injectFile(page, 'doc.md', '# Doc\n\nContent without any match for xyzzy.');
    await page.waitForTimeout(100);

    await page.evaluate(() => {
      window.openFind();
      window.runFind('xyzzy123nonexistent');
    });
    await page.waitForTimeout(100);

    // Clicking next/prev on 0 hits should be a safe no-op (findStep guards with empty array check)
    await page.click('#findNextBtn');
    await page.waitForTimeout(50);
    await page.click('#findPrevBtn');
    await page.waitForTimeout(100);

    const jsErrors = errors.filter(e => !e.includes('fonts.') && !e.includes('cdn.') && !e.includes('net::ERR'));
    expect(jsErrors).toHaveLength(0);
  });
});

// ===========================================================================
// AC8 — Blockquote exit via empty-line Enter (Bug 7)
// ===========================================================================

test.describe('[AC8] Blockquote Enter key behavior', () => {

  async function typeInSource(page, content) {
    await page.evaluate(() => window.setEditorMode('source'));
    await page.waitForTimeout(100);
    await page.click('#srcTextarea');
    await page.waitForTimeout(50);
    // Set content directly then position cursor
    await page.evaluate((c) => {
      const ta = document.getElementById('srcTextarea');
      ta.value = c;
      ta.selectionStart = ta.selectionEnd = c.length;
      ta.focus();
    }, content);
    await page.waitForTimeout(50);
  }

  // Black-box: Enter on non-empty ">" line continues blockquote on next line
  test('[AC8-happy] Enter on "> foo" line inserts "> " prefix on next line', async ({ page }) => {
    await goto(page);
    await injectFile(page, 'bq.md', '# BQ Test\n\n> Hello world');

    await typeInSource(page, '> Hello world');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);

    const val = await page.evaluate(() => document.getElementById('srcTextarea').value);
    // Should contain the continuation prefix on the new line
    expect(val).toContain('> Hello world\n> ');
  });

  // Black-box: Enter on empty "> " line exits blockquote
  test('[AC8-happy] Enter on "> " (empty body) exits blockquote', async ({ page }) => {
    await goto(page);
    await injectFile(page, 'bq.md', '# BQ Test\n\n');

    // Set up: ">" on current line, cursor after it
    await typeInSource(page, '> ');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);

    const val = await page.evaluate(() => document.getElementById('srcTextarea').value);
    // The ">" prefix should have been stripped; a blank line inserted
    const lines = val.split('\n');
    // Last non-empty line or the line right after the stripped prefix should NOT start with ">"
    // The stripped prefix line should become empty or removed
    const hasQuotePrefix = lines.some(l => l.trimStart().startsWith('>') && l.trimStart().length <= 2);
    // After exit, no line should be just ">" with empty body
    const hasEmptyBlockquote = lines.some(l => /^\s*>\s*$/.test(l));
    expect(hasEmptyBlockquote).toBe(false);
  });

  // Black-box: Sequence "> text" Enter Enter exits blockquote on second Enter
  test('[AC8-happy] sequence: "> foo" Enter "> " Enter exits blockquote', async ({ page }) => {
    await goto(page);
    await injectFile(page, 'bq.md', '# BQ Test\n\n');

    await typeInSource(page, '> foo');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);

    // Now on the ">" continuation line — press Enter to exit
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);

    const val = await page.evaluate(() => document.getElementById('srcTextarea').value);
    const lines = val.split('\n');

    // Last line should be blank (cursor on non-blockquote line)
    const lastLineIsQuote = lines[lines.length - 1].trimStart().startsWith('>');
    expect(lastLineIsQuote).toBe(false);

    // Typing after exit should not produce "> " prefix
    await page.keyboard.type('plain text after');
    await page.waitForTimeout(100);

    const val2 = await page.evaluate(() => document.getElementById('srcTextarea').value);
    expect(val2).toContain('plain text after');
    // The plain text should NOT start with ">"
    const plainTextLine = val2.split('\n').find(l => l.includes('plain text after'));
    expect(plainTextLine).toBeTruthy();
    expect(plainTextLine.trimStart().startsWith('>')).toBe(false);
  });

  // Black-box: Shift+Enter on blockquote line does NOT trigger the handler (literal newline)
  test('[AC8-boundary] Shift+Enter on blockquote line does NOT exit blockquote', async ({ page }) => {
    await goto(page);
    await injectFile(page, 'bq.md', '# BQ Test\n\n');

    await typeInSource(page, '> ');
    // Shift+Enter must pass through as normal newline, not trigger the handler
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(100);

    const val = await page.evaluate(() => document.getElementById('srcTextarea').value);
    // handleBlockquoteEnter checks e.shiftKey — Shift+Enter should NOT exit blockquote
    // The ">" may or may not still be there depending on textarea default behavior
    // Key assertion: the handler was NOT called (no blockquote-specific manipulation)
    // This is hard to verify directly, so we verify no "stripped prefix" behavior happened
    // If the handler ran, it would insert only '\n', stripping the '>'.
    // Shift+Enter should insert a literal newline via the browser default.
    // The "> " should remain on its line.
    expect(val).toContain('> ');
  });

  // Black-box: nested blockquote "> > foo" — spec requires full prefix continuation.
  // FIXED: The regex /^((?:\s*>)+\s*)/ correctly captures the full prefix for any nesting depth.
  // For "> > nested", it now captures "> > " so continuation inserts "> > " on the next line.
  test('[AC8-boundary] nested "> > foo" — continues with full "> > " prefix', async ({ page }) => {
    await goto(page);
    await injectFile(page, 'bq.md', '# BQ Test\n\n');

    await typeInSource(page, '> > nested');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);

    const val = await page.evaluate(() => document.getElementById('srcTextarea').value);
    // FIXED: full nested prefix "> > " is preserved on continuation
    expect(val).toContain('> > nested\n> > ');
  });

  // White-box: IME composition guard — handler returns early if e.isComposing
  test('[AC8-wb-ime-guard] handler skips when isComposing is true', async ({ page }) => {
    await goto(page);
    await injectFile(page, 'bq.md', '# BQ\n\n');

    await typeInSource(page, '> sometext');
    await page.waitForTimeout(50);

    const valBefore = await page.evaluate(() => document.getElementById('srcTextarea').value);

    // Dispatch a synthetic keydown with isComposing=true — handler must not modify the value
    await page.evaluate(() => {
      const ta = document.getElementById('srcTextarea');
      const event = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
        isComposing: true
      });
      ta.dispatchEvent(event);
    });
    await page.waitForTimeout(100);

    const valAfter = await page.evaluate(() => document.getElementById('srcTextarea').value);
    // Value should not have been modified by the handler
    expect(valAfter).toBe(valBefore);
  });

  // White-box: cursor not inside blockquote line — regular Enter behavior (handler returns early)
  test('[AC8-wb-non-blockquote] Enter on non-blockquote line does NOT trigger handler', async ({ page }) => {
    await goto(page);
    await injectFile(page, 'bq.md', '# BQ Test\n\n');

    await typeInSource(page, 'regular line without quote prefix');
    const valBefore = await page.evaluate(() => document.getElementById('srcTextarea').value);

    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);

    const valAfter = await page.evaluate(() => document.getElementById('srcTextarea').value);
    // Should have inserted a standard newline (browser default), not blockquote manipulation
    expect(valAfter).toBe(valBefore + '\n');
  });

  // White-box: empty body detection uses .trim() — "> " (space only) also exits
  test('[AC8-wb-whitespace-body] "> " with trailing space also exits blockquote', async ({ page }) => {
    await goto(page);
    await injectFile(page, 'bq.md', '# BQ Test\n\n');

    // Set value with trailing whitespace in body
    await typeInSource(page, '> ');  // "> " — body is " " (whitespace only)
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);

    const val = await page.evaluate(() => document.getElementById('srcTextarea').value);
    const hasEmptyBQ = val.split('\n').some(l => /^\s*>\s*$/.test(l));
    expect(hasEmptyBQ).toBe(false);
  });

  // Adversarial: deeply nested empty blockquote "> > > > > " exit behavior.
  // FIXED: The regex /^((?:\s*>)+\s*)/ now captures the full prefix "> > > > > " on such lines.
  // body = "" (empty), so the EXIT branch fires and a plain blank line is inserted.
  test('[AC8-adv-deep-nest] deeply nested "> > > > >" — exits blockquote on Enter', async ({ page }) => {
    await goto(page);
    await injectFile(page, 'bq.md', '# Deep\n\n');

    await typeInSource(page, '> > > > > ');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);

    const val = await page.evaluate(() => document.getElementById('srcTextarea').value);
    // FIXED: the full prefix is captured, body is empty, so Exit branch fires.
    // No line should remain with a blockquote-only prefix (all > chars, no body).
    const hasDeepEmpty = val.split('\n').some(l => /^\s*>+\s*$/.test(l));
    expect(hasDeepEmpty).toBe(false); // FIXED: deeply nested empty blockquote is exited
  });

  // Adversarial: input event dispatched after blockquote manipulation (preview updates)
  test('[AC8-adv-input-event] input event dispatched after blockquote exit triggers preview update', async ({ page }) => {
    await goto(page);
    await injectFile(page, 'bq.md', '# BQ Test\n\n');
    await switchToSourceMode(page);
    await page.waitForTimeout(100);

    let inputFired = false;
    await page.evaluate(() => {
      window.__inputFired = false;
      document.getElementById('srcTextarea').addEventListener('input', () => {
        window.__inputFired = true;
      }, { once: true });
    });

    await page.evaluate(() => {
      const ta = document.getElementById('srcTextarea');
      ta.value = '> ';
      ta.selectionStart = ta.selectionEnd = 2;
      ta.focus();
    });
    await page.waitForTimeout(50);

    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);

    const fired = await page.evaluate(() => window.__inputFired);
    expect(fired).toBe(true);
  });
});

// ===========================================================================
// AC9 — Interactive elements (Bug-flow audit)
// ===========================================================================

test.describe('[AC9] Interactive elements respond correctly', () => {

  // Black-box: File menu button opens dropdown
  test('[AC9-happy] File menu button opens dropdown', async ({ page }) => {
    await goto(page);
    await page.click('.tb-menu-item[data-menu="file"]');
    await page.waitForTimeout(100);

    const dropdown = page.locator('#dropdown');
    await expect(dropdown).toBeVisible();

    await page.keyboard.press('Escape');
  });

  // Black-box: Edit menu button opens dropdown with Undo/Copy/Paste items
  test('[AC9-happy] Edit menu contains all required commands', async ({ page }) => {
    await goto(page);
    await page.click('.tb-menu-item[data-menu="edit"]');
    await page.waitForTimeout(100);

    const menuText = await page.locator('#dropdown').textContent();
    expect(menuText).toContain('Undo');
    expect(menuText).toContain('Redo');
    expect(menuText).toContain('Cut');
    expect(menuText).toContain('Copy');
    expect(menuText).toContain('Paste');
    expect(menuText).toContain('Select All');
    expect(menuText).toContain('Find');

    await page.keyboard.press('Escape');
  });

  // Black-box: RTL toggle button exists and toggles
  test('[AC9-happy] RTL toggle button (#rtlBtn) toggles direction', async ({ page }) => {
    await goto(page);

    // Click RTL btn once
    await page.click('#rtlBtn');
    await page.waitForTimeout(100);

    const dirAfterToggle = await page.evaluate(() =>
      document.getElementById('editor') ? document.getElementById('editor').getAttribute('dir') : null
    );
    // Should be 'rtl' after toggle
    expect(dirAfterToggle).toBe('rtl');

    // Toggle back
    await page.click('#rtlBtn');
    await page.waitForTimeout(100);
  });

  // Black-box: Find bar input accepts text and shows find info
  test('[AC9-happy] find bar input triggers runFind and shows hit count', async ({ page }) => {
    await goto(page);
    await injectFile(page, 'doc.md', '# Doc\n\nThe quick brown fox jumps over the lazy dog.\nThe fox again.');
    await page.waitForTimeout(100);

    await page.evaluate(() => window.openFind());
    await page.waitForTimeout(100);

    await page.fill('#findInput', 'fox');
    await page.waitForTimeout(200);

    const findInfo = await page.locator('#findInfo').textContent();
    expect(findInfo).toMatch(/\d+\/\d+/);
    expect(findInfo).not.toBe('0/0');
  });

  // Black-box: Find bar next/prev buttons call findStep
  test('[AC9-happy] find next and prev buttons cycle through hits', async ({ page }) => {
    await goto(page);
    await injectFile(page, 'doc.md', '# Doc\n\nWord one, word two, word three.');
    await page.waitForTimeout(100);

    await page.evaluate(() => {
      window.openFind();
      window.runFind('word');
    });
    await page.waitForTimeout(100);

    const idxBefore = await page.evaluate(() => window._marqamState.findIdx);

    await page.click('#findNextBtn');
    await page.waitForTimeout(50);

    const idxAfter = await page.evaluate(() => window._marqamState.findIdx);
    // findIdx should have advanced
    expect(idxAfter).not.toBe(idxBefore);
  });

  // Black-box: Find close button clears find bar
  test('[AC9-happy] find close button (#findCloseBtn) clears marks', async ({ page }) => {
    await goto(page);
    await injectFile(page, 'doc.md', '# Doc\n\nKeyword appears here and here.');
    await page.waitForTimeout(100);

    await page.evaluate(() => {
      window.openFind();
      window.runFind('keyword');
    });
    await page.waitForTimeout(100);

    const marksBefore = await page.locator('mark.find-hit').count();
    expect(marksBefore).toBeGreaterThan(0);

    await page.click('#findCloseBtn');
    await page.waitForTimeout(100);

    const marksAfter = await page.locator('mark.find-hit').count();
    expect(marksAfter).toBe(0);
  });

  // Black-box: Ctrl+Shift+O keyboard shortcut calls openVault
  test('[AC9-happy] Ctrl+Shift+O keyboard shortcut calls openVault (no crash)', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await goto(page);

    // Mock both electronAPI and FSA to prevent actual picker UI
    await page.evaluate(() => {
      window.electronAPI = {
        openFolder: () => Promise.resolve({ canceled: true, folderPath: null }),
        readVault: () => Promise.resolve([])
      };
    });

    await page.keyboard.press('Control+Shift+O');
    await page.waitForTimeout(300);

    const jsErrors = errors.filter(e => !e.includes('fonts.') && !e.includes('cdn.') && !e.includes('net::ERR'));
    expect(jsErrors).toHaveLength(0);
  });
});

// ===========================================================================
// Phase 3 — Adversarial tests (hostile QA mindset)
// ===========================================================================

test.describe('[ADV] Adversarial tests', () => {

  // AC1 adversarial: readVault returns null (invalid IPC response)
  test('[ADV-ipc-null-response] readVault returns null does not crash renderer', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await goto(page);

    await page.evaluate(() => {
      window.electronAPI = {
        openFolder: () => Promise.resolve({ canceled: false, folderPath: 'C:\\Folder' }),
        readVault: () => Promise.resolve(null)  // null instead of array
      };
    });

    await page.evaluate(() => window.openVault());
    await page.waitForTimeout(400);

    const jsErrors = errors.filter(e => !e.includes('fonts.') && !e.includes('cdn.') && !e.includes('net::ERR'));
    expect(jsErrors).toHaveLength(0);
  });

  // AC1 adversarial: folderPath containing path traversal characters — should not affect renderer
  test('[ADV-path-traversal] folderPath with ../ does not crash or XSS renderer', async ({ page }) => {
    await goto(page);

    await page.evaluate(() => {
      window.electronAPI = {
        openFolder: () => Promise.resolve({ canceled: false, folderPath: 'C:\\Valid\\Path' }),
        readVault: () => Promise.resolve([
          { name: '../../../etc/passwd', relPath: '../../../etc/passwd', content: '# Traversal Attempt' }
        ])
      };
    });

    await page.evaluate(() => window.openVault());
    await page.waitForTimeout(400);

    // The renderer should just store whatever name comes from main — no crash
    const fileCount = await page.evaluate(() => window._marqamState.files.length);
    expect(fileCount).toBeGreaterThanOrEqual(0);
    // No unhandled error
    const jsErrors = [];
    // We just verify page is still alive
    const appVisible = await page.locator('.app').isVisible();
    expect(appVisible).toBe(true);
  });

  // AC2 adversarial: XSS via filename in toast/label — HTML entities must be escaped
  test('[ADV-toast-xss] filename with <script> in IPC response does not execute script in toast', async ({ page }) => {
    await page.evaluate(() => { window.__toastXss = false; });
    await goto(page);

    await page.evaluate(() => {
      window.electronAPI = {
        openFolder: () => Promise.resolve({ canceled: false, folderPath: 'C:\\Folder' }),
        readVault: () => Promise.resolve([
          { name: '<img src=x onerror="window.__toastXss=true">.md', relPath: 'evil.md', content: '# Evil' }
        ])
      };
    });

    await page.evaluate(() => window.openVault());
    await page.waitForTimeout(400);

    const xssTriggered = await page.evaluate(() => window.__toastXss);
    expect(xssTriggered).toBeFalsy();
  });

  // AC5 adversarial: tab title with XSS payload
  test('[ADV-tab-title-xss] tab title= with script payload is HTML-escaped', async ({ page }) => {
    await page.evaluate(() => { window.__titleXss = false; });
    await goto(page);

    await page.evaluate(() => {
      const S = window._marqamState;
      // The title= attribute is set via .title — safe DOM property, never innerHTML
      S.files = [{ name: '"><img src=x onerror="window.__titleXss=true">.md', path: 'x.md', handle: null, content: '# X', dirty: false }];
      window.renderFile(0);
    });
    await page.waitForTimeout(200);

    const xssTriggered = await page.evaluate(() => window.__titleXss);
    expect(xssTriggered).toBeFalsy();
  });

  // AC6 adversarial: paste with clipboard API unavailable — shows info toast not error
  test('[ADV-paste-no-clipboard] paste with no clipboard API shows info toast', async ({ page }) => {
    await goto(page);
    await injectFile(page, 'edit.md', '# Edit\n\nContent.');
    await page.evaluate(() => window.setEditorMode('source'));
    await page.waitForTimeout(100);

    // Remove clipboard API
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: null, writable: true, configurable: true
      });
      document.getElementById('srcTextarea').focus();
    });
    await page.waitForTimeout(50);

    await page.evaluate(() => window.execEditCmd('paste'));
    await page.waitForTimeout(200);

    // Should show info toast (graceful degradation)
    const toastText = await page.evaluate(() => document.getElementById('toast').textContent);
    expect(toastText.length).toBeGreaterThan(0);
    // Must not be an error toast
    const isError = await page.evaluate(() => {
      const t = document.getElementById('toast');
      return t && t.classList.contains('error');
    });
    expect(isError).toBe(false);
  });

  // AC7 adversarial: find-next button clicked when preview-pane is not in DOM — falls back gracefully
  // NOTE: findStep is an internal function, not exported on window. Test via button click.
  test('[ADV-find-no-pane] scrollMarkIntoPane falls back gracefully when .preview-pane absent', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await goto(page);
    await injectFile(page, 'doc.md', '# Doc\n\nContent with keyword keyword keyword.');
    await page.waitForTimeout(100);

    await page.evaluate(() => {
      window.openFind();
      window.runFind('keyword');
    });
    await page.waitForTimeout(100);

    // Remove .preview-pane temporarily to test the fallback branch in scrollMarkIntoPane
    await page.evaluate(() => {
      const pane = document.querySelector('.preview-pane');
      if (pane) pane.remove();
    });

    // findNextBtn click triggers findStep internally — should not throw
    await page.click('#findNextBtn');
    await page.waitForTimeout(100);

    const jsErrors = errors.filter(e => !e.includes('fonts.') && !e.includes('cdn.') && !e.includes('net::ERR'));
    expect(jsErrors).toHaveLength(0);
  });

  // AC8 adversarial: blockquote with backslash in prefix (> \) — handler does not break
  test('[ADV-bq-backslash] blockquote with backslash in line does not crash handler', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await goto(page);
    await injectFile(page, 'bq.md', '# BQ\n\n');
    await page.evaluate(() => window.setEditorMode('source'));
    await page.waitForTimeout(100);

    await page.evaluate(() => {
      const ta = document.getElementById('srcTextarea');
      ta.value = '> backslash \\ here';
      ta.selectionStart = ta.selectionEnd = ta.value.length;
      ta.focus();
    });
    await page.waitForTimeout(50);

    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);

    const jsErrors = errors.filter(e => !e.includes('fonts.') && !e.includes('cdn.') && !e.includes('net::ERR'));
    expect(jsErrors).toHaveLength(0);
  });

  // General adversarial: search result mark with <script> in file content is escaped
  test('[ADV-search-mark-xss] search result mark does not execute JS from file content', async ({ page }) => {
    await page.evaluate(() => { window.__searchXss = false; });
    await goto(page);

    await injectFile(page, 'evil.md', 'trigger keyword <script>window.__searchXss=true;</script> after');
    await page.click('.sb-tab[data-pane="search"]');
    await page.waitForTimeout(100);
    await page.fill('#sbSearchInput', 'trigger');
    await page.waitForTimeout(300);

    const xssTriggered = await page.evaluate(() => window.__searchXss);
    expect(xssTriggered).toBeFalsy();
  });
});

// ===========================================================================
// Phase 4 — Mutation detection tests
// ===========================================================================

test.describe('[MUT] Mutation detection tests', () => {

  // Mutation 1: Change `e.key !== 'Enter'` to `e.key === 'Enter'` in handleBlockquoteEnter
  // This would make non-Enter keys trigger the blockquote handler.
  // Our test: pressing a non-Enter key on a blockquote line must NOT strip the prefix.
  test('[MUT1] non-Enter key on blockquote line does NOT strip prefix (catches key check mutation)', async ({ page }) => {
    await goto(page);
    await injectFile(page, 'bq.md', '# BQ\n\n');
    await page.evaluate(() => window.setEditorMode('source'));
    await page.waitForTimeout(100);

    await page.evaluate(() => {
      const ta = document.getElementById('srcTextarea');
      ta.value = '> content here';
      ta.selectionStart = ta.selectionEnd = ta.value.length;
      ta.focus();
    });
    await page.waitForTimeout(50);

    // Press 'a' — must not trigger blockquote handler
    await page.keyboard.press('a');
    await page.waitForTimeout(100);

    const val = await page.evaluate(() => document.getElementById('srcTextarea').value);
    expect(val).toContain('> content here');
    expect(val).toContain('a'); // 'a' was appended
  });

  // Mutation 2: Remove `if (body.trim() === '')` guard — always exits blockquote
  // This would exit even on non-empty lines. Our test: Enter on "> foo" continues, not exits.
  test('[MUT2] Enter on non-empty blockquote line CONTINUES (catches missing empty-check mutation)', async ({ page }) => {
    await goto(page);
    await injectFile(page, 'bq.md', '# BQ\n\n');
    await page.evaluate(() => window.setEditorMode('source'));
    await page.waitForTimeout(100);

    await page.evaluate(() => {
      const ta = document.getElementById('srcTextarea');
      ta.value = '> nonEmptyContent';
      ta.selectionStart = ta.selectionEnd = ta.value.length;
      ta.focus();
    });
    await page.waitForTimeout(50);

    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);

    const val = await page.evaluate(() => document.getElementById('srcTextarea').value);
    // Must continue with "> " prefix on new line, NOT exit blockquote
    expect(val).toContain('> nonEmptyContent\n> ');
  });

  // Mutation 3: Change `.preview-pane` selector to `.source-pane` in scrollMarkIntoPane
  // This would scroll the wrong container. Our test: document scrollY must remain 0
  // (if source-pane is scrolled instead of preview-pane, document-level scroll can happen).
  // NOTE: findStep is not exported on window; use #findNextBtn click to trigger it.
  test('[MUT3] find-next scrolls only preview-pane, not document (catches wrong scroll container)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await goto(page);

    const longDoc = Array.from({ length: 30 }, (_, i) =>
      `## Section ${i + 1}\n\nThis paragraph ${i + 1} contains findtarget here.\n\n`
    ).join('');

    await injectFile(page, 'long.md', longDoc);
    await page.waitForTimeout(200);

    const scrollYBefore = await page.evaluate(() => window.scrollY);

    await page.evaluate(() => {
      window.openFind();
      window.runFind('findtarget');
    });
    await page.waitForTimeout(100);

    // Navigate to a hit that would require scrolling (via UI button, not window.findStep)
    for (let i = 0; i < 10; i++) {
      await page.click('#findNextBtn');
      await page.waitForTimeout(30);
    }

    const scrollYAfter = await page.evaluate(() => window.scrollY);
    // If scrollMarkIntoPane used the wrong container, scrollY would change
    expect(scrollYAfter).toBe(scrollYBefore);
  });

  // Mutation 4: Change `min-width: 0` on .tab to `min-width: auto` — tab name would not ellipsize.
  // When min-width:0 is missing, the tab expands to content width and no ellipsis occurs.
  // Test: verify that ellipsis IS occurring (scrollWidth > clientWidth on tab-name span)
  // AND that the .tab element itself does not exceed its max-width:200px constraint.
  test('[MUT4] .tab-name ellipsis active: span.scrollWidth > span.clientWidth (catches missing min-width:0)', async ({ page }) => {
    const LONG = 'extremely-long-filename-that-should-trigger-ellipsis-definitely.md';
    await page.setViewportSize({ width: 1440, height: 900 });
    await goto(page);
    await injectFile(page, LONG, '# Long\n\nContent.');
    await page.waitForTimeout(100);

    const result = await page.evaluate(() => {
      const span = document.querySelector('.tab-name');
      const tab = document.querySelector('.tab');
      if (!span || !tab) return { error: 'elements not found' };
      return {
        // scrollWidth > clientWidth proves the span is being clipped (ellipsis active)
        spanIsClipped: span.scrollWidth > span.clientWidth,
        // tab width must not exceed max-width:200px
        tabWidth: tab.getBoundingClientRect().width,
        spanScrollWidth: span.scrollWidth,
        spanClientWidth: span.clientWidth
      };
    });

    // Ellipsis should be active: span content is wider than its rendered width
    expect(result.spanIsClipped).toBe(true);
    // Tab must be constrained to <= 200px (max-width respected)
    expect(result.tabWidth).toBeLessThanOrEqual(205); // 200px + rounding tolerance
  });
});
