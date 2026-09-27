// @ts-check
/**
 * reading-progress.spec.js — T4.1: the "Continue reading" shelf and the reading-position
 * restore. Boots the renderer with a mocked electronAPI (the recents-open.spec.js harness)
 * because the shelf, the stored list and the scroll restore all flow through settings.
 *
 * The scroller is .preview-pane (see app.js previewScroller()): .editor-wrap never scrolls.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_URL = `file:///${path.resolve(__dirname, '../../src/renderer/index.html').replace(/\\/g, '/')}`;

const DEFAULTS = {
  theme: 'paper', zoomFactor: 1, editorMode: 'live', viewMode: 'reading',
  sidebarVisible: true, inspectorVisible: true,
  uiDirection: 'ltr', uiLocale: 'en',
  calendar: 'gregorian', arabicKashida: false, italicRecolor: true,
  recents: [], readingProgress: [], themeFollowSystem: false, updateCheck: 'manual', readingGoalMin: 10,
  window: { w: 1280, h: 820, maximized: false }, lastSession: null,
};

async function bootWithBridge(page, { settings = DEFAULTS, vaults = {}, files = {}, stats = null } = {}) {
  await page.addInitScript(({ settings, vaults, files, stats }) => {
    window.__vaults = vaults;
    window.__files = files;
    // T8.1: an in-page stand-in for the reading-stats store (main owns the real one).
    window.__stats = stats || { today: 0, date: '2026-01-03', streak: 0, days: {} };
    window.__statsAdds = [];
    const noop = () => {};
    const vaultIds = Object.keys(vaults);
    window.electronAPI = {
      closeWindow: noop, minimizeWindow: noop, maximizeWindow: noop,
      // A vault id in the map means the folder picker returns that vault.
      openFolder: async () => (vaultIds.length
        ? { vault: { id: vaultIds[0], name: 'V' } }
        : { canceled: true }),
      readVault: async (id) => window.__vaults[id] || { error: 'unauthorized-capability' },
      openFile: async () => ({ canceled: true }),
      readFile: async (p) => window.__files[p] || { error: 'unauthorized-path' },
      writeFile: async () => ({ ok: true }),
      getSettings: async () => settings,
      setSettings: async (patch) => { window.__setSettingsCalls = (window.__setSettingsCalls || []).concat([patch]); return { ok: true }; },
      exportPDF: async () => ({ ok: true }),
      statsGet: async () => window.__stats,
      statsAddMinutes: async (minutes) => {
        window.__statsAdds.push(minutes);
        if (!Number.isInteger(minutes) || minutes < 1 || minutes > 120) return { error: 'invalid-minutes' };
        window.__stats = { ...window.__stats, today: window.__stats.today + minutes, streak: window.__stats.streak || 1 };
        return { ok: true, today: window.__stats.today, date: window.__stats.date, streak: window.__stats.streak };
      },
      editCommand: noop, onOpenFile: noop, onVaultChanged: noop,
      checkForUpdate: async () => ({}), logError: noop,
    };
  }, { settings, vaults, files, stats });
  await page.goto(INDEX_URL);
  await page.waitForSelector('#app', { state: 'visible' });
  await page.waitForFunction(() => !!window._appState, null, { timeout: 8000 });
}

const longNote = (label) => `# ${label}\n\n${Array.from({ length: 40 }, (_, i) => `Paragraph ${i} of ${label}.`).join('\n\n')}\n`;

test.describe('[T4.1] Continue reading shelf', () => {
  test('a stored position shows the shelf and clicking it opens the note', async ({ page }) => {
    await bootWithBridge(page, {
      settings: {
        ...DEFAULTS,
        readingProgress: [{
          key: 'doc:cap-note', name: 'note.md', path: 'note.md',
          vaultId: null, documentId: 'cap-note', ratio: 0.42, at: Date.now() - 3600 * 1000,
        }],
      },
      files: { 'cap-note': { name: 'note.md', documentId: 'cap-note', content: '# Note body\n\nhi' } },
    });

    const wrap = page.locator('#continueWrap');
    await expect(wrap).not.toHaveAttribute('hidden', '');
    const item = page.locator('#continueList .continue-item');
    await expect(item).toHaveCount(1);
    await expect(item).toContainText('note.md');
    await expect(item).toContainText('42%');
    // the sub-line names the path and a relative time (a real Intl label, so just non-empty)
    await expect(item.locator('.c-sub')).toContainText('note.md ·');

    await item.click();
    await expect.poll(() => page.evaluate(() => window._appState.files.length)).toBe(1);
    expect(await page.evaluate(() => window._appState.activeFile)).toBe(0);
  });

  test('the shelf is hidden when nothing has a stored position', async ({ page }) => {
    await bootWithBridge(page, { settings: { ...DEFAULTS } });
    await expect(page.locator('#continueWrap')).toHaveAttribute('hidden', '');
    await expect(page.locator('#continueList .continue-item')).toHaveCount(0);
  });

  test('at most four entries, newest first', async ({ page }) => {
    const now = Date.now();
    const progress = Array.from({ length: 6 }, (_, i) => ({
      key: `doc:cap-${i}`, name: `n${i}.md`, path: `n${i}.md`,
      vaultId: null, documentId: `cap-${i}`, ratio: 0.5, at: now - i * 60_000,
    }));
    await bootWithBridge(page, { settings: { ...DEFAULTS, readingProgress: progress } });
    const names = await page.locator('#continueList .continue-item .c-name').allTextContents();
    expect(names).toEqual(['n0.md', 'n1.md', 'n2.md', 'n3.md']);
  });
});

test.describe('[T4.1] reading scroll capture + restore', () => {
  test('a scrolled note reopens at its position after switching away and back', async ({ page }) => {
    await bootWithBridge(page, {
      settings: { ...DEFAULTS },
      vaults: {
        'cap-v': {
          vault: { id: 'cap-v', name: 'V', generation: 1 },
          entries: [
            { name: 'long.md', relPath: 'long.md', content: longNote('Long'), documentId: 'cap-long' },
            { name: 'other.md', relPath: 'other.md', content: '# Other\n\nshort', documentId: 'cap-other' },
          ],
        },
      },
    });

    // Load the vault through the real controller, then open the long note.
    await page.evaluate(() => window.openVault());
    await page.waitForFunction(() => window._appState.files.length === 2, null, { timeout: 8000 });
    await page.evaluate(() => {
      const idx = window._appState.files.findIndex((f) => f.name === 'long.md');
      window.renderFile(idx);
    });
    await expect(page.locator('#editorArea')).toHaveClass(/reading/);

    // Scroll the reading pane and let the throttled capture fire.
    const scrolled = await page.evaluate(async () => {
      const pane = document.querySelector('.preview-pane');
      const max = pane.scrollHeight - pane.clientHeight;
      if (!(max > 0)) return { ok: false, reason: 'not scrollable', max };
      pane.scrollTop = Math.round(max * 0.5);
      pane.dispatchEvent(new Event('scroll'));
      await new Promise((r) => setTimeout(r, 1500)); // past the 1s throttle
      return { ok: true, max, top: pane.scrollTop };
    });
    expect(scrolled.ok, scrolled.reason).toBe(true);
    expect(scrolled.top).toBeGreaterThan(0);

    // Switch to the other note and back — the pane is reset on switch, then restored.
    await page.evaluate(() => {
      const idx = window._appState.files.findIndex((f) => f.name === 'other.md');
      window.renderFile(idx);
    });
    expect(await page.evaluate(() => document.querySelector('.preview-pane').scrollTop)).toBe(0);

    await page.evaluate(() => {
      const idx = window._appState.files.findIndex((f) => f.name === 'long.md');
      window.renderFile(idx);
    });
    await expect.poll(() => page.evaluate(() => document.querySelector('.preview-pane').scrollTop), { timeout: 5000 })
      .toBeGreaterThan(scrolled.top - 40);
    const restored = await page.evaluate(() => document.querySelector('.preview-pane').scrollTop);
    expect(Math.abs(restored - scrolled.top)).toBeLessThanOrEqual(30);
  });

  test('a file opened but never scrolled does not enter the shelf', async ({ page }) => {
    await bootWithBridge(page, {
      settings: { ...DEFAULTS },
      vaults: {
        'cap-v': {
          vault: { id: 'cap-v', name: 'V', generation: 1 },
          entries: [{ name: 'long.md', relPath: 'long.md', content: longNote('Long'), documentId: 'cap-long' }],
        },
      },
    });
    await page.evaluate(() => window.openVault());
    await page.waitForFunction(() => window._appState.files.length === 1, null, { timeout: 8000 });
    await page.evaluate(() => window.renderFile(0));
    await page.evaluate(async () => {
      window._captureReadingProgress(window._appState.files[0]);
      await new Promise((r) => setTimeout(r, 100));
    });
    expect(await page.evaluate(() => window._appState.readingProgress.length)).toBe(0);
    await expect(page.locator('#continueWrap')).toHaveAttribute('hidden', '');
  });

  // T10 BUG-1: a tab switch inside the capture throttle window. The pending trailing
  // capture is cancelled and the switch's own pane bookkeeping is suspended, so the
  // incoming note's restored position can never be measured as ~0 and written over its
  // own shelf entry. The delayed-rAF stub forces B's restore to land AFTER the point
  // where the pre-fix trailing timer fired — the exact window where the bug lived.
  test('a switch inside the capture throttle keeps both notes\' stored positions', async ({ page }) => {
    await bootWithBridge(page, {
      settings: { ...DEFAULTS },
      vaults: {
        'cap-v': {
          vault: { id: 'cap-v', name: 'V', generation: 1 },
          entries: [
            { name: 'a.md', relPath: 'a.md', content: longNote('A'), documentId: 'cap-a' },
            { name: 'b.md', relPath: 'b.md', content: longNote('B'), documentId: 'cap-b' },
          ],
        },
      },
    });
    await page.evaluate(() => window.openVault());
    await page.waitForFunction(() => window._appState.files.length === 2, null, { timeout: 8000 });

    // Read B first so it owns a real stored position.
    await page.evaluate(() => window.renderFile(1));
    const bRatio = await page.evaluate(async () => {
      const pane = document.querySelector('.preview-pane');
      const max = pane.scrollHeight - pane.clientHeight;
      pane.scrollTop = Math.round(max * 0.6);
      pane.dispatchEvent(new Event('scroll'));
      await new Promise((r) => setTimeout(r, 1500)); // past the 1s throttle → captured
      return pane.scrollTop / max;
    });

    // Scroll A: the first event captures immediately, the second arms the trailing write.
    await page.evaluate(() => window.renderFile(0));
    const aRatio = await page.evaluate(async () => {
      const pane = document.querySelector('.preview-pane');
      const max = pane.scrollHeight - pane.clientHeight;
      pane.scrollTop = Math.round(max * 0.5);
      pane.dispatchEvent(new Event('scroll'));
      await new Promise((r) => setTimeout(r, 50)); // inside the throttle window
      pane.scrollTop = Math.round(max * 0.7);
      pane.dispatchEvent(new Event('scroll'));
      await new Promise((r) => setTimeout(r, 50));
      return pane.scrollTop / max;
    });

    // Delay every rAF so B's position restore lands well after the pre-fix trailing
    // timer's fire time.
    await page.evaluate(() => {
      const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (cb) => raf(() => setTimeout(() => cb(performance.now()), 1200));
    });
    await page.evaluate(() => window.renderFile(1));

    const entries = await page.evaluate(() => window._appState.readingProgress);
    const a = entries.find((e) => e.name === 'a.md');
    const b = entries.find((e) => e.name === 'b.md');
    expect(a, 'A is captured at switch time').toBeTruthy();
    expect(Math.abs(a.ratio - aRatio)).toBeLessThan(0.02);
    expect(b, 'B keeps its stored position').toBeTruthy();
    expect(Math.abs(b.ratio - bRatio)).toBeLessThan(0.02);
    // The pane ends restored to B's position once the delayed rAFs ran.
    await expect.poll(() => page.evaluate(() => {
      const pane = document.querySelector('.preview-pane');
      return pane.scrollTop / (pane.scrollHeight - pane.clientHeight);
    }), { timeout: 5000 }).toBeGreaterThan(0.5);
  });
});

// ── T8.1: reading minutes + streak ───────────────────────────────────────────────────
test.describe('[T8.1] reading streak + daily minutes', () => {
  const stats = { today: 12, date: '2026-01-03', streak: 5, days: { '2026-01-01': 4, '2026-01-02': 8, '2026-01-03': 12 } };

  test('the welcome line reports the streak and today against the goal', async ({ page }) => {
    await bootWithBridge(page, { settings: { ...DEFAULTS, readingGoalMin: 20 }, stats });
    const line = page.locator('#streakLine');
    await expect(line).not.toHaveAttribute('hidden', '');
    await expect(line).toHaveText('5-day streak · Today 12 of 20 min');
    expect(await page.evaluate(() => window._appState.readingStats.streak)).toBe(5);
  });

  test('a goal of 0 hides the line entirely (no nagging chrome)', async ({ page }) => {
    await bootWithBridge(page, { settings: { ...DEFAULTS, readingGoalMin: 0 }, stats });
    await expect(page.locator('#streakLine')).toHaveAttribute('hidden', '');
  });

  test('nothing to report yet → no line, even with a goal set', async ({ page }) => {
    await bootWithBridge(page, { settings: { ...DEFAULTS, readingGoalMin: 10 } });
    await expect(page.locator('#streakLine')).toHaveAttribute('hidden', '');
  });

  test('one tick adds exactly one minute while reading, and updates the line', async ({ page }) => {
    await bootWithBridge(page, {
      settings: { ...DEFAULTS, readingGoalMin: 20, viewMode: 'reading' },
      vaults: {
        'cap-v': {
          vault: { id: 'cap-v', name: 'V', generation: 1 },
          entries: [{ name: 'n.md', relPath: 'n.md', content: '# Note\n\nbody', documentId: 'cap-n' }],
        },
      },
      stats,
    });
    await page.evaluate(() => window.openVault());
    await page.waitForFunction(() => window._appState.files.length === 1, null, { timeout: 8000 });
    await page.evaluate(() => window.renderFile(0));
    await page.evaluate(() => window.showWelcome()); // the line lives on the welcome card
    await page.evaluate(() => window._readingMinuteTick());
    await expect.poll(() => page.evaluate(() => window.__statsAdds)).toEqual([1]);
    await expect(page.locator('#streakLine')).toHaveText('5-day streak · Today 13 of 20 min');
  });

  test('the tick stays silent in Edit mode, with no file, or while the window is hidden', async ({ page }) => {
    await bootWithBridge(page, {
      settings: { ...DEFAULTS, viewMode: 'edit' },
      vaults: {
        'cap-v': {
          vault: { id: 'cap-v', name: 'V', generation: 1 },
          entries: [{ name: 'n.md', relPath: 'n.md', content: '# Note\n\nbody', documentId: 'cap-n' }],
        },
      },
      stats,
    });
    await page.evaluate(() => window._readingMinuteTick()); // no file open at all
    expect(await page.evaluate(() => window.__statsAdds)).toEqual([]);

    await page.evaluate(() => window.openVault());
    await page.waitForFunction(() => window._appState.files.length === 1, null, { timeout: 8000 });
    await page.evaluate(() => window.renderFile(0));
    await page.evaluate(() => window._readingMinuteTick()); // Edit mode: not reading
    expect(await page.evaluate(() => window.__statsAdds)).toEqual([]);

    await page.evaluate(() => {
      window.setViewMode('reading');
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    });
    await page.evaluate(() => window._readingMinuteTick()); // backgrounded: not reading either
    expect(await page.evaluate(() => window.__statsAdds)).toEqual([]);
  });

  test('the Settings dialog sets the goal and persists it', async ({ page }) => {
    await bootWithBridge(page, { settings: { ...DEFAULTS, readingGoalMin: 10 }, stats });
    await page.evaluate(() => window.showSettings());
    await expect(page.locator('#setGoal10')).toHaveAttribute('aria-pressed', 'true');
    await page.click('#setGoal30');
    expect(await page.evaluate(() => window._appState.readingGoalMin)).toBe(30);
    await expect(page.locator('#setGoal30')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#streakLine')).toHaveText('5-day streak · Today 12 of 30 min');
    await expect.poll(
      () => page.evaluate(() => (window.__setSettingsCalls || []).some((c) => c.readingGoalMin === 30)),
      { timeout: 3000 }
    ).toBe(true);

    await page.click('#setGoalOff');
    expect(await page.evaluate(() => window._appState.readingGoalMin)).toBe(0);
    await expect(page.locator('#streakLine')).toHaveAttribute('hidden', '');
  });
});

// ── T14 (post-release review): the closeTab / welcome capture paths ────────────────
// T10 fixed the throttle's wrong-file binding, but two sibling paths could still write
// a foreign ratio into a shelf entry: closing the ACTIVE middle tab (the splice shifts
// the neighbor into the guard's index) and the trailing timer surviving into welcome.
test.describe('[T14] capture safety on close', () => {
  // The splice path in closeTab only runs for LOOSE files (vault entries close through
  // their inventory branch, which never splices), so these tests inject loose files
  // with document ids — exactly how single-file opens and drag-and-drop land in State.
  const loose = (name, id, label) => ({
    name, path: name, handle: null, documentId: id, content: longNote(label), dirty: false,
  });

  test('closing the active middle tab never files its position under the neighbor', async ({ page }) => {
    await bootWithBridge(page, { settings: { ...DEFAULTS } });
    await page.evaluate((files) => {
      window._appState.files = files;
      window.renderFile(1);
    }, [
      loose('a.md', 'cap-t14-a', 'A'),
      loose('b.md', 'cap-t14-b', 'B'),
      loose('c.md', 'cap-t14-c', 'C'),
    ]);
    await page.waitForFunction(() => window._appState.files.length === 3, null, { timeout: 8000 });

    // B owns a real stored position (past the 1s throttle → captured).
    await page.evaluate(async () => {
      const pane = document.querySelector('.preview-pane');
      const max = pane.scrollHeight - pane.clientHeight;
      pane.scrollTop = Math.round(max * 0.6);
      pane.dispatchEvent(new Event('scroll'));
      await new Promise((r) => setTimeout(r, 1500));
    });

    // Close the ACTIVE middle tab. Pre-fix, the splice moved C into index 1 while
    // State.activeFile still pointed there, so renderFile's outgoing-capture guard
    // measured B's still-displayed pane and filed its ratio under C's key.
    await page.evaluate(() => window.closeTab(1));
    await page.waitForFunction(() => window._appState.files.length === 2, null, { timeout: 8000 });

    const progress = await page.evaluate(() => window._appState.readingProgress);
    const keys = progress.map((item) => item && item.key);
    expect(keys).toContain('doc:cap-t14-b');
    expect(keys).not.toContain('doc:cap-t14-c');
    const b = progress.find((item) => item.key === 'doc:cap-t14-b');
    expect(b.ratio).toBeGreaterThan(0.5);
  });

  test('closing the last tab inside the throttle window leaves the shelf entry alone', async ({ page }) => {
    await bootWithBridge(page, { settings: { ...DEFAULTS } });
    // The settings restore applies viewMode asynchronously after boot — scroll capture only
    // measures the reading pane once Reading mode is actually active and it can scroll.
    await page.waitForFunction(() => window._appState.viewMode === 'reading', null, { timeout: 8000 });
    await page.evaluate((files) => {
      window._appState.files = files;
      window.renderFile(0);
    }, [loose('solo.md', 'cap-t14-solo', 'S')]);
    await page.waitForFunction(() => window._appState.files.length === 1, null, { timeout: 8000 });

    // A real captured position, then — INSIDE the one-second write throttle — a second
    // scroll that only arms the trailing write, then the close. All in ONE evaluate: the
    // in-page poll confirms the 0.8 capture WITHOUT an out-of-process round trip that
    // would blow the throttle window, and closeTab lands long before the ~950ms timer
    // could fire. The close-time capture (T14 H1) records the HONEST final position,
    // and welcome must CANCEL the armed write — the pre-fix timer survived into the
    // welcome screen and overwrote the entry with welcome-card geometry instead.
    await page.evaluate(async () => {
      const pane = document.querySelector('.preview-pane');
      const max = pane.scrollHeight - pane.clientHeight;
      pane.scrollTop = Math.round(max * 0.8);
      pane.dispatchEvent(new Event('scroll'));            // immediate capture → 0.8
      const t0 = Date.now();
      while (Date.now() - t0 < 3000) {
        const entry = (window._appState.readingProgress || [])
          .find((i) => i && i.key === 'doc:cap-t14-solo');
        if (entry && entry.ratio > 0.6) break;
        await new Promise((r) => setTimeout(r, 25));
      }
      pane.scrollTop = Math.round(max * 0.3);
      pane.dispatchEvent(new Event('scroll'));            // arms the trailing write
      window.closeTab(0);                                 // honest capture + cancel
    });
    await page.waitForFunction(() => window._appState.files.length === 0, null, { timeout: 8000 });
    await page.waitForTimeout(1200); // past the pre-fix fire time

    const progress = await page.evaluate(() => window._appState.readingProgress);
    const solo = progress.find((item) => item && item.key === 'doc:cap-t14-solo');
    expect(solo).toBeTruthy();
    // The stored value must be the honest final position (0.3 at close) — not the 0.8
    // captured earlier and not welcome-card geometry from the cancelled trailing write.
    expect(solo.ratio).toBeGreaterThan(0.2);
    expect(solo.ratio).toBeLessThan(0.4);
  });
});
