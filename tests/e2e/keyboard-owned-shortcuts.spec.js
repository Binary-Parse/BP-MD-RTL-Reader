// @ts-check
/**
 * keyboard-owned-shortcuts.spec.js — audit H2 / H3.
 *
 * CodeMirror's defaultKeymap binds Mod-i (selectParentSyntax) and Mod-/ (toggleComment). CM6
 * handled the chord first, then the app's document handler ran on the changed selection:
 * Ctrl+I italicised the whole paragraph and Ctrl+/ commented the line out while it also opened
 * the shortcut sheet. The app owns both chords; the editor must not bind them.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_URL = 'file:///' + path.resolve(__dirname, '../../src/renderer/index.html').replace(/\\/g, '/');

async function open(page, content) {
  await page.goto(INDEX_URL);
  await page.waitForSelector('#app');
  await page.waitForFunction(() => !!window._appState && !!window.getActiveCmAdapter, null, { timeout: 8000 });
  await page.evaluate((c) => {
    window._appState.files = [{ name: 't.md', path: 't.md', content: c, dirty: false }];
    window.renderFile(0);
    window.setViewMode('edit');
  }, content);
  await page.waitForSelector('.cm-mount .cm-editor', { timeout: 8000 });
  await page.evaluate(() => window.getActiveCmAdapter().focus());
}
const val = (page) => page.evaluate(() => window.getActiveCmAdapter().getValue());
const caret = (page, p) => page.evaluate((p) => window.getActiveCmAdapter().setSelection({ start: p, end: p }), p);

test.describe('[H2] Ctrl+I belongs to the app, not to CodeMirror', () => {
  test('caret inside a word: only that word is italicised', async ({ page }) => {
    await open(page, 'hello brave world');
    await caret(page, 8); // inside "brave"
    await page.keyboard.press('Control+i');
    expect(await val(page)).toBe('hello *brave* world');
  });

  test('caret inside a word of a longer paragraph: neighbouring lines are untouched', async ({ page }) => {
    await open(page, 'first line\nhello brave world\nthird line');
    await caret(page, 11 + 8);
    await page.keyboard.press('Control+i');
    expect(await val(page)).toBe('first line\nhello *brave* world\nthird line');
  });

  test('bold word + Ctrl+I becomes bold-italic', async ({ page }) => {
    await open(page, '**word**');
    await caret(page, 4);
    await page.keyboard.press('Control+i');
    expect(await val(page)).toBe('***word***');
  });

  test('selection is italicised exactly as selected', async ({ page }) => {
    await open(page, 'hello brave world');
    await page.evaluate(() => window.getActiveCmAdapter().setSelection({ start: 0, end: 5 }));
    await page.keyboard.press('Control+i');
    expect(await val(page)).toBe('*hello* brave world');
  });
});

test.describe('[H3] Ctrl+/ opens the shortcut sheet and does not touch the document', () => {
  test('sheet opens, text is unchanged and the tab is not dirty', async ({ page }) => {
    await open(page, 'hello brave world\nsecond line');
    await caret(page, 3);
    await page.keyboard.press('Control+/');
    await expect(page.locator('#modalOverlay')).toHaveClass(/open/);
    expect(await val(page)).toBe('hello brave world\nsecond line');
    expect(await page.evaluate(() => window._appState.files[0].dirty)).toBeFalsy();
  });
});

test.describe('[M24] a shortcut is the key label, also on a French or German keyboard', () => {
  const chord = (page, key, code) => page.evaluate(({ key, code }) => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key, code, ctrlKey: true, bubbles: true, cancelable: true }));
  }, { key, code });
  const tabs = (page) => page.locator('#tabs .tab').count();

  test('French Ctrl+Z (physical W key) does not close the tab; French Ctrl+W does', async ({ page }) => {
    await open(page, 'hello');
    expect(await tabs(page)).toBe(1);
    await chord(page, 'z', 'KeyW');
    expect(await tabs(page)).toBe(1);
    await chord(page, 'w', 'KeyZ');
    await expect(page.locator('#tabs .tab')).toHaveCount(0);
  });

  test('German Ctrl+Z (physical Y key) undoes and does not redo', async ({ page }) => {
    await open(page, 'hello');
    await page.keyboard.type('X');
    expect(await val(page)).toBe('Xhello');
    await page.evaluate(() => {
      const target = document.querySelector('.cm-content');
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyY', keyCode: 90, ctrlKey: true, bubbles: true, cancelable: true }));
    });
    expect(await val(page)).toBe('hello');
  });

  test('Arabic layout: Ctrl+W on the physical W key still closes the tab', async ({ page }) => {
    await open(page, 'hello');
    await chord(page, 'ص', 'KeyW');
    await expect(page.locator('#tabs .tab')).toHaveCount(0);
  });
});

test.describe('[M25] the shortcuts the menus and the document promise', () => {
  // Two edits the editor's history keeps apart, then both undone.
  async function twoUndoneEdits(page) {
    await open(page, 'hello');
    await caret(page, 5);
    await page.keyboard.type(' one');
    await page.waitForTimeout(700); // deliberate: past CodeMirror's 500 ms grouping of typed text
    await page.keyboard.type(' two');
    expect(await val(page)).toBe('hello one two');
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    expect(await val(page)).toBe('hello');
  }

  test('Ctrl+Shift+Z redoes one step', async ({ page }) => {
    await twoUndoneEdits(page);
    await page.keyboard.press('Control+Shift+Z');
    expect(await val(page)).toBe('hello one');
    await page.keyboard.press('Control+Shift+Z');
    expect(await val(page)).toBe('hello one two');
  });

  test('Ctrl+Y redoes one step, not two', async ({ page }) => {
    await twoUndoneEdits(page);
    await page.keyboard.press('Control+y');
    expect(await val(page)).toBe('hello one');
  });

  test('Ctrl+L wraps the selection in a link and leaves the caret after the text', async ({ page }) => {
    await open(page, 'hello brave world');
    await page.evaluate(() => window.getActiveCmAdapter().setSelection({ start: 6, end: 11 }));
    await page.keyboard.press('Control+l');
    expect(await val(page)).toBe('hello [brave](url) world');
    expect(await page.evaluate(() => window.getActiveCmAdapter().getSelection().start)).toBe(12);
  });

  test('Ctrl+L inside the find field does not touch the note; Ctrl+Shift+L still changes the direction', async ({ page }) => {
    await open(page, 'hello brave world');
    await page.keyboard.press('Control+f');
    await page.locator('#findInput').focus();
    await page.keyboard.press('Control+l');
    expect(await val(page)).toBe('hello brave world');
    await page.keyboard.press('Escape');
    const before = await page.evaluate(() => document.querySelector('.cm-mount .cm-editor').getAttribute('dir'));
    await page.evaluate(() => window.getActiveCmAdapter().focus());
    await page.keyboard.press('Control+Shift+L');
    expect(await val(page)).toBe('hello brave world');
    const after = await page.evaluate(() => document.querySelector('.cm-mount .cm-editor').getAttribute('dir'));
    expect(after).not.toBe(before);
  });

  test('the shortcut sheet lists Reading / Edit with Ctrl+E', async ({ page }) => {
    await open(page, 'hello');
    await page.keyboard.press('Control+/');
    await expect(page.locator('#modalOverlay')).toHaveClass(/open/);
    // Each key of a chord is its own element, so the text reads "CtrlE".
    await expect(page.locator('#modalOverlay')).toContainText('Toggle Reading ModeCtrlE');
    await expect(page.locator('#modalOverlay')).toContainText('Insert LinkCtrlL');
  });
});
