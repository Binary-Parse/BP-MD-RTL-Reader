// @ts-check
/**
 * undo-history-per-file.spec.js — audit B1 (data loss).
 *
 * The CodeMirror undo history used to be one stack shared by every file, and loading a
 * file's text into the editor was itself an undoable change. Ctrl+Z right after a tab
 * switch put the PREVIOUS file's text into the current file and marked it dirty; autosave
 * then wrote it to disk.
 *
 * Rules (the spec, not derived from the code):
 *  1. Undo/redo never crosses a file boundary.
 *  2. Loading text into the editor (open, switch, reload) is not an undoable step.
 *  3. Each open file keeps its OWN undo history for the session.
 *  4. A file whose content was replaced from disk starts with an empty history.
 *  5. Closing a tab frees that file's history.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_URL = 'file:///' + path.resolve(__dirname, '../../src/renderer/index.html').replace(/\\/g, '/');

const note = (name, content) => ({ name, path: name, content, dirty: false, savedContent: content });

async function boot(page, notes) {
  await page.goto(INDEX_URL);
  await page.waitForSelector('#app');
  await page.waitForFunction(() => !!window._appState && !!window.getActiveCmAdapter, null, { timeout: 8000 });
  await page.evaluate((files) => {
    window._appState.files = files;
    window.setViewMode('edit');
    window.renderFile(0);
  }, notes);
  await page.waitForSelector('.cm-mount .cm-editor', { timeout: 8000 });
}

const value = (page) => page.evaluate(() => window.getActiveCmAdapter().getValue());
const fileState = (page, i) => page.evaluate((n) => {
  const f = window._appState.files[n];
  return { content: f.content, dirty: !!f.dirty };
}, i);
const tabDirty = (page, i) => page.evaluate((n) => document.querySelector(`.tab[data-file-idx="${n}"]`).classList.contains('dirty'), i);
const focusEnd = (page) => page.evaluate(() => {
  const ad = window.getActiveCmAdapter();
  const end = ad.getValue().length;
  ad.focus();
  ad.setSelection({ start: end, end });
});
async function typeAtEnd(page, text) {
  await focusEnd(page);
  await page.keyboard.type(text);
}
async function switchTo(page, i) {
  await page.click(`.tab[data-file-idx="${i}"]`);
  await page.waitForFunction((n) => window._appState.activeFile === n, i);
  await page.evaluate(() => window.getActiveCmAdapter().focus());
}
const undo = (page) => page.keyboard.press('Control+z');
const redo = (page) => page.keyboard.press('Control+y');

test.describe('[B1] undo/redo never crosses a file boundary', () => {
  test('audit reproduction: type in a.md, switch to b.md, Ctrl+Z leaves b.md as BBB and clean', async ({ page }) => {
    await boot(page, [note('a.md', 'AAA'), note('b.md', 'BBB')]);
    await typeAtEnd(page, ' more');
    expect(await value(page)).toBe('AAA more');
    await switchTo(page, 1);
    expect(await value(page)).toBe('BBB');

    await undo(page);

    expect(await value(page)).toBe('BBB');
    expect(await fileState(page, 1)).toEqual({ content: 'BBB', dirty: false });
    expect(await tabDirty(page, 1)).toBe(false);
    // a.md is untouched too
    expect(await fileState(page, 0)).toEqual({ content: 'AAA more', dirty: true });
  });

  test('Ctrl+Y (redo) after a switch does not change the new file either', async ({ page }) => {
    await boot(page, [note('a.md', 'AAA'), note('b.md', 'BBB')]);
    await typeAtEnd(page, ' more');
    await undo(page);
    expect(await value(page)).toBe('AAA');
    await switchTo(page, 1);

    await redo(page);

    expect(await value(page)).toBe('BBB');
    expect(await fileState(page, 1)).toEqual({ content: 'BBB', dirty: false });
    expect(await fileState(page, 0)).toEqual({ content: 'AAA', dirty: false });
  });
});

test.describe('[B1] loading text is not an undoable step', () => {
  test('Ctrl+Z straight after opening a file leaves its text and keeps the tab clean', async ({ page }) => {
    await boot(page, [note('a.md', 'AAA'), note('b.md', 'BBB')]);
    await page.evaluate(() => window.getActiveCmAdapter().focus());

    await undo(page);

    expect(await value(page)).toBe('AAA');
    expect(await fileState(page, 0)).toEqual({ content: 'AAA', dirty: false });
  });

  test('re-rendering the active file (as an external reload does) is not undoable', async ({ page }) => {
    await boot(page, [note('a.md', 'AAA'), note('b.md', 'BBB')]);
    await page.evaluate(() => {
      const f = window._appState.files[0];
      f.content = 'AAA from disk';
      f.savedContent = 'AAA from disk';
      window.renderFile(0);
      window.getActiveCmAdapter().focus();
    });
    expect(await value(page)).toBe('AAA from disk');

    await undo(page);

    expect(await value(page)).toBe('AAA from disk');
    expect(await fileState(page, 0)).toEqual({ content: 'AAA from disk', dirty: false });
  });
});

test.describe('[B1] each open file keeps its own history', () => {
  test('type in a.md, go to b.md and back, Ctrl+Z undoes a.md only; Ctrl+Y redoes it', async ({ page }) => {
    await boot(page, [note('a.md', 'AAA'), note('b.md', 'BBB')]);
    await typeAtEnd(page, ' more');
    await switchTo(page, 1);
    await switchTo(page, 0);
    expect(await value(page)).toBe('AAA more');

    await undo(page);
    expect(await value(page)).toBe('AAA');
    expect(await fileState(page, 0)).toEqual({ content: 'AAA', dirty: false });
    expect(await fileState(page, 1)).toEqual({ content: 'BBB', dirty: false });

    await redo(page);
    expect(await value(page)).toBe('AAA more');
    expect(await fileState(page, 0)).toEqual({ content: 'AAA more', dirty: true });
    expect(await fileState(page, 1)).toEqual({ content: 'BBB', dirty: false });
  });

  test('both files edited: undo in each one touches only that file', async ({ page }) => {
    await boot(page, [note('a.md', 'AAA'), note('b.md', 'BBB')]);
    await typeAtEnd(page, ' one');
    await switchTo(page, 1);
    await typeAtEnd(page, ' two');
    expect(await value(page)).toBe('BBB two');

    await switchTo(page, 0);
    await undo(page);
    expect(await value(page)).toBe('AAA');
    expect(await fileState(page, 1)).toEqual({ content: 'BBB two', dirty: true });

    await switchTo(page, 1);
    expect(await value(page)).toBe('BBB two');
    await undo(page);
    expect(await value(page)).toBe('BBB');
    expect(await fileState(page, 0)).toEqual({ content: 'AAA', dirty: false });
    expect(await fileState(page, 1)).toEqual({ content: 'BBB', dirty: false });
  });

  test('a switch does not break the per-file editor features (direction, typing after the switch)', async ({ page }) => {
    await boot(page, [note('a.md', 'AAA'), note('b.md', 'مرحبا')]);
    await switchTo(page, 1);
    expect(await page.evaluate(() => document.querySelector('.cm-mount .cm-editor .cm-line').getAttribute('dir'))).toBe('rtl');
    await typeAtEnd(page, ' x');
    expect(await value(page)).toBe('مرحبا x');
    expect(await fileState(page, 1)).toEqual({ content: 'مرحبا x', dirty: true });
    await switchTo(page, 0);
    expect(await page.evaluate(() => document.querySelector('.cm-mount .cm-editor .cm-line').getAttribute('dir'))).toBe('ltr');
    await typeAtEnd(page, '!');
    expect(await fileState(page, 0)).toEqual({ content: 'AAA!', dirty: true });
  });

  test('a rendered table widget keeps its direction after the round trip', async ({ page }) => {
    const table = '| أ | ب |\n|---|---|\n| 1 | 2 |\n\nنص';
    await boot(page, [note('a.md', table), note('b.md', 'BBB')]);
    const widgetDir = () => page.evaluate(() => {
      const t = document.querySelector('.cm-mount .cm-editor table');
      return t ? (t.closest('[dir]') || t).getAttribute('dir') : null;
    });
    const caretToEnd = () => page.evaluate(() => {
      const ad = window.getActiveCmAdapter();
      const end = ad.getValue().length;
      ad.setSelection({ start: end, end }); // off the table so it renders as a widget
    });
    await caretToEnd();
    await page.waitForSelector('.cm-mount .cm-editor table');
    expect(await widgetDir()).toBe('rtl');
    await switchTo(page, 1);
    await expect(page.locator('.cm-mount .cm-editor table')).toHaveCount(0);
    await switchTo(page, 0);
    await caretToEnd();
    await page.waitForSelector('.cm-mount .cm-editor table');
    expect(await widgetDir()).toBe('rtl');
  });
});

test.describe('[B1] a file replaced from disk starts with an empty history', () => {
  test('active file reloaded from disk: Ctrl+Z does not bring back the pre-reload text', async ({ page }) => {
    await boot(page, [note('a.md', 'AAA'), note('b.md', 'BBB')]);
    await typeAtEnd(page, ' more');
    await page.evaluate(() => {
      // what the vault watcher does for a clean-or-dirty file whose disk copy changed silently
      const files = window._appState.files;
      files[0] = { ...files[0], content: 'DISK', savedContent: 'DISK', dirty: false };
      window.renderFile(0);
      window.getActiveCmAdapter().focus();
    });
    expect(await value(page)).toBe('DISK');

    await undo(page);

    expect(await value(page)).toBe('DISK');
    expect(await fileState(page, 0)).toEqual({ content: 'DISK', dirty: false });
  });

  test('background file reloaded from disk: after switching back, Ctrl+Z keeps the disk text', async ({ page }) => {
    await boot(page, [note('a.md', 'AAA'), note('b.md', 'BBB')]);
    await typeAtEnd(page, ' more');
    await switchTo(page, 1);
    await page.evaluate(() => {
      const files = window._appState.files;
      files[0] = { ...files[0], content: 'DISK', savedContent: 'DISK', dirty: false };
    });
    await switchTo(page, 0);
    expect(await value(page)).toBe('DISK');

    await undo(page);

    expect(await value(page)).toBe('DISK');
    expect(await fileState(page, 0)).toEqual({ content: 'DISK', dirty: false });
  });

  test('conflict "Reload from disk": Ctrl+Z does not bring the discarded edits back', async ({ page }) => {
    await boot(page, [note('a.md', 'AAA'), note('b.md', 'BBB')]);
    await typeAtEnd(page, ' mine');
    await page.evaluate(() => {
      const f = window._appState.files[0];
      f.conflict = true;
      f.diskContent = 'DISK';
      window.renderFile(0);
    });
    await page.locator('#conflictBar .cf-reload').click();
    await page.waitForFunction(() => window.getActiveCmAdapter().getValue() === 'DISK');
    await page.evaluate(() => window.getActiveCmAdapter().focus());

    await undo(page);

    expect(await value(page)).toBe('DISK');
    expect(await fileState(page, 0)).toEqual({ content: 'DISK', dirty: false });
  });
});

test.describe('[B1] closing a tab frees its history', () => {
  test('stored histories follow the open tabs', async ({ page }) => {
    await boot(page, [note('a.md', 'AAA'), note('b.md', 'BBB'), note('c.md', 'CCC')]);
    const size = () => page.evaluate(() => window.getActiveCmAdapter()._historySize());
    await switchTo(page, 1);
    await switchTo(page, 2);
    expect(await size()).toBe(2); // a and b are parked; c is live in the editor

    await page.evaluate(() => window.closeTab(1)); // background tab b
    expect(await size()).toBe(1);

    await page.evaluate(() => window.closeTab(1)); // active tab c; a becomes live
    await page.waitForFunction(() => window.getActiveCmAdapter().getValue() === 'AAA');
    expect(await size()).toBe(0);
  });
});
