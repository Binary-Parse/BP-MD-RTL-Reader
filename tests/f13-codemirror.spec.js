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

  test('live-preview hides markdown markers on inactive lines, shows them on the active line', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app');
    const r = await page.evaluate(async () => {
      const CM6 = await window.loadCM6();
      const div = document.createElement('div');
      document.body.appendChild(div);
      const ad = window.createCodeMirrorAdapter(div, { CM6, doc: 'plain line one\n**bold word**' });
      const content = () => div.querySelector('.cm-content').textContent;
      const settle = () => new Promise((res) => setTimeout(res, 60));

      ad.setSelection({ start: 0, end: 0 });          // cursor on line 1 → line 2 (bold) is INACTIVE
      await settle();
      const inactive = content();

      const onBold = 'plain line one\n'.length + 3;    // cursor inside the bold on line 2 → ACTIVE
      ad.setSelection({ start: onBold, end: onBold });
      await settle();
      const active = content();

      ad.destroy();
      div.remove();
      return { inactive, active };
    });
    expect(r.inactive).not.toContain('**');        // markers hidden on the inactive line
    expect(r.inactive).toContain('bold word');     // content preserved (styled bold by syntax highlight)
    expect(r.active).toContain('**bold word**');   // raw markers shown on the active line for editing
  });

  test('live-preview hides heading (#) and inline-code (`) markers through the REAL engine', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app');
    const r = await page.evaluate(async () => {
      const CM6 = await window.loadCM6();
      const div = document.createElement('div');
      document.body.appendChild(div);
      const ad = window.createCodeMirrorAdapter(div, { CM6, doc: '# Title\na **b** and `c` d' });
      const content = () => div.querySelector('.cm-content').textContent;
      const settle = () => new Promise((res) => setTimeout(res, 60));

      ad.setSelection({ start: 0, end: 0 });          // cursor on line 1 → heading ACTIVE
      await settle();
      const onHeading = content();

      ad.setSelection({ start: 10, end: 10 });        // cursor on line 2 → emphasis/code ACTIVE
      await settle();
      const onBody = content();

      ad.destroy();
      div.remove();
      return { onHeading, onBody };
    });
    expect(r.onHeading).toContain('#');          // heading mark raw on its active line
    expect(r.onHeading).not.toContain('**');     // emphasis hidden on the inactive body line
    expect(r.onHeading).not.toContain('`');      // inline-code mark hidden on the inactive body line
    expect(r.onBody).not.toContain('#');         // heading mark hidden on the inactive heading line
    expect(r.onBody).toContain('**b**');         // emphasis raw on its active line
    expect(r.onBody).toContain('`c`');           // inline-code raw on its active line
  });

  test('typing new markdown (docChanged) re-hides once the cursor leaves; multi-line selection keeps both — no data loss', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app');
    const r = await page.evaluate(async () => {
      const CM6 = await window.loadCM6();
      const div = document.createElement('div');
      document.body.appendChild(div);
      const ad = window.createCodeMirrorAdapter(div, { CM6, doc: 'first line\nsecond line' });
      const content = () => div.querySelector('.cm-content').textContent;
      const settle = () => new Promise((res) => setTimeout(res, 60));
      const l2 = 'first line\n'.length; // 11 — start of line 2

      // select 'second line' and type bold over it — a REAL doc change (docChanged path)
      ad.setSelection({ start: l2, end: l2 + 'second line'.length });
      ad.replaceSelection('**bold**');
      await settle();
      const afterType = content();                 // cursor on line 2 (active) → markers shown

      ad.setSelection({ start: 0, end: 0 });        // move to line 1 → line 2 inactive
      await settle();
      const afterMove = content();                  // docChanged tree must re-hide the typed markers

      ad.setSelection({ start: 0, end: l2 + 4 });   // selection spans BOTH lines → both active
      await settle();
      const spanBoth = content();

      const value = ad.getValue();
      ad.destroy();
      div.remove();
      return { afterType, afterMove, spanBoth, value };
    });
    expect(r.afterType).toContain('**bold**');     // markers shown on the line just edited
    expect(r.afterMove).not.toContain('**');       // re-hidden once the line went inactive
    expect(r.afterMove).toContain('bold');         // content preserved (no data loss)
    expect(r.spanBoth).toContain('**bold**');      // a multi-line selection keeps markers on both lines
    expect(r.value).toBe('first line\n**bold**');  // the document text itself is intact
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
