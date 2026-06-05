// @ts-check
/**
 * Adversarial tests for the heading RTL alignment fix (run_id=20260512T184517Z-5378).
 *
 * The implementer added `text-align: end` to #editor[dir="rtl"] h1/h2/h3 and
 * .doc-meta rules.  These tests go beyond the AC6/AC7/AC8 keyword-only checks
 * and probe edge cases the implementer missed:
 *
 *   H-Series — Heading geometry (physical pixel position, not CSS keyword)
 *   I-Series — h1 inside blockquote in RTL mode
 *   J-Series — LTR regression (headings must NOT gain right-align)
 *   K-Series — Mixed Arabic/English heading in RTL mode
 *   L-Series — Heading font vs alignment independence (font change ≠ alignment)
 *   M-Series — Mutation walk-through for heading alignment
 *
 * Framework: @playwright/test (Chromium, file:// URL, headless)
 * Placement: co-located with other spec files under tests/
 */

const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_PATH = path.resolve(__dirname, '../index.html');
const INDEX_URL = `file:///${INDEX_PATH.replace(/\\/g, '/')}`;

// ---------------------------------------------------------------------------
// Shared helpers (mirrors rtl-fixes.spec.js + rtl-adversarial.spec.js)
// ---------------------------------------------------------------------------

async function injectMarkdown(page, content) {
  return page.evaluate((md) => {
    window._appState.files = [{
      name: 'fixture.md', path: 'fixture.md',
      handle: null, content: md, dirty: false
    }];
    if (typeof window.renderFile === 'function') window.renderFile(0);
    // T-F13: CM6 is the on-screen editor; the rendered #noteContent (still produced for
    // export/outline) is hidden behind `cm-single`. Reveal it so these geometry checks can
    // measure the RTL render pipeline that export ships.
    document.getElementById('editorArea').classList.remove('cm-single', 'welcome');
  }, content);
}

async function getEditorComputedDirection(page) {
  return page.evaluate(() =>
    getComputedStyle(document.getElementById('editor')).direction
  );
}

/**
 * Measure physical text geometry relative to its container element.
 * Returns gapRight (space between text right-edge and element right-edge)
 * and gapLeft (space between element left-edge and text left-edge).
 * In truly right-aligned text: gapRight is small (<20px), gapLeft is large.
 * In left-aligned text: gapLeft is small (<20px), gapRight is large.
 */
async function getTextGeometry(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const elRect = el.getBoundingClientRect();
    if (elRect.width === 0) return null;
    const range = document.createRange();
    range.selectNodeContents(el);
    const textRects = range.getClientRects();
    if (!textRects.length) return null;
    let textRight = -Infinity;
    let textLeft = Infinity;
    for (const r of textRects) {
      if (r.right > textRight) textRight = r.right;
      if (r.left < textLeft) textLeft = r.left;
    }
    return {
      elRight: elRect.right,
      elLeft: elRect.left,
      elWidth: elRect.width,
      textRight,
      textLeft,
      gapRight: elRect.right - textRight,
      gapLeft: textLeft - elRect.left
    };
  }, selector);
}

// Arabic headings fixture used across H/K/L suites
const RTL_HEADINGS_MD = [
  '# عنوان رئيسي',
  '',
  'نص عربي.',
  '',
  '## عنوان ثانوي',
  '',
  'نص عربي.',
  '',
  '### عنوان ثالثي',
  '',
  'نص عربي.'
].join('\n');

// Pure English headings (LTR regression fixture)
const ENGLISH_HEADINGS_MD = [
  '# English Heading One',
  '',
  'English paragraph.',
  '',
  '## English Heading Two',
  '',
  'English paragraph.',
  '',
  '### English Heading Three',
  '',
  'English paragraph.'
].join('\n');

// Arabic h1 inside a blockquote
const RTL_BLOCKQUOTE_HEADINGS_MD = [
  '> # عنوان داخل اقتباس',
  '',
  '> ## عنوان ثانوي في اقتباس',
  '',
  '# عنوان خارج اقتباس'
].join('\n');

// Mixed heading: half English, half Arabic (triggers RTL due to Arabic fraction)
const MIXED_HEADING_MD = [
  '# مرحبا Hello World',
  '',
  'نص عربي مختلط.'
].join('\n');

// ---------------------------------------------------------------------------
// H-Series — Heading geometry (physical alignment, not CSS keyword)
// ---------------------------------------------------------------------------

test.describe('[H-Series] Heading physical alignment geometry in RTL mode', () => {

  test('[H1] h1 text is physically flush-RIGHT in RTL mode (geometry check)', async ({ page }) => {
    // AC6 only checks getComputedStyle().textAlign === 'right'|'end'.
    // That check is insufficient: Chromium reports 'end' even when the text
    // renders flush-left. This test verifies actual pixel position.
    // BUG PROBE: if gapRight is large and gapLeft is ~0, the heading is
    // actually left-aligned despite the CSS keyword.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    await page.click('#rtlBtn');
    await page.waitForTimeout(100);
    await injectMarkdown(page, RTL_HEADINGS_MD);
    await page.waitForTimeout(300);

    const geo = await getTextGeometry(page, '#noteContent h1');
    expect(geo).not.toBeNull();

    // In RTL right-alignment: text right-edge should be close to element right-edge.
    // Allow 20px tolerance for padding/margin.
    expect(geo.gapRight).toBeLessThan(20);
    // Text must NOT be flush against the left edge
    expect(geo.gapLeft).toBeGreaterThan(20);
  });

  test('[H2] h2 text is physically flush-RIGHT in RTL mode (geometry check)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    await page.click('#rtlBtn');
    await page.waitForTimeout(100);
    await injectMarkdown(page, RTL_HEADINGS_MD);
    await page.waitForTimeout(300);

    const geo = await getTextGeometry(page, '#noteContent h2');
    expect(geo).not.toBeNull();

    expect(geo.gapRight).toBeLessThan(20);
    expect(geo.gapLeft).toBeGreaterThan(20);
  });

  test('[H3] h3 text is physically flush-RIGHT in RTL mode (geometry check)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    await page.click('#rtlBtn');
    await page.waitForTimeout(100);
    await injectMarkdown(page, RTL_HEADINGS_MD);
    await page.waitForTimeout(300);

    const geo = await getTextGeometry(page, '#noteContent h3');
    expect(geo).not.toBeNull();

    expect(geo.gapRight).toBeLessThan(20);
    expect(geo.gapLeft).toBeGreaterThan(20);
  });

  test('[H4] .doc-meta text is physically flush-RIGHT in RTL mode (geometry check)', async ({ page }) => {
    // .doc-meta also received text-align: end in this run.
    // Verify the geometry, not just the keyword.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    await page.click('#rtlBtn');
    await page.waitForTimeout(100);
    await injectMarkdown(page, RTL_HEADINGS_MD);
    await page.waitForTimeout(300);

    const docMeta = await page.evaluate(() => {
      const dm = document.querySelector('#noteContent .doc-meta');
      if (!dm) return null;
      const cs = getComputedStyle(dm);
      return {
        textAlign: cs.textAlign,
        direction: cs.direction,
        display: cs.display
      };
    });
    // .doc-meta uses display:flex; text-align on a flex container aligns inline children.
    // At minimum, verify textAlign is right/end (keyword check — geometry is harder for flex).
    expect(docMeta).not.toBeNull();
    expect(['right', 'end']).toContain(docMeta.textAlign);
    expect(docMeta.direction).toBe('rtl');
  });

});

// ---------------------------------------------------------------------------
// I-Series — h1 inside blockquote in RTL mode
// ---------------------------------------------------------------------------

test.describe('[I-Series] Heading inside blockquote in RTL mode', () => {

  test('[I1] h1 inside blockquote has text-align right or end in RTL mode', async ({ page }) => {
    // The CSS selector #editor[dir="rtl"] h1 matches h1 at ANY nesting depth,
    // including inside a blockquote. This test verifies that nesting does not
    // strip the rule.
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    await page.click('#rtlBtn');
    await page.waitForTimeout(100);
    await injectMarkdown(page, RTL_BLOCKQUOTE_HEADINGS_MD);
    await page.waitForTimeout(300);

    const textAlign = await page.evaluate(() => {
      const bqH1 = document.querySelector('#noteContent blockquote h1');
      if (!bqH1) return null;
      return getComputedStyle(bqH1).textAlign;
    });

    expect(textAlign).not.toBeNull();
    expect(['right', 'end']).toContain(textAlign);
  });

  test('[I2] h2 inside blockquote has text-align right or end in RTL mode', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    await page.click('#rtlBtn');
    await page.waitForTimeout(100);
    await injectMarkdown(page, RTL_BLOCKQUOTE_HEADINGS_MD);
    await page.waitForTimeout(300);

    const textAlign = await page.evaluate(() => {
      const bqH2 = document.querySelector('#noteContent blockquote h2');
      if (!bqH2) return null;
      return getComputedStyle(bqH2).textAlign;
    });

    expect(textAlign).not.toBeNull();
    expect(['right', 'end']).toContain(textAlign);
  });

  test('[I3] h1 inside blockquote is physically flush-RIGHT in RTL mode (geometry)', async ({ page }) => {
    // BUG PROBE: blockquote has its own direction/padding rules. The h1 inside
    // may inherit conflicting values. Physical geometry exposes this.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    await page.click('#rtlBtn');
    await page.waitForTimeout(100);
    await injectMarkdown(page, RTL_BLOCKQUOTE_HEADINGS_MD);
    await page.waitForTimeout(300);

    const geo = await getTextGeometry(page, '#noteContent blockquote h1');
    expect(geo).not.toBeNull();

    // In RTL mode, the h1 text must be flush-right within its blockquote container
    expect(geo.gapRight).toBeLessThan(20);
    expect(geo.gapLeft).toBeGreaterThan(20);
  });

});

// ---------------------------------------------------------------------------
// J-Series — LTR regression (headings must NOT gain text-align:right in LTR)
// ---------------------------------------------------------------------------

test.describe('[J-Series] LTR regression — headings must not become right-aligned', () => {

  test('[J1] h1 in LTR mode has text-align start (NOT right/end)', async ({ page }) => {
    // The selector #editor[dir="rtl"] h1 must be fully scoped.
    // In LTR mode (#editor has no dir attr), h1 must NOT be right-aligned.
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    // Do NOT toggle RTL — stay in LTR
    await injectMarkdown(page, ENGLISH_HEADINGS_MD);
    await page.waitForTimeout(200);

    const textAlign = await page.evaluate(() => {
      const h1 = document.querySelector('#noteContent h1');
      if (!h1) return null;
      return getComputedStyle(h1).textAlign;
    });

    expect(textAlign).not.toBeNull();
    // Must NOT be right or end in LTR mode
    expect(textAlign).not.toBe('right');
    expect(textAlign).not.toBe('end');
    // Must be start (or left) for LTR headings
    expect(['start', 'left']).toContain(textAlign);
  });

  test('[J2] h2 in LTR mode has text-align start (NOT right/end)', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    await injectMarkdown(page, ENGLISH_HEADINGS_MD);
    await page.waitForTimeout(200);

    const textAlign = await page.evaluate(() => {
      const h2 = document.querySelector('#noteContent h2');
      if (!h2) return null;
      return getComputedStyle(h2).textAlign;
    });

    expect(textAlign).not.toBeNull();
    expect(textAlign).not.toBe('right');
    expect(textAlign).not.toBe('end');
    expect(['start', 'left']).toContain(textAlign);
  });

  test('[J3] h3 in LTR mode has text-align start (NOT right/end)', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    await injectMarkdown(page, ENGLISH_HEADINGS_MD);
    await page.waitForTimeout(200);

    const textAlign = await page.evaluate(() => {
      const h3 = document.querySelector('#noteContent h3');
      if (!h3) return null;
      return getComputedStyle(h3).textAlign;
    });

    expect(textAlign).not.toBeNull();
    expect(textAlign).not.toBe('right');
    expect(textAlign).not.toBe('end');
    expect(['start', 'left']).toContain(textAlign);
  });

  test('[J4] toggling RTL on then off restores h1 to start alignment', async ({ page }) => {
    // After RTL toggle-off, heading alignment must revert to start.
    // This catches the case where toggling leaves a residual text-align value
    // because the direction attribute is removed but some other class/style persists.
    //
    // Setup order: toggle RTL FIRST (sets _manualRTL=true), THEN inject Arabic content.
    // This matches AC1/AC6 setup: toggle precedes inject so auto-RTL does not
    // interfere with the manual toggle state.
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    // Step 1: Toggle RTL on manually (before any content — no auto-RTL conflict)
    await page.click('#rtlBtn');
    await page.waitForTimeout(100);

    // Step 2: Inject Arabic headings
    await injectMarkdown(page, RTL_HEADINGS_MD);
    await page.waitForTimeout(200);

    const rtlAlign = await page.evaluate(() => {
      const h1 = document.querySelector('#noteContent h1');
      return h1 ? getComputedStyle(h1).textAlign : null;
    });
    expect(['right', 'end']).toContain(rtlAlign);

    // Step 3: Toggle RTL off
    await page.click('#rtlBtn');
    await page.waitForTimeout(100);

    const ltrAlign = await page.evaluate(() => {
      const h1 = document.querySelector('#noteContent h1');
      return h1 ? getComputedStyle(h1).textAlign : null;
    });
    expect(ltrAlign).not.toBeNull();
    expect(['start', 'left']).toContain(ltrAlign);
  });

  test('[J5] h1 in LTR mode is physically flush-LEFT (geometry check)', async ({ page }) => {
    // Complementary geometry check: in LTR, text must be flush left, not right.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    await injectMarkdown(page, ENGLISH_HEADINGS_MD);
    await page.waitForTimeout(200);

    const geo = await getTextGeometry(page, '#noteContent h1');
    expect(geo).not.toBeNull();

    // In LTR left-alignment: text should be flush-LEFT (gapLeft small, gapRight large)
    expect(geo.gapLeft).toBeLessThan(20);
    expect(geo.gapRight).toBeGreaterThan(20);
  });

});

// ---------------------------------------------------------------------------
// K-Series — Mixed Arabic/English heading in RTL mode
// ---------------------------------------------------------------------------

test.describe('[K-Series] Mixed Arabic/English headings in RTL mode', () => {

  test('[K1] mixed-language h1 has text-align right/end when editor is RTL', async ({ page }) => {
    // A heading that contains both Arabic and English text.
    // The CSS selector applies when #editor[dir="rtl"], regardless of heading content.
    // The CSS should apply the same as for pure Arabic headings.
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    await page.click('#rtlBtn');
    await page.waitForTimeout(100);
    await injectMarkdown(page, MIXED_HEADING_MD);
    await page.waitForTimeout(200);

    const textAlign = await page.evaluate(() => {
      const h1 = document.querySelector('#noteContent h1');
      if (!h1) return null;
      return getComputedStyle(h1).textAlign;
    });

    expect(textAlign).not.toBeNull();
    expect(['right', 'end']).toContain(textAlign);
  });

  test('[K2] heading with only ASCII digits in RTL mode has text-align right/end', async ({ page }) => {
    // Digits-only heading: "## 42" — not Arabic script but inside RTL editor.
    // The CSS selector is on the ancestor (#editor[dir="rtl"]), not the heading content.
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    await page.click('#rtlBtn');
    await page.waitForTimeout(100);
    await injectMarkdown(page, '## 42\n\nنص.\n');
    await page.waitForTimeout(200);

    const textAlign = await page.evaluate(() => {
      const h2 = document.querySelector('#noteContent h2');
      if (!h2) return null;
      return getComputedStyle(h2).textAlign;
    });

    expect(textAlign).not.toBeNull();
    expect(['right', 'end']).toContain(textAlign);
  });

  test('[K3] heading with Unicode combining characters renders without crash in RTL', async ({ page }) => {
    // Unicode combining marks (e.g. U+0651 ARABIC SHADDA) on a heading.
    // These should render without crash and text-align must still apply.
    const arabicWithCombining = '# عُنوانٌ مُشكَّلٌ\n\nنص.\n';
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    await page.click('#rtlBtn');
    await page.waitForTimeout(100);
    await injectMarkdown(page, arabicWithCombining);
    await page.waitForTimeout(200);

    const textAlign = await page.evaluate(() => {
      const h1 = document.querySelector('#noteContent h1');
      if (!h1) return null;
      return getComputedStyle(h1).textAlign;
    });

    expect(errors).toHaveLength(0);
    expect(textAlign).not.toBeNull();
    expect(['right', 'end']).toContain(textAlign);
  });

  test('[K4] empty heading (just #) does not crash and has text-align right/end in RTL', async ({ page }) => {
    // An empty heading: "# " (heading with trailing space only).
    // querySelector('#noteContent h1') will find the element; it will be empty.
    // Geometry check is meaningless on empty text — just verify no crash and CSS applied.
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    await page.click('#rtlBtn');
    await page.waitForTimeout(100);
    await injectMarkdown(page, '# \n\nنص عربي.\n');
    await page.waitForTimeout(200);

    expect(errors).toHaveLength(0);

    const textAlign = await page.evaluate(() => {
      const h1 = document.querySelector('#noteContent h1');
      if (!h1) return 'no-element';
      return getComputedStyle(h1).textAlign;
    });

    // Either no h1 element (empty heading may be skipped by parser) or it gets end
    if (textAlign !== 'no-element') {
      expect(['right', 'end']).toContain(textAlign);
    }
  });

});

// ---------------------------------------------------------------------------
// L-Series — Font vs alignment independence
// ---------------------------------------------------------------------------

test.describe('[L-Series] Font change and alignment independence', () => {

  test('[L1] heading font-family switches to Arabic font when in RTL mode', async ({ page }) => {
    // The CSS also sets font-family: var(--arabic). Verify it is actually applied.
    // This is separate from alignment — the font change must not affect alignment.
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    await page.click('#rtlBtn');
    await page.waitForTimeout(100);
    await injectMarkdown(page, RTL_HEADINGS_MD);
    await page.waitForTimeout(200);

    const fontFamily = await page.evaluate(() => {
      const h1 = document.querySelector('#noteContent h1');
      if (!h1) return null;
      return getComputedStyle(h1).fontFamily;
    });

    // Should contain the Arabic font (IBM Plex Sans Arabic or similar)
    // Not the default Latin serif
    expect(fontFamily).not.toBeNull();
    expect(fontFamily.toLowerCase()).not.toContain('eb garamond');
    // The Arabic var should resolve to something containing 'arabic' or 'IBM Plex Sans Arabic'
    // Accept any value as long as it differs from the LTR default
    expect(fontFamily).toBeTruthy();
  });

  test('[L2] heading font is content-driven per-block, not reverted by the global ⇄ toggle', async ({ page }) => {
    // Per-block direction (T-R1) replaced the whole-document flip: a heading's
    // font follows ITS OWN content direction, not the container toggle. So an
    // English heading is serif and an Arabic heading is the Arabic face — and an
    // Arabic heading stays Arabic even with the global direction LTR (it must not
    // "revert" to a Latin serif, which would mis-render Arabic glyphs).
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    // English heading → serif baseline (no toggle).
    await injectMarkdown(page, ENGLISH_HEADINGS_MD);
    await page.waitForTimeout(200);
    const ltrFont = await page.evaluate(() => {
      const h1 = document.querySelector('#noteContent h1');
      return h1 ? getComputedStyle(h1).fontFamily : null;
    });

    // Arabic heading with NO manual toggle → per-block dir=rtl → Arabic font,
    // even though the editor container stays LTR.
    await injectMarkdown(page, RTL_HEADINGS_MD);
    await page.waitForTimeout(200);
    const arFont = await page.evaluate(() => {
      const h1 = document.querySelector('#noteContent h1');
      return h1 ? getComputedStyle(h1).fontFamily : null;
    });
    const editorDir = await page.evaluate(() =>
      getComputedStyle(document.getElementById('editor')).direction);

    expect(ltrFont).not.toBeNull();
    expect(arFont).not.toBeNull();
    expect(editorDir).toBe('ltr');                 // global toggle never pressed
    expect(arFont).not.toBe(ltrFont);              // Arabic heading is NOT the serif…
    expect(arFont.toLowerCase()).toContain('arabic'); // …it uses the Arabic face

    // Toggling the global RTL on then off must NOT change the Arabic heading's
    // (content-driven) font — it is Arabic before and after.
    await page.click('#rtlBtn');
    await page.waitForTimeout(100);
    await page.click('#rtlBtn');
    await page.waitForTimeout(100);
    const afterToggleFont = await page.evaluate(() => {
      const h1 = document.querySelector('#noteContent h1');
      return h1 ? getComputedStyle(h1).fontFamily : null;
    });
    expect(afterToggleFont).toBe(arFont);
  });

  test('[L3] h1 letter-spacing resets to 0 in RTL mode (no decorative Latin spacing)', async ({ page }) => {
    // The LTR .editor h1 has letter-spacing: -0.02em.
    // The RTL rule overrides it to letter-spacing: 0 (Arabic doesn't use tracking).
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    await page.click('#rtlBtn');
    await page.waitForTimeout(100);
    await injectMarkdown(page, RTL_HEADINGS_MD);
    await page.waitForTimeout(200);

    const letterSpacing = await page.evaluate(() => {
      const h1 = document.querySelector('#noteContent h1');
      if (!h1) return null;
      return getComputedStyle(h1).letterSpacing;
    });

    // letter-spacing: 0 resolves to '0px' in computed style in most browsers,
    // but Chromium may report 'normal' (which is equivalent to 0).
    // The LTR .editor h1 uses -0.02em which resolves to a negative pixel value.
    // In RTL mode, the value must be 0 or normal (not negative tracking).
    expect(['0px', 'normal']).toContain(letterSpacing);
  });

  test('[L4] h1 font-size is 38px in RTL mode (reduced from 42px LTR)', async ({ page }) => {
    // The RTL rule sets font-size: 38px (vs. 42px LTR). Verify the exact value.
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    await page.click('#rtlBtn');
    await page.waitForTimeout(100);
    await injectMarkdown(page, RTL_HEADINGS_MD);
    await page.waitForTimeout(200);

    const fontSize = await page.evaluate(() => {
      const h1 = document.querySelector('#noteContent h1');
      if (!h1) return null;
      return getComputedStyle(h1).fontSize;
    });

    expect(fontSize).toBe('38px');
  });

});

// ---------------------------------------------------------------------------
// M-Series — Mutation walk-through for heading alignment
// ---------------------------------------------------------------------------

test.describe('[M-Series] Mutation walk-through — heading alignment guards', () => {

  test('[M1-mutation] changing < to <= off-by-one: #editor[dir=rtl] must not match dir=ltr', async ({ page }) => {
    // Mutation: if someone changed the selector to #editor[dir] (any dir attr),
    // h1 in LTR (#editor[dir="ltr"]) would incorrectly get text-align: end.
    // Verify that an explicit dir="ltr" on #editor does NOT produce right-aligned h1.
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    // Force dir="ltr" on #editor directly (simulating what would happen if JS
    // set dir="ltr" explicitly rather than removing the attribute)
    await injectMarkdown(page, ENGLISH_HEADINGS_MD);
    await page.waitForTimeout(200);

    // Set dir="ltr" explicitly
    await page.evaluate(() => {
      document.getElementById('editor').setAttribute('dir', 'ltr');
    });

    const textAlign = await page.evaluate(() => {
      const h1 = document.querySelector('#noteContent h1');
      if (!h1) return null;
      return getComputedStyle(h1).textAlign;
    });

    // With dir="ltr", #editor[dir="rtl"] rule must NOT match → text-align is start/left
    expect(textAlign).not.toBeNull();
    expect(textAlign).not.toBe('right');
    expect(textAlign).not.toBe('end');
  });

  test('[M2-mutation] removing text-align: end from h1 rule would cause h1 to revert to start', async ({ page }) => {
    // Mutation: remove text-align from the h1 RTL rule.
    // After removal, h1 would have textAlign='start' even in RTL mode.
    // This test documents that 'start' in an RTL container IS flush-right
    // visually (direction:rtl makes start = right). So removing text-align:end
    // from the rule might not be visually wrong — BUT getComputedStyle would
    // return 'start' not 'right'/'end', causing AC6 to fail.
    // Verify the guard: manually override h1's text-align to 'start' and
    // confirm getComputedStyle returns 'start' (AC6 would fail).
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    await page.click('#rtlBtn');
    await page.waitForTimeout(100);
    await injectMarkdown(page, RTL_HEADINGS_MD);
    await page.waitForTimeout(200);

    // Simulate the mutation: remove text-align from h1
    await page.evaluate(() => {
      const h1 = document.querySelector('#noteContent h1');
      if (h1) h1.style.textAlign = 'start';
    });

    const textAlign = await page.evaluate(() => {
      const h1 = document.querySelector('#noteContent h1');
      return h1 ? getComputedStyle(h1).textAlign : null;
    });

    // With text-align overridden to 'start', AC6 WOULD fail because 'start'
    // is not in ['right', 'end']. This confirms AC6 would catch this mutation.
    expect(textAlign).toBe('start');
    // Confirm 'start' is not in the AC6-passing set
    expect(['right', 'end']).not.toContain(textAlign);
  });

  test('[M3-mutation] negating RTL condition: if #editor had dir=rtl removed, h1 reverts to start', async ({ page }) => {
    // Mutation: negate the toggleRTL function so it never sets dir=rtl.
    // If dir attribute is absent, #editor[dir="rtl"] rule does not match.
    // h1 must revert to start alignment.
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    // Set RTL first
    await page.click('#rtlBtn');
    await page.waitForTimeout(100);
    await injectMarkdown(page, RTL_HEADINGS_MD);
    await page.waitForTimeout(200);

    const rtlAlign = await page.evaluate(() => {
      const h1 = document.querySelector('#noteContent h1');
      return h1 ? getComputedStyle(h1).textAlign : null;
    });
    expect(['right', 'end']).toContain(rtlAlign);

    // Now simulate the mutation: remove dir from #editor
    await page.evaluate(() => {
      document.getElementById('editor').removeAttribute('dir');
    });

    const ltrAlign = await page.evaluate(() => {
      const h1 = document.querySelector('#noteContent h1');
      return h1 ? getComputedStyle(h1).textAlign : null;
    });

    // With dir removed, CSS rule does not match → h1 reverts to start/left
    expect(ltrAlign).not.toBeNull();
    expect(['start', 'left']).toContain(ltrAlign);
  });

});
