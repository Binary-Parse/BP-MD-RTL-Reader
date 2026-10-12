// @ts-check
/**
 * rtl-direction-high.spec.js — audit H4 / H5 / H6 / H7 through the real render pipeline
 * (markdown -> callout transform -> bidi -> outline), AUTO direction mode.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_URL = 'file:///' + path.resolve(__dirname, '../../src/renderer/index.html').replace(/\\/g, '/');

async function render(page, md) {
  await page.goto(INDEX_URL);
  await page.waitForSelector('#app');
  await page.waitForFunction(() => !!window._appState && !!window.renderFile, null, { timeout: 8000 });
  await page.evaluate((c) => {
    window._appState.files = [{ name: 'doc.md', path: 'doc.md', handle: null, content: c, dirty: false }];
    window.renderFile(0);
    document.getElementById('editorArea').classList.remove('cm-single', 'welcome');
  }, md);
  await page.waitForSelector('#noteContent h1, #noteContent p, #noteContent ul, #noteContent .callout');
}

test.describe('[H4] a heading whose first strong character is Arabic is RTL, with Latin terms', () => {
  const HEADINGS = [
    ['# تثبيت Docker على Windows', 'rtl'],
    ['## كيف تستخدم TypeScript مع React', 'rtl'],
    ['### استخدام Git و GitHub', 'rtl'],
    ['#### API دليل المستخدم', 'rtl'],
    ['##### Install Docker on Windows', 'ltr'],
    ['###### Docker is كبير', 'ltr'],
  ];
  test('headings and their outline entries agree', async ({ page }) => {
    await render(page, HEADINGS.map(([h]) => h).join('\n\n') + '\n');
    for (let i = 0; i < HEADINGS.length; i++) {
      const [md, expected] = HEADINGS[i];
      const level = md.indexOf(' ');
      const heading = page.locator(`#noteContent h${level}`);
      await expect(heading, md).toHaveAttribute('dir', expected);
      expect(await heading.evaluate((el) => getComputedStyle(el).direction), md).toBe(expected);
    }
    const items = page.locator('#tocList .toc-item');
    await expect(items).toHaveCount(HEADINGS.length);
    for (let i = 0; i < HEADINGS.length; i++) {
      await expect(items.nth(i), HEADINGS[i][0]).toHaveAttribute('dir', HEADINGS[i][1]);
    }
  });
});

test.describe('[H5] Arabic lists keep their bullets inside the text column', () => {
  test('an all-Arabic list is rtl and its marker gutter sits on the right', async ({ page }) => {
    await render(page, '- عنصر أول\n- عنصر ثان\n- عنصر ثالث\n\n1. بند أول\n2. بند ثان\n');
    for (const sel of ['#noteContent ul', '#noteContent ol']) {
      const list = page.locator(sel).first();
      await expect(list).toHaveAttribute('dir', 'rtl');
      const g = await list.evaluate((ul) => {
        const li = ul.querySelector('li');
        const u = ul.getBoundingClientRect(); const l = li.getBoundingClientRect();
        const cs = getComputedStyle(ul);
        return { gutterRight: u.right - l.right, gutterLeft: l.left - u.left, padRight: parseFloat(cs.paddingRight), padLeft: parseFloat(cs.paddingLeft) };
      });
      expect(g.padRight).toBeGreaterThanOrEqual(20);
      expect(g.padLeft).toBeLessThan(5);
      expect(g.gutterRight).toBeGreaterThanOrEqual(20); // bullets live in this gutter (inline-start = right)
      expect(g.gutterLeft).toBeLessThan(5);
    }
  });

  test('an English list is ltr with the gutter on the left; a nested English list inside an Arabic item is ltr', async ({ page }) => {
    await render(page, '- English one\n- English two\n\nseparator\n\n- عنصر عربي\n  - child one\n  - child two\n');
    const lists = page.locator('#noteContent ul');
    await expect(lists.nth(0)).toHaveAttribute('dir', 'ltr');
    const g = await lists.nth(0).evaluate((ul) => {
      const l = ul.querySelector('li').getBoundingClientRect(); const u = ul.getBoundingClientRect();
      return { gutterLeft: l.left - u.left, gutterRight: u.right - l.right };
    });
    expect(g.gutterLeft).toBeGreaterThanOrEqual(20);
    expect(g.gutterRight).toBeLessThan(5);
    await expect(lists.nth(1)).toHaveAttribute('dir', 'rtl');
    await expect(lists.nth(2)).toHaveAttribute('dir', 'ltr');
  });
});

test.describe('[H6] an Arabic list item with English children keeps its own direction', () => {
  test('parent rtl, children ltr', async ({ page }) => {
    await render(page, '- API عنصر عربي طويل\n  - First English child\n  - Second English child\n');
    const items = page.locator('#noteContent li');
    await expect(items.nth(0)).toHaveAttribute('dir', 'rtl');
    await expect(items.nth(1)).toHaveAttribute('dir', 'ltr');
    await expect(items.nth(2)).toHaveAttribute('dir', 'ltr');
  });
});

test.describe('[H7] a short Arabic callout with the default title is RTL', () => {
  test('> [!WARNING] + Arabic body', async ({ page }) => {
    await render(page, '> [!WARNING]\n> انتبه\n');
    const c = page.locator('#noteContent .callout');
    await expect(c).toHaveAttribute('dir', 'rtl');
    expect(await c.evaluate((el) => getComputedStyle(el).direction)).toBe('rtl');
    // audit M21: the default title of an Arabic callout is the Arabic name of its type.
    await expect(c.locator('.callout-title-text')).toHaveText('تحذير');
  });

  test('custom Arabic title and English default-title body keep their direction', async ({ page }) => {
    await render(page, '> [!NOTE] ملاحظة مهمة\n> text in English\n\n> [!TIP]\n> Remember to save\n');
    await expect(page.locator('#noteContent .callout').nth(0)).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('#noteContent .callout').nth(1)).toHaveAttribute('dir', 'ltr');
  });
});

test.describe('[H8] the document direction counts prose, not code', () => {
  const FENCE = '```js\n' + Array.from({ length: 30 }, (_, i) => `const value${i} = compute(${i}); // step ${i}`).join('\n') + '\n```\n';

  test('an Arabic article with a 30-line JS listing is an RTL document', async ({ page }) => {
    await render(page, `Docker دليل\n\nهذا شرح مختصر لكيفية تثبيت البرنامج وتشغيله\n\n${FENCE}`);
    expect(await page.evaluate(() => window._appState.direction)).toBe('rtl');
  });

  test('an English article with an Arabic string inside a fence is an LTR document', async ({ page }) => {
    await render(page, 'Install the package and run it.\n\n```js\nconst title = "مرحبا بالعالم مرحبا بالعالم مرحبا بالعالم مرحبا بالعالم";\n```\n');
    expect(await page.evaluate(() => window._appState.direction)).toBe('ltr');
  });
});
