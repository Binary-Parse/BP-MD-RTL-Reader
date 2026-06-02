// @ts-check
/**
 * f13-codemirror.spec.js — T-F13: the CodeMirror 6 source engine behind the EditorPort.
 * The textarea stays the DEFAULT (so default behaviour/snapshots are unchanged); CM6 is
 * opt-in via ?cm=1 and conforms to the same EditorPort contract.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_PATH = path.resolve(__dirname, '../index.html');
const INDEX_URL = `file:///${INDEX_PATH.replace(/\\/g, '/')}`;

test.describe('[T-F13] CodeMirror 6 editor (behind EditorPort)', () => {
  test('the CodeMirrorAdapter conforms to EditorPort and round-trips edits', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app');
    const r = await page.evaluate(async () => {
      const CM6 = await window.loadCM6();
      const div = document.createElement('div');
      document.body.appendChild(div);
      let lastChange = null;
      const ad = window.createCodeMirrorAdapter(div, { CM6, doc: '# Hello\nworld', onChange: (v) => { lastChange = v; } });
      const isPort = ['load', 'getValue', 'getSelection', 'setSelection', 'replaceSelection', 'onChange', 'find'].every((m) => typeof ad[m] === 'function');
      const value = ad.getValue();
      ad.setSelection({ start: 0, end: 7 }); // '# Hello'
      const sel = ad.getSelection();
      ad.replaceSelection('# Hi');
      const afterReplace = ad.getValue();
      const changed = lastChange;
      const findO = ad.find('o');
      ad.setDirection('rtl');
      const dir = ad._view.dom.getAttribute('dir');
      ad.load('new content');
      const loaded = ad.getValue();
      ad.destroy();
      div.remove();
      return { isPort, value, sel, afterReplace, changed, findO, dir, loaded };
    });
    expect(r.isPort).toBe(true);
    expect(r.value).toBe('# Hello\nworld');
    expect(r.sel).toEqual({ start: 0, end: 7 });
    expect(r.afterReplace).toBe('# Hi\nworld');
    expect(r.changed).toBe('# Hi\nworld');          // onChange fired on the edit
    expect(r.findO.length).toBeGreaterThanOrEqual(1); // 'world' contains 'o'
    expect(r.dir).toBe('rtl');                        // per-doc direction support
    expect(r.loaded).toBe('new content');
  });

  test('?cm=1 mounts CodeMirror as the source engine; editing syncs to the model', async ({ page }) => {
    await page.goto(INDEX_URL + '?cm=1');
    await page.waitForSelector('#app');
    await page.evaluate(() => window.loadDemo());
    await expect(page.locator('.cm-mount .cm-editor')).toHaveCount(1, { timeout: 8000 });
    expect(await page.evaluate(() => document.getElementById('srcTextarea').style.display)).toBe('none');

    await page.evaluate(() => window.setEditorMode('source'));
    await page.locator('.cm-mount .cm-content').click();
    await page.keyboard.type('ZZTOP');
    await page.waitForTimeout(60);
    const f = await page.evaluate(() => window._appState.files[window._appState.activeFile]);
    expect(f.content).toContain('ZZTOP'); // CM6 edit flowed through EditorPort → the model
    expect(f.dirty).toBe(true);
  });

  test('formatting (wrapSelection) in CM6 mode applies to the CM6 doc — CM6 edits are NOT lost', async ({ page }) => {
    await page.goto(INDEX_URL + '?cm=1');
    await page.waitForSelector('#app');
    await page.evaluate(() => {
      window._appState.files = [{ name: 'x.md', path: 'x.md', content: '', dirty: false }];
      window.setEditorMode('source');
      window.renderFile(0);
    });
    await expect(page.locator('.cm-mount .cm-editor')).toHaveCount(1, { timeout: 8000 });
    await page.locator('.cm-mount .cm-content').click();
    await page.keyboard.type('KEEPME');
    await page.waitForTimeout(50);
    await page.evaluate(() => window.wrapSelection('**', '**')); // toolbar/Ctrl+B path
    await page.waitForTimeout(50);
    const content = await page.evaluate(() => window._appState.files[0].content);
    expect(content).toContain('KEEPME'); // the CM6 edit survived (the bug overwrote it with the stale textarea)
    expect(content).toContain('**');     // and the formatting applied to the CM6 doc
  });

  test('toggleRTL flips the CM6 source editor direction', async ({ page }) => {
    await page.goto(INDEX_URL + '?cm=1');
    await page.waitForSelector('#app');
    await page.evaluate(() => window.loadDemo());
    await expect(page.locator('.cm-mount .cm-editor')).toHaveCount(1, { timeout: 8000 });
    await page.evaluate(() => window.toggleRTL());
    expect(await page.evaluate(() => document.querySelector('.cm-mount .cm-editor').getAttribute('dir'))).toBe('rtl');
  });

  test('default (no flag) keeps the textarea engine — CM6 is never loaded', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app');
    await page.evaluate(() => window.loadDemo());
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => typeof window.CM6)).toBe('undefined'); // lazy: not pulled in
    expect(await page.evaluate(() => document.querySelector('.cm-mount') === null)).toBe(true);
    expect(await page.evaluate(() => document.getElementById('srcTextarea').style.display)).not.toBe('none');
  });
});
