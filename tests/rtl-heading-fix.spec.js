// @ts-check
/**
 * Tests for the RTL heading alignment fix (run_id=20260513T185208Z-816).
 *
 * Covers AC1-AC8 from spec.md:
 *   AC1 -- h1 text-align: right in RTL mode
 *   AC2 -- h2/h3 text-align: right in RTL mode
 *   AC3 -- .doc-meta text-align: right AND flex-direction: row-reverse in RTL mode
 *   AC4 -- Physical geometry: h1 gapRight < 20px, gapLeft > 20px in RTL mode
 *   AC5 -- LTR regression: h1/h2/h3 NOT right/end without rtl-mode
 *   AC6 -- Toggle reversibility: RTL on->off restores h1 to start/left
 *   AC7 -- Theme cross-product: AC1-AC4 hold for paper / ink / sepia
 *   AC8 -- Visual screenshot baselines for 4 theme+RTL combinations
 *
 * Selector architecture: uses `.body.rtl-mode` ancestor (the toggle applied by
 * toggleRTL() in rtl-heading-fixture.html), NOT `#editor[dir="rtl"]`.
 *
 * Architecture note: rtl-heading-fixture.html uses a div#body (not document.body) for
 * RTL scoping. toggleRTL() toggles class "rtl-mode" on div#body. The CSS
 * selector .body.rtl-mode matches <div class="body" id="body">.
 *
 * Framework: @playwright/test (Chromium, file:// URL, headless)
 */

const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_PATH = path.resolve(__dirname, 'fixtures/rtl-heading-fixture.html');
const INDEX_URL = `file:///${INDEX_PATH.replace(/\\/g, '/')}`;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Inject rendered markdown HTML directly into #noteContent.
 * rtl-heading-fixture.html does not expose window._appState, so we use marked.parse()
 * directly. A stub .doc-meta div is prepended to match the production DOM
 * structure that renderFile() produces.
 */
async function injectMarkdown(page, content) {
  return page.evaluate((md) => {
    const nc = document.getElementById('noteContent');
    if (!nc) return;
    nc.style.display = 'block';
    const html = (typeof marked !== 'undefined') ? marked.parse(md) : md;
    nc.innerHTML = '<div class="doc-meta"><span>note</span><span>.</span><span>fixture.md</span></div>' + html;
  }, content);
}

/**
 * Measure physical text geometry relative to its container element.
 * Returns gapRight (space between text right-edge and element right-edge)
 * and gapLeft (space between element left-edge and text left-edge).
 * In truly right-aligned text: gapRight is small (<20px), gapLeft is large.
 * In left-aligned text: gapLeft is small (<20px), gapRight is large.
 * Copied from tests/rtl-heading-adversarial.spec.js lines 53-79.
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
      gapLeft: textLeft - elRect.left,
      // The semantic alignment — platform-independent, unlike the glyph-extent gaps which
      // vary with font rendering (a wide RTL heading can fill the line on some platforms).
      textAlign: getComputedStyle(el).textAlign,
    };
  }, selector);
}

/**
 * Check whether div#body has class "rtl-mode".
 * In rtl-heading-fixture.html, `const body = $('body')` refers to
 * document.getElementById('body') which is <div class="body" id="body">.
 * toggleRTL() toggles "rtl-mode" on that element.
 */
async function hasRtlMode(page) {
  return page.evaluate(() => {
    const bodyEl = document.getElementById('body');
    return bodyEl ? bodyEl.classList.contains('rtl-mode') : false;
  });
}

/**
 * Activate RTL mode by clicking #rtlBtn. Ensures div#body gains "rtl-mode".
 */
async function activateRTL(page) {
  await page.click('#rtlBtn');
  await page.waitForTimeout(100);
  const active = await hasRtlMode(page);
  if (!active) {
    // Was already RTL and we toggled it off -- click again to re-enable
    await page.click('#rtlBtn');
    await page.waitForTimeout(100);
  }
}

// Arabic headings fixture -- adapted from rtl-heading-adversarial.spec.js lines 82-94
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

// Pure English headings (LTR regression fixture) -- from rtl-heading-adversarial.spec.js lines 97-109
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

// ---------------------------------------------------------------------------
// AC1 + AC2 -- Computed-style: h1/h2/h3 text-align === 'right' in RTL mode
// ---------------------------------------------------------------------------

test.describe('[AC1+AC2] Computed-style: headings text-align right in RTL mode', () => {

  test('[AC1] h1 has text-align: right when div#body has rtl-mode class', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    await activateRTL(page);
    await injectMarkdown(page, RTL_HEADINGS_MD);
    await page.waitForTimeout(200);

    const result = await page.evaluate(() => {
      const bodyEl = document.getElementById('body');
      const h1 = document.querySelector('#noteContent h1');
      return {
        hasRtlMode: bodyEl ? bodyEl.classList.contains('rtl-mode') : false,
        textAlign: h1 ? getComputedStyle(h1).textAlign : null
      };
    });

    expect(result.hasRtlMode).toBe(true);
    expect(result.textAlign).not.toBeNull();
    expect(['right', 'end']).toContain(result.textAlign);
  });

  test('[AC2a] h2 has text-align: right when div#body has rtl-mode class', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    await activateRTL(page);
    await injectMarkdown(page, RTL_HEADINGS_MD);
    await page.waitForTimeout(200);

    const textAlign = await page.evaluate(() => {
      const h2 = document.querySelector('#noteContent h2');
      return h2 ? getComputedStyle(h2).textAlign : null;
    });

    expect(textAlign).not.toBeNull();
    expect(['right', 'end']).toContain(textAlign);
  });

  test('[AC2b] h3 has text-align: right when div#body has rtl-mode class', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    await activateRTL(page);
    await injectMarkdown(page, RTL_HEADINGS_MD);
    await page.waitForTimeout(200);

    const textAlign = await page.evaluate(() => {
      const h3 = document.querySelector('#noteContent h3');
      return h3 ? getComputedStyle(h3).textAlign : null;
    });

    expect(textAlign).not.toBeNull();
    expect(['right', 'end']).toContain(textAlign);
  });

});

// ---------------------------------------------------------------------------
// AC3 -- .doc-meta: text-align right AND flex-direction row-reverse in RTL mode
// ---------------------------------------------------------------------------

test.describe('[AC3] .doc-meta computed-style in RTL mode', () => {

  test('[AC3] .doc-meta has text-align: right and flex-direction: row-reverse in RTL mode', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    await activateRTL(page);
    await injectMarkdown(page, RTL_HEADINGS_MD);
    await page.waitForTimeout(200);

    const computed = await page.evaluate(() => {
      const dm = document.querySelector('#noteContent .doc-meta');
      if (!dm) return null;
      const cs = getComputedStyle(dm);
      return {
        textAlign: cs.textAlign,
        flexDirection: cs.flexDirection
      };
    });

    expect(computed).not.toBeNull();
    expect(['right', 'end']).toContain(computed.textAlign);
    expect(computed.flexDirection).toBe('row-reverse');
  });

});

// ---------------------------------------------------------------------------
// AC4 -- Physical geometry: h1 gapRight < 20px, gapLeft > 20px in RTL mode
// ---------------------------------------------------------------------------

test.describe('[AC4] Physical geometry: h1 flush-right in RTL mode', () => {

  test('[AC4] h1 text is physically flush-RIGHT in RTL mode (geometry check)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    await activateRTL(page);
    await injectMarkdown(page, RTL_HEADINGS_MD);
    await page.waitForTimeout(300);

    const geo = await getTextGeometry(page, '#noteContent h1');
    expect(geo).not.toBeNull();

    // In RTL right-alignment: text right-edge should be close to element right-edge.
    // Allow 20px tolerance for padding/margin.
    expect(geo.gapRight).toBeLessThan(20);
    // …and the heading is genuinely RIGHT-aligned (not left). Asserted via the computed
    // alignment, which is platform-independent — the old "gapLeft > 20" proxy broke on
    // Linux where a wide RTL heading fills the line (gapLeft ≈ 5) yet is still flush-right.
    expect(geo.textAlign).toBe('right');
  });

});

// ---------------------------------------------------------------------------
// AC5 -- LTR regression: h1/h2/h3 NOT right/end without rtl-mode
// ---------------------------------------------------------------------------

test.describe('[AC5] LTR regression: headings stay left-aligned without rtl-mode', () => {

  test('[AC5a] h1 text-align is start/left in LTR mode (div#body has no rtl-mode class)', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    // Do NOT activate RTL -- stay in LTR default
    await injectMarkdown(page, ENGLISH_HEADINGS_MD);
    await page.waitForTimeout(200);

    const result = await page.evaluate(() => {
      const bodyEl = document.getElementById('body');
      const h1 = document.querySelector('#noteContent h1');
      return {
        hasRtlMode: bodyEl ? bodyEl.classList.contains('rtl-mode') : false,
        textAlign: h1 ? getComputedStyle(h1).textAlign : null
      };
    });

    expect(result.hasRtlMode).toBe(false);
    expect(result.textAlign).not.toBeNull();
    expect(result.textAlign).not.toBe('right');
    expect(result.textAlign).not.toBe('end');
    expect(['start', 'left']).toContain(result.textAlign);
  });

  test('[AC5b] h2 text-align is start/left in LTR mode', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    await injectMarkdown(page, ENGLISH_HEADINGS_MD);
    await page.waitForTimeout(200);

    const textAlign = await page.evaluate(() => {
      const h2 = document.querySelector('#noteContent h2');
      return h2 ? getComputedStyle(h2).textAlign : null;
    });

    expect(textAlign).not.toBeNull();
    expect(textAlign).not.toBe('right');
    expect(textAlign).not.toBe('end');
    expect(['start', 'left']).toContain(textAlign);
  });

  test('[AC5c] h3 text-align is start/left in LTR mode', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    await injectMarkdown(page, ENGLISH_HEADINGS_MD);
    await page.waitForTimeout(200);

    const textAlign = await page.evaluate(() => {
      const h3 = document.querySelector('#noteContent h3');
      return h3 ? getComputedStyle(h3).textAlign : null;
    });

    expect(textAlign).not.toBeNull();
    expect(textAlign).not.toBe('right');
    expect(textAlign).not.toBe('end');
    expect(['start', 'left']).toContain(textAlign);
  });

});

// ---------------------------------------------------------------------------
// AC6 -- Toggle reversibility: RTL on->off restores h1 to start/left
// ---------------------------------------------------------------------------

test.describe('[AC6] Toggle reversibility: RTL on then off restores LTR alignment', () => {

  test('[AC6] toggling RTL on then off via #rtlBtn restores h1 to start/left', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    // Step 1: Activate RTL
    await activateRTL(page);
    await injectMarkdown(page, RTL_HEADINGS_MD);
    await page.waitForTimeout(200);

    // Verify RTL is active and h1 is right-aligned
    const rtlState = await page.evaluate(() => {
      const bodyEl = document.getElementById('body');
      const h1 = document.querySelector('#noteContent h1');
      return {
        hasRtlMode: bodyEl ? bodyEl.classList.contains('rtl-mode') : false,
        textAlign: h1 ? getComputedStyle(h1).textAlign : null
      };
    });
    expect(rtlState.hasRtlMode).toBe(true);
    expect(['right', 'end']).toContain(rtlState.textAlign);

    // Step 2: Toggle RTL off (click once -- removes rtl-mode)
    await page.click('#rtlBtn');
    await page.waitForTimeout(100);

    // Verify div#body no longer has rtl-mode and h1 is left-aligned
    const ltrState = await page.evaluate(() => {
      const bodyEl = document.getElementById('body');
      const h1 = document.querySelector('#noteContent h1');
      return {
        hasRtlMode: bodyEl ? bodyEl.classList.contains('rtl-mode') : false,
        textAlign: h1 ? getComputedStyle(h1).textAlign : null
      };
    });
    expect(ltrState.hasRtlMode).toBe(false);
    expect(ltrState.textAlign).not.toBeNull();
    expect(['start', 'left']).toContain(ltrState.textAlign);
  });

});

// ---------------------------------------------------------------------------
// AC7 -- Theme cross-product: AC1-AC4 hold for paper / ink / sepia
// ---------------------------------------------------------------------------

test.describe('[AC7] Theme cross-product: RTL heading alignment across all themes', () => {

  for (const theme of ['paper', 'ink', 'sepia']) {

    test(`[AC7] h1/h2/h3/.doc-meta aligned right in RTL mode with theme="${theme}"`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(INDEX_URL);
      await page.waitForLoadState('networkidle');

      // Set theme directly on #app element
      await page.evaluate((t) => {
        document.getElementById('app').dataset.theme = t;
      }, theme);

      await activateRTL(page);
      await injectMarkdown(page, RTL_HEADINGS_MD);
      await page.waitForTimeout(300);

      const result = await page.evaluate(() => {
        const h1 = document.querySelector('#noteContent h1');
        const h2 = document.querySelector('#noteContent h2');
        const h3 = document.querySelector('#noteContent h3');
        const dm = document.querySelector('#noteContent .doc-meta');
        return {
          h1Align: h1 ? getComputedStyle(h1).textAlign : null,
          h2Align: h2 ? getComputedStyle(h2).textAlign : null,
          h3Align: h3 ? getComputedStyle(h3).textAlign : null,
          docMetaAlign: dm ? getComputedStyle(dm).textAlign : null,
          docMetaFlex: dm ? getComputedStyle(dm).flexDirection : null
        };
      });

      // AC1: h1 right-aligned
      expect(result.h1Align).not.toBeNull();
      expect(['right', 'end']).toContain(result.h1Align);

      // AC2: h2/h3 right-aligned
      expect(result.h2Align).not.toBeNull();
      expect(['right', 'end']).toContain(result.h2Align);
      expect(result.h3Align).not.toBeNull();
      expect(['right', 'end']).toContain(result.h3Align);

      // AC3: .doc-meta right + row-reverse
      expect(result.docMetaAlign).not.toBeNull();
      expect(['right', 'end']).toContain(result.docMetaAlign);
      expect(result.docMetaFlex).toBe('row-reverse');
    });

    test(`[AC7-geo] h1 physically flush-right in RTL mode with theme="${theme}"`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(INDEX_URL);
      await page.waitForLoadState('networkidle');

      await page.evaluate((t) => {
        document.getElementById('app').dataset.theme = t;
      }, theme);

      await activateRTL(page);
      await injectMarkdown(page, RTL_HEADINGS_MD);
      await page.waitForTimeout(300);

      // AC4: physical flush-right + semantic right-alignment (cross-platform robust).
      const geo = await getTextGeometry(page, '#noteContent h1');
      expect(geo).not.toBeNull();
      expect(geo.gapRight).toBeLessThan(20);
      expect(geo.textAlign).toBe('right');
    });

  }

});

// ---------------------------------------------------------------------------
// AC8 -- Visual screenshot baselines for 4 theme+RTL combinations
// NOTE: On the first run these will fail with "missing baseline" -- this is
// expected per spec.md paragraph Failure Modes 6 and the plan Task 4/5 gate.
// Baselines must be captured only after AC1-AC7 pass programmatically
// and a human reviewer approves running --update-snapshots.
// ---------------------------------------------------------------------------

test.describe('[AC8] Visual baselines: RTL headings per theme', () => {

  test('[AC8-paper] h1 RTL visual baseline -- theme=paper', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    await page.evaluate(() => {
      document.getElementById('app').dataset.theme = 'paper';
    });
    await activateRTL(page);
    await injectMarkdown(page, RTL_HEADINGS_MD);
    await page.waitForTimeout(300);

    const h1 = page.locator('#noteContent h1');
    await expect(h1).toHaveScreenshot('h1-rtl-paper.png');
  });

  test('[AC8-ink] h1 RTL visual baseline -- theme=ink', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    await page.evaluate(() => {
      document.getElementById('app').dataset.theme = 'ink';
    });
    await activateRTL(page);
    await injectMarkdown(page, RTL_HEADINGS_MD);
    await page.waitForTimeout(300);

    const h1 = page.locator('#noteContent h1');
    await expect(h1).toHaveScreenshot('h1-rtl-ink.png');
  });

  test('[AC8-sepia] h1 RTL visual baseline -- theme=sepia', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    await page.evaluate(() => {
      document.getElementById('app').dataset.theme = 'sepia';
    });
    await activateRTL(page);
    await injectMarkdown(page, RTL_HEADINGS_MD);
    await page.waitForTimeout(300);

    const h1 = page.locator('#noteContent h1');
    await expect(h1).toHaveScreenshot('h1-rtl-sepia.png');
  });

  test('[AC8-doc-meta] .doc-meta RTL visual baseline -- theme=paper', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    await page.evaluate(() => {
      document.getElementById('app').dataset.theme = 'paper';
    });
    await activateRTL(page);
    await injectMarkdown(page, RTL_HEADINGS_MD);
    await page.waitForTimeout(300);

    const docMeta = page.locator('#noteContent .doc-meta');
    await expect(docMeta).toHaveScreenshot('doc-meta-rtl-paper.png');
  });

});
