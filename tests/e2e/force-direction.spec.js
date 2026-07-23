// @ts-check
/**
 * force-direction.spec.js — the top-bar direction toggle (#rtlBtn) is a 3-state cycle
 * Auto → RTL → LTR → Auto, and a FORCED choice (RTL/LTR) overrides per-block auto-detection
 * for EVERY block — including a roughly half-and-half, English-led paragraph that Auto would
 * otherwise leave LTR. Regression target for the user report ("based on my selection it is RTL
 * or LTR from the top-bar icon").
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_URL = `file:///${path.resolve(__dirname, '../../src/renderer/index.html').replace(/\\/g, '/')}`;

// Heading + an English-led ~42% Arabic paragraph (Auto → ltr) + an Arabic-heavy paragraph (Auto → rtl).
const FIXTURE = '# Project Roadmap خطة\n\nName قيمة one واحد here\n\nمرحباً بالعالم هذا نص عربي طويل جداً للقراءة والفهم\n';

async function inject(page, content) {
  await page.evaluate((md) => {
    window._appState.files = [{ name: 'fixture.md', path: 'fixture.md', handle: null, content: md, dirty: false }];
    window.renderFile(0);
    document.getElementById('editorArea').classList.remove('cm-single', 'welcome'); // reveal #noteContent
  }, content);
}

const blockDirs = (page) => page.$$eval('#noteContent h1, #noteContent p', (els) => els.map((e) => e.getAttribute('dir')));
const getEditorComputedDirection = (page) => page.evaluate(() => getComputedStyle(document.getElementById('editor')).direction);

test.describe('force-direction toggle (Auto → RTL → LTR)', () => {
  test('Auto leaves the English-led half-and-half block LTR but the Arabic block RTL (per-block)', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');
    await inject(page, FIXTURE);
    await page.waitForTimeout(120);
    expect(await blockDirs(page)).toEqual(['ltr', 'ltr', 'rtl']); // heading, half-half para, arabic para
    expect(await page.locator('#dirIndicator').textContent()).toBe('LTR');
    expect(await page.locator('#rtlBtn').getAttribute('aria-pressed')).toBe('false');
  });

  test('one click forces RTL on EVERY block (including the half-and-half English-led paragraph)', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');
    await inject(page, FIXTURE);
    await page.click('#rtlBtn'); // Auto → RTL
    await page.waitForTimeout(120);
    expect(await blockDirs(page)).toEqual(['rtl', 'rtl', 'rtl']);
    await expect(page.locator('#editor')).toHaveAttribute('dir', 'rtl');
    expect(await page.locator('#dirIndicator').textContent()).toBe('RTL');
    expect(await page.locator('#rtlBtn').getAttribute('aria-pressed')).toBe('true');
    await expect(page.locator('#rtlBtn')).toHaveClass(/active/);
  });

  test('second click forces LTR on EVERY block (including the Arabic-heavy paragraph)', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');
    await inject(page, FIXTURE);
    await page.click('#rtlBtn'); // RTL
    await page.click('#rtlBtn'); // LTR
    await page.waitForTimeout(120);
    expect(await blockDirs(page)).toEqual(['ltr', 'ltr', 'ltr']); // every block forced ltr (incl. the Arabic one)
    // Forced LTR leaves the container neutral (ltr is the default); the per-block forcing is what matters.
    await expect(page.locator('#editor')).not.toHaveAttribute('dir');
    expect(await getEditorComputedDirection(page)).toBe('ltr');
    expect(await page.locator('#dirIndicator').textContent()).toBe('LTR');
    expect(await page.locator('#rtlBtn').getAttribute('aria-pressed')).toBe('true'); // still FORCED (user chose LTR)
  });

  test('third click returns to Auto (per-block detection; button no longer pressed)', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');
    await inject(page, FIXTURE);
    await page.click('#rtlBtn'); // RTL
    await page.click('#rtlBtn'); // LTR
    await page.click('#rtlBtn'); // Auto
    await page.waitForTimeout(120);
    expect(await blockDirs(page)).toEqual(['ltr', 'ltr', 'rtl']); // back to per-block
    await expect(page.locator('#editor')).not.toHaveAttribute('dir', 'rtl');
    expect(await page.locator('#rtlBtn').getAttribute('aria-pressed')).toBe('false');
    await expect(page.locator('#rtlBtn')).not.toHaveClass(/active/);
  });

  test('forcing RTL also flips the live CM6 editor lines (stale-base + rebuild fix)', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');
    // Seed but KEEP the CM6 surface visible (do not strip cm-single) so its lines are laid out.
    await page.evaluate(() => {
      window._appState.files = [{ name: 'f.md', path: 'f.md', handle: null, content: 'Name قيمة one واحد here\nمرحبا بالعالم', dirty: false }];
      window.renderFile(0);
    });
    await page.waitForSelector('.cm-line');
    await page.click('#rtlBtn'); // force RTL
    await page.waitForFunction(() => {
      const lines = [...document.querySelectorAll('.cm-line')];
      return lines.length > 0 && lines.every((l) => l.getAttribute('dir') === 'rtl');
    }, null, { timeout: 5000 });
  });
});
