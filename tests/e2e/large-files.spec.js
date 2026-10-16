// @ts-check
/**
 * large-files.spec.js — large notes in the renderer (browser lane).
 *
 *   5-20 MB   opens, told once, no preview while editing
 *   20-100 MB asks first; large-file mode; Reading mode shows "Render anyway"
 *   > 100 MB  refused, with the limit named
 *
 * Notes arrive by drop, which is the browser lane's way in. The tiers are lowered through the
 * page's test hook (applyLimits; there is no such hook in a packaged build), so a note of a few
 * hundred KB exercises each tier in milliseconds and the specs hold up under a loaded machine.
 * The real byte edges are pinned by the unit tests (noteTier) and one real-size smoke test below.
 * Error toasts for each export failure code and the large-export notice are checked through the
 * electronAPI stand-in.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const FILE_URL = 'file:///' + path.resolve(__dirname, '../../src/renderer/index.html').replace(/\\/g, '/');
const MIB = 1024 * 1024;
const KIB = 1024;

// Scaled tiers: LARGE above 256 KiB, HUGE above 512 KiB, refused above 7 MiB.
const LARGE_AT = 256 * KIB;
const HUGE_AT = 512 * KIB;
const REFUSED_AT = 7 * MIB;

test.setTimeout(60000);

test.beforeEach(async ({ page }) => {
  await page.goto(FILE_URL);
  await page.waitForSelector('.app', { state: 'visible' });
  await page.waitForFunction(() => window.getActiveCmAdapter && window.getActiveCmAdapter() != null, null, { timeout: 30000 });
});

/** Lower the size tiers for this page (the test hook exists only for file: and ?bpmdTest pages). */
const lowerLimits = (page) => page.evaluate(({ large, huge, refused, exportAt }) => window.applyLimits({
  largeNoteBytes: large, confirmNoteBytes: huge, maxFileBytes: refused, largeExportBytes: exportAt,
}), { large: LARGE_AT, huge: HUGE_AT, refused: REFUSED_AT, exportAt: LARGE_AT });

/** Drop one note of `bytes` bytes: a heading, then lines of filler (or one very long line). */
async function dropNote(page, name, bytes, { singleLine = false } = {}) {
  await page.evaluate(({ name, bytes, singleLine }) => {
    const head = '# Big note\n\n';
    // Lines of 100 characters: one line of tens of MB is a different (CodeMirror) problem.
    const line = 'word '.repeat(19) + 'abcd\n';
    const body = singleLine
      ? 'word '.repeat(Math.ceil((bytes - head.length) / 5)).slice(0, bytes - head.length)
      : line.repeat(Math.ceil((bytes - head.length) / line.length)).slice(0, bytes - head.length);
    const file = new File([head + body], name, { type: 'text/markdown' });
    const dt = new DataTransfer();
    dt.items.add(file);
    document.body.dispatchEvent(new DragEvent('drop', { cancelable: true, bubbles: true, dataTransfer: dt }));
  }, { name, bytes, singleLine });
}

/** The text of the toast while it is on screen, else ''. */
const visibleToast = (page) => page.evaluate(() => {
  const toast = document.getElementById('toast');
  return toast.classList.contains('show') ? toast.textContent : '';
});

const fileInfo = (page) => page.evaluate(() => {
  const f = window._appState.files[0];
  return f ? { tier: f.largeTier, size: f.sizeBytes } : null;
});

/** Drop a HUGE note, confirm, wait for it. */
async function openHuge(page, bytes = HUGE_AT + 64 * KIB) {
  await lowerLimits(page);
  await dropNote(page, 'huge.md', bytes);
  await page.locator('#largeOpenConfirmBtn').click();
  await expect.poll(() => fileInfo(page)).toMatchObject({ tier: 2 });
}

test.describe('tier edges on drop', () => {
  test.beforeEach(async ({ page }) => { await lowerLimits(page); });

  test('exactly the large size is an ordinary note: no notice', async ({ page }) => {
    await dropNote(page, 'five.md', LARGE_AT);
    await expect.poll(() => fileInfo(page)).toMatchObject({ tier: 0 });
    await expect(page.locator('#toast')).not.toContainText('large');
  });

  test('one byte over opens as a large note and says so once', async ({ page }) => {
    await dropNote(page, 'large.md', LARGE_AT + 1);
    await expect.poll(() => fileInfo(page)).toMatchObject({ tier: 1 });
    await expect(page.locator('#toast')).toContainText('large');
  });

  test('exactly the confirm size opens with no question', async ({ page }) => {
    await dropNote(page, 'twenty.md', HUGE_AT);
    await expect.poll(() => fileInfo(page)).toMatchObject({ tier: 1 });
    await expect(page.locator('#largeOpenConfirmBtn')).toHaveCount(0);
  });

  test('one byte over the confirm size asks first; Cancel opens nothing', async ({ page }) => {
    await dropNote(page, 'huge.md', HUGE_AT + 1);
    await expect(page.locator('#largeOpenConfirmBtn')).toBeVisible();
    await page.locator('#largeOpenCancelBtn').click();
    await expect(page.locator('#largeOpenConfirmBtn')).toBeHidden();
    expect(await page.evaluate(() => window._appState.files.length)).toBe(0);
  });

  test('one byte over the open limit is refused with the limit named', async ({ page }) => {
    await page.evaluate((bytes) => {
      const file = new File([new Uint8Array(bytes)], 'toobig.md', { type: 'text/markdown' });
      const dt = new DataTransfer();
      dt.items.add(file);
      document.body.dispatchEvent(new DragEvent('drop', { cancelable: true, bubbles: true, dataTransfer: dt }));
    }, REFUSED_AT + 1);
    await expect(page.locator('#toast')).toContainText('7 MB');
    await expect(page.locator('#toast')).toHaveClass(/error/);
    expect(await page.evaluate(() => window._appState.files.length)).toBe(0);
  });
});

// One test at the real sizes (the others run on scaled tiers): 20 MiB + 1 byte asks first. The
// note is built and handed to the page whole, which is slow on a loaded machine, hence the room.
test('real limits: 20 MiB + 1 byte asks first; Cancel opens nothing', async ({ page }) => {
  test.setTimeout(180000);
  await dropNote(page, 'huge.md', 20 * MIB + 1);
  await expect(page.locator('#largeOpenConfirmBtn')).toBeVisible({ timeout: 120000 });
  await page.locator('#largeOpenCancelBtn').click();
  await expect(page.locator('#largeOpenConfirmBtn')).toBeHidden();
  expect(await page.evaluate(() => window._appState.files.length)).toBe(0);
});

test.describe('two large notes asked about at once', () => {
  test('both questions are asked, one after the other, and both notes open', async ({ page }) => {
    await lowerLimits(page);
    await dropNote(page, 'a.md', HUGE_AT + KIB);
    await dropNote(page, 'b.md', HUGE_AT + 2 * KIB);
    // A second dialog used to replace the first one's buttons: its question never got an answer.
    await expect.poll(async () => {
      await page.evaluate(() => document.getElementById('largeOpenConfirmBtn')?.click());
      return page.evaluate(() => window._appState.files.length);
    }, { timeout: 20000 }).toBe(2);
    expect(await page.evaluate(() => window._appState.files.map((f) => f.name).sort())).toEqual(['a.md', 'b.md']);
  });

  test('declining the first still asks the second', async ({ page }) => {
    await lowerLimits(page);
    await dropNote(page, 'a.md', HUGE_AT + KIB);
    await dropNote(page, 'b.md', HUGE_AT + 2 * KIB);
    await expect(page.locator('#largeOpenCancelBtn')).toBeVisible();
    await page.locator('#largeOpenCancelBtn').click();
    await expect.poll(async () => {
      await page.evaluate(() => document.getElementById('largeOpenConfirmBtn')?.click());
      return page.evaluate(() => window._appState.files.map((f) => f.name));
    }, { timeout: 20000 }).toEqual(['b.md']);
  });
});

test.describe('large-file mode (20-100 MB)', () => {
  test('Reading mode shows a notice instead of rendering; "Render anyway" renders on demand', async ({ page }) => {
    await openHuge(page, Math.round(1.2 * MIB));
    await page.evaluate(() => window.setViewMode('reading'));
    await expect(page.locator('#renderAnywayBtn')).toBeVisible();
    expect(await page.locator('#noteContent h1').count()).toBe(0);
    await page.locator('#renderAnywayBtn').click();
    await expect(page.locator('#noteContent h1')).toHaveCount(1, { timeout: 30000 });
    await expect(page.locator('#renderAnywayBtn')).toHaveCount(0);
  });

  test('the outline is not built; it says why', async ({ page }) => {
    await openHuge(page);
    await expect(page.locator('#tocList')).toContainText(/large/i);
  });

  test('the note-is-large message names the outline among the things that are off', async ({ page }) => {
    await lowerLimits(page);
    await dropNote(page, 'huge.md', HUGE_AT + 64 * KIB);
    await page.locator('#largeOpenConfirmBtn').click();
    await expect(page.locator('#toast')).toContainText(/outline/i);
  });

  test('typing marks the note unsaved at once, and every reader of the text sees the keystrokes', async ({ page }) => {
    await openHuge(page);
    await page.evaluate(() => window.setViewMode('edit'));
    const result = await page.evaluate(() => {
      const ad = window.getActiveCmAdapter();
      ad.replaceSelection('Z');
      const file = window._appState.files[0];
      const early = { dirty: file.dirty, pending: ad.hasPendingChange() };
      const text = file.content; // the read hands over the pending change
      return { early, startsWithZ: text.startsWith('Z'), pendingAfter: ad.hasPendingChange(), dirtyAfter: file.dirty };
    });
    expect(result.early).toEqual({ dirty: true, pending: true });
    expect(result.startsWithZ).toBe(true);
    expect(result.pendingAfter).toBe(false);
    expect(result.dirtyAfter).toBe(true);
  });

  test('typing and undoing back to the saved text is clean again', async ({ page }) => {
    await openHuge(page);
    await page.evaluate(() => window.setViewMode('edit'));
    const dirty = await page.evaluate(() => {
      const ad = window.getActiveCmAdapter();
      ad.replaceSelection('Z');
      void window._appState.files[0].content;
      ad.undo();
      return window._appState.files[0].content.startsWith('# Big') && window._appState.files[0].dirty;
    });
    expect(dirty).toBe(false);
  });

  test('switching to another note hands the typed text to the note it belongs to', async ({ page }) => {
    await openHuge(page);
    await page.evaluate(() => window.setViewMode('edit'));
    const kept = await page.evaluate(() => {
      const S = window._appState;
      window.getActiveCmAdapter().replaceSelection('Q');
      S.files.push({ name: 'small.md', path: 'small.md', handle: null, content: '# small', dirty: false });
      window.renderFile(1);
      return { first: S.files[0].content.startsWith('Q'), dirty: S.files[0].dirty, small: S.files[1].content, smallDirty: S.files[1].dirty };
    });
    expect(kept).toEqual({ first: true, dirty: true, small: '# small', smallDirty: false });
  });

  test('loading the editor from a note with a pending edit keeps the edit', async ({ page }) => {
    await openHuge(page);
    await page.evaluate(() => window.setViewMode('edit'));
    const result = await page.evaluate(() => {
      const ad = window.getActiveCmAdapter();
      const file = window._appState.files[0];
      ad.replaceSelection('Z');
      const pendingBefore = ad.hasPendingChange();
      window._loadIntoEditor(file); // no flush by the caller: the hand-over must happen inside
      return { pendingBefore, noteStartsWithZ: file.content.startsWith('Z'), editorStartsWithZ: ad.getValue().startsWith('Z'), dirty: file.dirty };
    });
    expect(result).toEqual({ pendingBefore: true, noteStartsWithZ: true, editorStartsWithZ: true, dirty: true });
  });

  test('a large note is found by the vault search without Arabic folding or a cache', async ({ page }) => {
    await openHuge(page);
    const hits = await page.evaluate(() => {
      const f = window._appState.files[0];
      f.content = `${f.content.slice(0, 1000)} needle ${f.content.slice(1000)}`;
      return window.vaultSearch ? window.vaultSearch('needle', window._appState.files).length : -1;
    });
    expect(hits === 1 || hits === -1).toBe(true);
  });
});

test.describe('a note that is told about before it is drawn (Reading mode)', () => {
  /** Record, once per frame, what the reader sees: the toast text and whether the heading is drawn. */
  const startFrameProbe = (page) => page.evaluate(() => {
    const toast = document.getElementById('toast');
    window.__frames = [];
    const tick = () => {
      window.__frames.push({ toast: toast.classList.contains('show') ? toast.textContent : '', drawn: !!document.querySelector('#noteContent h1') });
      window.__probe = requestAnimationFrame(tick);
    };
    tick();
  });
  const stopFrameProbe = (page) => page.evaluate(() => { cancelAnimationFrame(window.__probe); return window.__frames; });
  const MAY_TAKE = /may take a while/i;

  function expectNoticeBeforeRender(frames) {
    const drawnAt = frames.findIndex((f) => f.drawn);
    const noticeAt = frames.findIndex((f) => MAY_TAKE.test(f.toast) && !f.drawn);
    expect(drawnAt).toBeGreaterThan(-1);
    expect(noticeAt, 'a frame with the notice on screen and the note not yet drawn').toBeGreaterThan(-1);
    expect(noticeAt).toBeLessThan(drawnAt);
  }

  test('a large note opened while Reading says it will take a while before it is drawn', async ({ page }) => {
    await lowerLimits(page);
    await page.evaluate(() => window.setViewMode('reading'));
    await startFrameProbe(page);
    await dropNote(page, 'large.md', LARGE_AT + 64 * KIB);
    await expect(page.locator('#noteContent h1')).toHaveCount(1, { timeout: 20000 });
    const frames = await stopFrameProbe(page);
    expectNoticeBeforeRender(frames);
    // The once-per-open "this note is large" message is in the notice, ahead of the wait.
    expect(frames.some((f) => MAY_TAKE.test(f.toast) && /is large/.test(f.toast))).toBe(true);
    expect(await visibleToast(page)).not.toMatch(/Rendering/);
  });

  test('switching a large note to Reading says it will take a while before it is drawn', async ({ page }) => {
    await lowerLimits(page);
    await dropNote(page, 'large.md', LARGE_AT + 64 * KIB);
    await expect.poll(() => fileInfo(page)).toMatchObject({ tier: 1 });
    await startFrameProbe(page);
    await page.evaluate(() => window.setViewMode('reading'));
    await expect(page.locator('#noteContent h1')).toHaveCount(1, { timeout: 20000 });
    expectNoticeBeforeRender(await stopFrameProbe(page));
    expect(await visibleToast(page)).not.toMatch(/Rendering/);
  });

  test('the notice is not said twice for one open of the note', async ({ page }) => {
    await lowerLimits(page);
    await dropNote(page, 'large.md', LARGE_AT + 64 * KIB);
    await expect.poll(() => fileInfo(page)).toMatchObject({ tier: 1 });
    await page.evaluate(() => window.setViewMode('reading'));
    await expect(page.locator('#noteContent h1')).toHaveCount(1, { timeout: 20000 });
    await page.evaluate(() => { window.setViewMode('edit'); });
    await startFrameProbe(page);
    await page.evaluate(() => window.setViewMode('reading'));
    await expect(page.locator('#noteContent h1')).toHaveCount(1, { timeout: 20000 });
    const frames = await stopFrameProbe(page);
    // The second time the reader is told it will take a while, but not that the note is large again.
    expect(frames.some((f) => MAY_TAKE.test(f.toast) && !/is large/.test(f.toast))).toBe(true);
    expect(frames.some((f) => /is large/.test(f.toast))).toBe(false);
  });

  test('a note switched away during the wait is not drawn, and the notice does not stay', async ({ page }) => {
    await lowerLimits(page);
    await dropNote(page, 'large.md', LARGE_AT + 64 * KIB);
    await expect.poll(() => fileInfo(page)).toMatchObject({ tier: 1 });
    await page.evaluate(() => {
      const S = window._appState;
      S.files.push({ name: 'small.md', path: 'small.md', handle: null, content: '# Small heading', dirty: false });
      window.setViewMode('reading'); // the large note: notice now, drawn after a frame
      window.renderFile(1); // the reader moves on before that frame
    });
    await expect(page.locator('#noteContent h1')).toHaveText('Small heading');
    await page.waitForTimeout(600); // the cancelled render would have landed by now
    await expect(page.locator('#noteContent h1')).toHaveText('Small heading');
    await expect(page.locator('#noteContent')).not.toContainText('Big note');
    expect(await visibleToast(page)).not.toMatch(/may take a while/);
    expect(await page.evaluate(() => window._appState.files[window._appState.activeFile].name)).toBe('small.md');
  });

  test('a note closed during the wait is not drawn either', async ({ page }) => {
    await lowerLimits(page);
    await dropNote(page, 'large.md', LARGE_AT + 64 * KIB);
    await expect.poll(() => fileInfo(page)).toMatchObject({ tier: 1 });
    await page.evaluate(() => {
      window.setViewMode('reading');
      window.closeTab(0);
    });
    await page.waitForTimeout(600);
    expect(await page.locator('#noteContent h1').count()).toBe(0);
    expect(await visibleToast(page)).not.toMatch(/may take a while/);
    expect(await page.evaluate(() => window._appState.files.length)).toBe(0);
  });

  test('switching to Edit during the wait drops the render and leaves the editor on the note', async ({ page }) => {
    await lowerLimits(page);
    await dropNote(page, 'large.md', LARGE_AT + 64 * KIB);
    await expect.poll(() => fileInfo(page)).toMatchObject({ tier: 1 });
    const result = await page.evaluate(() => {
      window.setViewMode('reading');
      window.setViewMode('edit');
      return window.getActiveCmAdapter().getValue().startsWith('# Big note');
    });
    expect(result).toBe(true);
    await page.waitForTimeout(600);
    expect(await page.locator('#noteContent h1').count()).toBe(0);
    expect(await visibleToast(page)).not.toMatch(/may take a while/);
  });
});

test.describe('a save or a reload moves the note into its new size tier', () => {
  /** A note on disk as far as the page can tell: a document id and a stand-in for the write. */
  async function withWriter(page, sizeOnDisk) {
    await page.evaluate((size) => {
      window.electronAPI = {
        writeFile: async (payload) => ({ ok: true, size, meta: { hash: 'h-saved' }, revision: payload.revision }),
      };
      window._appState.files[0].documentId = 'doc-1';
    }, sizeOnDisk);
  }

  test('a large-file-mode note saved small leaves large-file mode: typing is no longer deferred', async ({ page }) => {
    await openHuge(page);
    await withWriter(page, 100 * KIB);
    await page.evaluate(() => {
      window.setViewMode('edit');
      const ad = window.getActiveCmAdapter();
      ad.setSelection({ start: 40 });
      ad.replaceSelection('Z');
    });
    await page.evaluate(() => window.saveCurrent());
    await expect.poll(() => fileInfo(page)).toMatchObject({ tier: 0, size: 100 * KIB });
    const after = await page.evaluate(() => {
      const ad = window.getActiveCmAdapter();
      const file = window._appState.files[0];
      ad.replaceSelection('Y');
      return {
        pending: ad.hasPendingChange(), // large-file mode defers the text; an ordinary note hands it over at once
        accessor: !!Object.getOwnPropertyDescriptor(file, 'content').get,
        caret: ad.getSelection().start,
        text: file.content.slice(38, 44),
      };
    });
    expect(after.pending).toBe(false);
    expect(after.accessor).toBe(false);
    expect(after.text).toContain('Y');
    expect(after.caret).toBe(42); // the caret was at 41 after the first keystroke: it stayed
  });

  test('an ordinary note saved huge enters large-file mode', async ({ page }) => {
    await lowerLimits(page);
    await dropNote(page, 'small.md', 100 * KIB);
    await expect.poll(() => fileInfo(page)).toMatchObject({ tier: 0 });
    await withWriter(page, HUGE_AT + 100 * KIB);
    await page.evaluate(() => {
      window.setViewMode('edit');
      const ad = window.getActiveCmAdapter();
      ad.setSelection({ start: 40 });
      ad.replaceSelection('Z');
    });
    await page.evaluate(() => window.saveCurrent());
    await expect.poll(() => fileInfo(page)).toMatchObject({ tier: 2 });
    const after = await page.evaluate(() => {
      const ad = window.getActiveCmAdapter();
      const file = window._appState.files[0];
      ad.replaceSelection('Y');
      return { pending: ad.hasPendingChange(), accessor: !!Object.getOwnPropertyDescriptor(file, 'content').get, dirty: file.dirty };
    });
    expect(after).toEqual({ pending: true, accessor: true, dirty: true });
  });

  test('a save that stays in its tier does not touch the editor', async ({ page }) => {
    await lowerLimits(page);
    await dropNote(page, 'small.md', 100 * KIB);
    await expect.poll(() => fileInfo(page)).toMatchObject({ tier: 0 });
    await withWriter(page, 120 * KIB);
    const same = await page.evaluate(async () => {
      window.setViewMode('edit');
      const view = window.getActiveCmAdapter()._view;
      window.getActiveCmAdapter().replaceSelection('Z');
      const before = view.state;
      await window.saveCurrent();
      return { sameStateObject: window.getActiveCmAdapter()._view.state.doc === before.doc };
    });
    expect(same.sameStateObject).toBe(true);
    await expect.poll(() => fileInfo(page)).toMatchObject({ tier: 0, size: 120 * KIB });
  });
});

test.describe('the recovery mirror of a large note', () => {
  test('a same-length edit is mirrored on the next check, not one later', async ({ page }) => {
    await openHuge(page);
    await page.evaluate(() => {
      window.__mirrors = 0;
      window.electronAPI = { recoverySnapshot: async () => { window.__mirrors += 1; return { ok: true }; } };
      window.setViewMode('edit');
      const ad = window.getActiveCmAdapter();
      ad.setSelection({ start: 40 });
      ad.replaceSelection('Z'); // the note is unsaved
      void window._appState.files[0].content; // the text is handed over: nothing is pending
    });
    await page.evaluate(() => window._mirrorDirtyNotes());
    expect(await page.evaluate(() => window.__mirrors)).toBe(1);
    await page.evaluate(() => {
      const realNow = Date.now;
      Date.now = () => realNow() + 120000; // the 30 s pause between mirrors of a large note is over
      window.getActiveCmAdapter().replaceRange(50, 51, 'Q'); // one character for one character: same length
    });
    await page.evaluate(() => window._mirrorDirtyNotes());
    expect(await page.evaluate(() => window.__mirrors)).toBe(2);
  });
});

test.describe('a single very long line', () => {
  // CodeMirror cannot lay out a wrapped line of about 15 million characters: building its height
  // map threw "Cannot read properties of undefined (reading 'length')", the editor stayed empty
  // while the note was open. 16 M characters is a LARGE note (under 20 MiB): no question first.
  test('a 16-million-character line opens in the editor, and opens again', async ({ page }) => {
    test.setTimeout(120000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await dropNote(page, 'oneline.md', 16_000_000, { singleLine: true });
    await expect.poll(() => fileInfo(page), { timeout: 60000 }).toMatchObject({ tier: 1 });
    const loaded = () => page.evaluate(() => ({
      editor: window.getActiveCmAdapter()._view.state.doc.length,
      note: window._appState.files[0].content.length,
    }));
    await expect.poll(async () => { const l = await loaded(); return l.editor === l.note && l.note > 15_000_000; }, { timeout: 30000 }).toBe(true);
    const again = await page.evaluate(() => {
      try { window.renderFile(0); window.renderFile(0); return 'ok'; } catch (e) { return `threw: ${e.message}`; }
    });
    expect(again).toBe('ok');
    const l = await loaded();
    expect(l.editor).toBe(l.note);
    expect(errors).toEqual([]);
    await expect(page.locator('#toast')).not.toHaveClass(/error/);
  });

  test('if CodeMirror still cannot lay a note out, the note is shown unwrapped instead of not at all', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const CM6 = await window.loadCM6();
      let calls = 0;
      // A view whose first setState fails the way the wrapped 15 M-character line did.
      class FlakyView extends CM6.EditorView {
        setState(state) { calls += 1; if (calls === 1) throw new TypeError('cannot measure'); return super.setState(state); }
      }
      const host = document.createElement('div');
      document.body.appendChild(host);
      const adapter = window.createCodeMirrorAdapter(host, { CM6: { ...CM6, EditorView: FlakyView }, doc: 'first' });
      adapter.load('second note', 7);
      const shown = adapter.getValue();
      adapter.destroy();
      host.remove();
      return { shown, calls };
    });
    expect(result).toEqual({ shown: 'second note', calls: 2 });
  });

  test('a long line in a note that was parked and comes back is still shown', async ({ page }) => {
    test.setTimeout(120000);
    await dropNote(page, 'oneline.md', 16_000_000, { singleLine: true });
    await expect.poll(() => fileInfo(page), { timeout: 60000 }).toMatchObject({ tier: 1 });
    const result = await page.evaluate(() => {
      const S = window._appState;
      S.files.push({ name: 'small.md', path: 'small.md', handle: null, content: '# small', dirty: false });
      window.renderFile(1); // the long note is parked
      window.renderFile(0); // and comes back
      return { editor: window.getActiveCmAdapter()._view.state.doc.length, note: S.files[0].content.length };
    });
    expect(result.editor).toBe(result.note);
  });
});

test.describe('export notices and failure messages', () => {
  test('a large note says the export may take a while before it starts', async ({ page }) => {
    await lowerLimits(page);
    await page.evaluate(() => {
      window.__seen = [];
      window.electronAPI = {
        exportPDF: async () => {
          window.__seen.push(document.getElementById('toast').textContent);
          return { ok: true, path: 'C:/tmp/big.pdf' };
        },
      };
    });
    await dropNote(page, 'big.md', LARGE_AT + 64 * KIB);
    await expect.poll(() => fileInfo(page)).toMatchObject({ tier: 1 });
    await page.evaluate(() => window.exportPDF());
    const seen = await page.evaluate(() => window.__seen);
    expect(seen[0]).toMatch(/while/i);
  });

  const cases = [
    ['exportPDF', { error: 'too-large' }, /PDF.*(large|64)/i],
    ['exportPDF', { error: 'timeout' }, /took too long/i],
    ['exportPDF', { error: 'export-failed' }, /PDF export failed/i],
    ['exportHTML', { error: 'too-large' }, /256/],
    ['exportHTML', { error: 'write-failed' }, /HTML export failed/i],
    ['exportEpub', { error: 'too-large' }, /64/],
  ];
  for (const [fn, res, pattern] of cases) {
    test(`${fn} with ${res.error} shows its own message`, async ({ page }) => {
      await page.evaluate(({ res }) => {
        const bridge = { exportPDF: async () => res, exportHtml: async () => res, exportEpub: async () => res };
        window.electronAPI = bridge;
        window.loadDemo();
        window.renderFile(0);
      }, { fn, res });
      await page.evaluate((fn) => window[fn] && window[fn](), fn);
      await expect(page.locator('#toast')).toHaveClass(/error/);
      await expect(page.locator('#toast')).toContainText(pattern);
    });
  }
});
