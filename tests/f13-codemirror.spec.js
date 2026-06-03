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

  test('GFM strikethrough parses in CM6 and is hidden on inactive lines', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app');
    const r = await page.evaluate(async () => {
      const CM6 = await window.loadCM6();
      const div = document.createElement('div');
      document.body.appendChild(div);
      const ad = window.createCodeMirrorAdapter(div, { CM6, doc: 'plain line\n~~struck out~~' });
      const names = new Set();
      CM6.syntaxTree(ad._view.state).iterate({ enter: (n) => names.add(n.name) });
      const content = () => div.querySelector('.cm-content').textContent;
      const settle = () => new Promise((res) => setTimeout(res, 60));

      ad.setSelection({ start: 0, end: 0 }); // cursor line 1 → strikethrough line inactive
      await settle();
      const inactive = content();
      ad.setSelection({ start: 13, end: 13 }); // cursor inside line 2 → active
      await settle();
      const active = content();
      ad.destroy();
      div.remove();
      return { hasStrike: names.has('Strikethrough') && names.has('StrikethroughMark'), inactive, active };
    });
    expect(r.hasStrike).toBe(true);                 // GFM is parsing ~~ (commonmark would not)
    expect(r.inactive).not.toContain('~~');         // markers hidden on the inactive line
    expect(r.inactive).toContain('struck out');     // content preserved
    expect(r.active).toContain('~~struck out~~');   // raw markers on the active line
  });

  test('GFM tables parse in the CM6 source engine (pipes stay visible)', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app');
    const r = await page.evaluate(async () => {
      const CM6 = await window.loadCM6();
      const div = document.createElement('div');
      document.body.appendChild(div);
      const ad = window.createCodeMirrorAdapter(div, { CM6, doc: '| a | b |\n| - | - |\n| 1 | 2 |' });
      const names = new Set();
      CM6.syntaxTree(ad._view.state).iterate({ enter: (n) => names.add(n.name) });
      const text = div.querySelector('.cm-content').textContent;
      ad.destroy();
      div.remove();
      return { names: [...names], text };
    });
    expect(r.names).toContain('Table');             // GFM table parsed (commonmark → Paragraph only)
    expect(r.names).toContain('TableDelimiter');
    expect(r.text).toContain('|');                  // pipes are structural content — NOT hidden
  });

  test('live-preview collapses an inline link to its label on inactive lines (real engine)', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app');
    const r = await page.evaluate(async () => {
      const CM6 = await window.loadCM6();
      const div = document.createElement('div');
      document.body.appendChild(div);
      const ad = window.createCodeMirrorAdapter(div, { CM6, doc: 'see [the docs](https://example.com) now\nsecond line' });
      const content = () => div.querySelector('.cm-content').textContent;
      const settle = () => new Promise((res) => setTimeout(res, 60));

      ad.setSelection({ start: 45, end: 45 }); // cursor on line 2 → the link line is INACTIVE
      await settle();
      const inactive = content();
      const valueInactive = ad.getValue();

      ad.setSelection({ start: 6, end: 6 });   // cursor on the link line → ACTIVE (raw)
      await settle();
      const active = content();
      const valueActive = ad.getValue();
      ad.destroy();
      div.remove();
      return { inactive, active, valueInactive, valueActive };
    });
    expect(r.inactive).toContain('the docs');               // link label shown
    expect(r.inactive).not.toContain('https://example.com'); // URL hidden
    expect(r.inactive).not.toContain('](');                  // brackets/paren markers hidden
    expect(r.active).toContain('[the docs](https://example.com)'); // raw on the active line
    // the document text itself is never altered (no data loss)
    expect(r.valueInactive).toBe('see [the docs](https://example.com) now\nsecond line');
    expect(r.valueActive).toBe(r.valueInactive);
  });

  test('live-preview leaves autolinks <url> and images ![alt](url) raw on inactive lines (parent guard, real engine)', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app');
    const r = await page.evaluate(async () => {
      const CM6 = await window.loadCM6();
      const div = document.createElement('div');
      document.body.appendChild(div);
      // line1: inline link (collapses) · line2: autolink · line3: image · line4: cursor (so 1-3 are inactive)
      const doc = '[lbl](https://link.test)\n<https://auto.test>\n![alt text](https://img.test/x.png)\ncursor here';
      const ad = window.createCodeMirrorAdapter(div, { CM6, doc });
      const content = () => div.querySelector('.cm-content').textContent;
      await new Promise((res) => setTimeout(res, 60));
      ad.setSelection({ start: doc.length, end: doc.length }); // cursor on line 4 → lines 1-3 inactive
      await new Promise((res) => setTimeout(res, 60));
      const text = content();
      ad.destroy();
      div.remove();
      return { text };
    });
    // a real inline Link still collapses to its label…
    expect(r.text).toContain('lbl');
    expect(r.text).not.toContain('https://link.test');
    // …but an autolink's URL is its only visible text — it must NOT vanish
    expect(r.text).toContain('https://auto.test');
    // …and an image must stay raw (not collapse to bare alt): url + alt both survive
    expect(r.text).toContain('https://img.test/x.png');
    expect(r.text).toContain('alt text');
  });

  test('live-preview tracks a narrowed viewport on a long scrolled doc (visibleRanges + viewportChanged)', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app');
    const r = await page.evaluate(async () => {
      const CM6 = await window.loadCM6();
      const div = document.createElement('div');
      div.style.height = '200px';
      div.style.overflow = 'auto';
      div.style.contain = 'size';
      document.body.appendChild(div);
      // ~400 lines, every other line a bold marker.
      const lines = [];
      for (let i = 0; i < 400; i += 1) lines.push(i % 2 ? `**b${i}**` : `plain ${i}`);
      const ad = window.createCodeMirrorAdapter(div, { CM6, doc: lines.join('\n') });
      const view = ad._view;
      const raf = () => new Promise((res) => requestAnimationFrame(() => setTimeout(res, 60)));

      ad.setSelection({ start: 0, end: 0 });
      await raf();
      const len = view.state.doc.length;
      const narrowedAtStart = view.visibleRanges[view.visibleRanges.length - 1].to < len;

      view.dispatch({ effects: CM6.EditorView.scrollIntoView(len, { y: 'start' }) });
      view.scrollDOM.scrollTop = view.scrollDOM.scrollHeight;
      view.requestMeasure();
      await raf();
      await raf();

      const vpFrom = view.visibleRanges[0].from;
      const visibleText = div.querySelector('.cm-content').textContent;
      let atomsInViewport = 0;
      for (const get of view.state.facet(CM6.EditorView.atomicRanges)) {
        get(view).between(view.viewport.from, view.viewport.to, () => { atomsInViewport += 1; });
      }
      ad.destroy();
      div.remove();
      return { narrowedAtStart, vpFrom, visibleText, atomsInViewport };
    });
    expect(r.narrowedAtStart).toBe(true);        // virtualization is real (fails loudly if height not honored)
    expect(r.vpFrom).toBeGreaterThan(0);         // we scrolled past the top → viewportChanged fired
    expect(r.visibleText).not.toContain('**');   // inactive markers in the scrolled window are hidden
    expect(r.atomsInViewport % 2).toBe(0);       // markers come in '**'…'**' pairs (metric-independent)
  });

  test('atomicRanges make the caret step OVER a hidden marker (vs a no-live-preview control)', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app');
    const r = await page.evaluate(async () => {
      const CM6 = await window.loadCM6();
      const settle = () => new Promise((res) => setTimeout(res, 60));
      const doc = 'plain line\n**bold**';
      const l2 = 'plain line\n'.length; // 11 — start of the '**bold**' line

      const d1 = document.createElement('div'); document.body.appendChild(d1);
      const ad = window.createCodeMirrorAdapter(d1, { CM6, doc }); // livePreview default true
      const d2 = document.createElement('div'); document.body.appendChild(d2);
      const adPlain = window.createCodeMirrorAdapter(d2, { CM6, doc, livePreview: false }); // control

      ad.setSelection({ start: 0, end: 0 });       // caret on line 1 → line 2 '**' hidden + atomic
      adPlain.setSelection({ start: 0, end: 0 });
      await settle();

      // moveByChar is a PURE query — it does not dispatch, so line 2 never re-activates.
      const headLive = ad._view.moveByChar(CM6.EditorSelection.cursor(l2), true).head;
      const headCtrl = adPlain._view.moveByChar(CM6.EditorSelection.cursor(l2), true).head;
      const stillHidden = !d1.querySelector('.cm-content').textContent.includes('**');
      ad.destroy(); adPlain.destroy(); d1.remove(); d2.remove();
      return { headLive, headCtrl, stillHidden, l2 };
    });
    expect(r.stillHidden).toBe(true);            // the probe never activated line 2 (anti-flake)
    expect(r.headCtrl).toBe(r.l2 + 1);           // control: one step lands INSIDE the '**'
    expect(r.headLive).toBe(r.l2 + 2);           // live-preview: skips the whole atomic 2-char marker
  });

  test('hidden markers are registered as atomicRanges in the real editor (caret skips them)', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app');
    const r = await page.evaluate(async () => {
      const CM6 = await window.loadCM6();
      const div = document.createElement('div');
      document.body.appendChild(div);
      const ad = window.createCodeMirrorAdapter(div, { CM6, doc: 'plain line\n**bold**' });
      const settle = () => new Promise((res) => setTimeout(res, 60));
      ad.setSelection({ start: 0, end: 0 }); // cursor on line 1 → line 2 ** markers hidden
      await settle();
      // Count the atomic ranges the live editor actually exposes over the whole doc.
      let atoms = 0;
      for (const get of ad._view.state.facet(CM6.EditorView.atomicRanges)) {
        get(ad._view).between(0, ad._view.state.doc.length, () => { atoms += 1; });
      }
      ad.destroy();
      div.remove();
      return { atoms };
    });
    expect(r.atoms).toBe(2); // the two hidden '**' marks are atomic → the caret steps over them
  });

  test('live-preview swaps list/quote markers for widgets on inactive lines; ordered numbers + raw markers survive', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app');
    const r = await page.evaluate(async () => {
      const CM6 = await window.loadCM6();
      const div = document.createElement('div');
      document.body.appendChild(div);
      const ad = window.createCodeMirrorAdapter(div, { CM6, doc: 'para\n- bullet\n1. numbered\n> quote' });
      const content = () => div.querySelector('.cm-content').textContent;
      const settle = () => new Promise((res) => setTimeout(res, 60));

      ad.setSelection({ start: 0, end: 0 });      // cursor on line 1 → lines 2-4 INACTIVE
      await settle();
      const inactive = content();

      const onList = 'para\n'.length + 2;          // cursor on line 2 (the bullet list) → ACTIVE
      ad.setSelection({ start: onList, end: onList });
      await settle();
      const listActive = content();

      ad.destroy();
      div.remove();
      return { inactive, listActive };
    });
    // inactive lines: bullet '-' → '•', blockquote '>' → '▌', ordered '1.' stays raw
    expect(r.inactive).toContain('•');             // bullet widget rendered
    expect(r.inactive).toContain('▌');             // quote bar widget rendered
    expect(r.inactive).toContain('1. numbered');   // ordered marker NOT replaced (the number is content)
    expect(r.inactive).toContain('bullet');        // list text preserved
    expect(r.inactive).not.toContain('- bullet');  // raw bullet marker gone from the inactive line
    // cursor on the list line → it shows the RAW '-' marker again (no widget there)
    expect(r.listActive).toContain('- bullet');
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

  test('per-line direction: each CM6 line gets dir from its own first-strong char (R1/R2)', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app');
    const r = await page.evaluate(async () => {
      const CM6 = await window.loadCM6();
      const div = document.createElement('div');
      document.body.appendChild(div);
      const ad = window.createCodeMirrorAdapter(div, { CM6, doc: 'hello world\nمرحبا بالعالم' });
      await new Promise((res) => setTimeout(res, 60));
      const lines = [...div.querySelectorAll('.cm-line')];
      const view = ad._view;
      const out = {
        line1Dir: lines[0].getAttribute('dir'),
        line2Dir: lines[1].getAttribute('dir'),
        // CM6 Direction: LTR=0, RTL=1. perLineTextDirection makes this per-line.
        td1: view.textDirectionAt(view.state.doc.line(1).from),
        td2: view.textDirectionAt(view.state.doc.line(2).from),
      };
      ad.destroy();
      div.remove();
      return out;
    });
    expect(r.line1Dir).toBe('ltr');  // Latin line
    expect(r.line2Dir).toBe('rtl');  // Arabic line
    expect(r.td1).toBe(0);           // engine reads the Latin line as LTR
    expect(r.td2).toBe(1);           // …and the Arabic line as RTL (whole-editor base would give one value for both)
  });

  test('logical caret: the ArrowLeft key is direction-aware per line (EC-C2)', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app');
    // RTL line: pressing ArrowLeft (cursorCharLeft) moves FORWARD in reading order.
    await page.evaluate(async () => {
      const CM6 = await window.loadCM6();
      const d = document.createElement('div'); document.body.appendChild(d);
      window._rtlAd = window.createCodeMirrorAdapter(d, { CM6, doc: 'مرحبا' });
      window._rtlAd.setSelection({ start: 2, end: 2 });
      window._rtlAd._view.focus();
    });
    await page.keyboard.press('ArrowLeft');
    const rtlHead = await page.evaluate(() => window._rtlAd.getSelection().start);

    // LTR line: ArrowLeft moves BACK, as usual.
    await page.evaluate(() => {
      const d = document.createElement('div'); document.body.appendChild(d);
      window._ltrAd = window.createCodeMirrorAdapter(d, { CM6: window.CM6, doc: 'hello' });
      window._ltrAd.setSelection({ start: 2, end: 2 });
      window._ltrAd._view.focus();
    });
    await page.keyboard.press('ArrowLeft');
    const ltrHead = await page.evaluate(() => window._ltrAd.getSelection().start);

    await page.evaluate(() => { window._rtlAd.destroy(); window._ltrAd.destroy(); });
    expect(rtlHead).toBe(3); // RTL line: ArrowLeft advances (perLineTextDirection makes cursorCharLeft logical)
    expect(ltrHead).toBe(1); // LTR line: ArrowLeft retreats
  });
});
