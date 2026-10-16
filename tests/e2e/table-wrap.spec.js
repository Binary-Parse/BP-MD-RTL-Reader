// @ts-check
/**
 * table-wrap.spec.js — long text inside a table cell must wrap inside the reading column
 * instead of stretching the table and forcing a sideways scroll. Wide tables (many columns)
 * may still scroll locally in their frame, but no column may collapse below 8ch.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_URL = 'file:///' + path.resolve(__dirname, '../../src/renderer/index.html').replace(/\\/g, '/');

const LONG_TEXT = 'This sentence is deliberately long so that it cannot fit on a single line of a table cell. '.repeat(4);
const LONG_URL = 'https://example.com/' + 'segment-with-no-spaces/'.repeat(6);

async function boot(page) {
  await page.goto(INDEX_URL);
  await page.waitForSelector('#app');
  await page.waitForFunction(() => !!window._appState && !!window.getActiveCmAdapter, null, { timeout: 8000 });
}

async function openReading(page, content) {
  await page.evaluate((c) => {
    window._appState.files = [{ name: 'tbl.md', path: 'tbl.md', content: c, dirty: false }];
    window.renderFile(0);
    window.setViewMode('reading');
  }, content);
  await page.waitForSelector('#noteContent .table-frame');
}

const metrics = (page) => page.evaluate(() => {
  const frame = document.querySelector('#noteContent .table-frame');
  const cells = [...frame.querySelectorAll('tbody td')];
  return {
    clientWidth: frame.clientWidth,
    scrollWidth: frame.scrollWidth,
    tabindex: frame.getAttribute('tabindex'),
    cellHeights: cells.map(c => c.getBoundingClientRect().height),
    lineHeight: parseFloat(getComputedStyle(cells[0]).lineHeight) || 20,
  };
});

const LONG_TABLE = `| Name | Notes | Link |\n| --- | --- | --- |\n| A | ${LONG_TEXT} | ${LONG_URL} |\n`;

test.describe('table cells wrap inside the reading column', () => {
  test('long prose and a long unbroken URL wrap: no horizontal scroll, cell is multi-line', async ({ page }) => {
    await boot(page);
    await openReading(page, LONG_TABLE);
    const m = await metrics(page);
    expect(m.scrollWidth).toBeLessThanOrEqual(m.clientWidth + 1);
    expect(m.tabindex).toBeNull();
    // the long cells must take more than two lines
    expect(Math.max(...m.cellHeights)).toBeGreaterThan(m.lineHeight * 2);
  });

  for (const width of [48, 96]) {
    test(`still wraps when the reader width is ${width}ch`, async ({ page }) => {
      await boot(page);
      await page.evaluate((w) => document.documentElement.style.setProperty('--reader-width', `${w}ch`), width);
      await openReading(page, LONG_TABLE);
      const m = await metrics(page);
      expect(m.scrollWidth).toBeLessThanOrEqual(m.clientWidth + 1);
    });
  }

  for (const zoom of [0.6, 2]) {
    test(`still wraps at app zoom ${zoom * 100}%`, async ({ page }) => {
      // Keep the effective (post-zoom) viewport at 1280px wide, as in the other cases.
      await page.setViewportSize({ width: Math.round(1280 * zoom), height: 720 });
      await boot(page);
      await page.evaluate((z) => window.setZoom(z), zoom);
      await openReading(page, LONG_TABLE);
      // Zoom can leave a very narrow column. Then the frame may scroll, but only because
      // every column has shrunk to its 8ch floor — never because a cell refused to wrap.
      const r = await page.evaluate(() => {
        const frame = document.querySelector('#noteContent .table-frame');
        const cols = [...frame.querySelectorAll('th')].map(t => t.getBoundingClientRect().width);
        const cs = getComputedStyle(frame.querySelector("th"));
        const floor = parseFloat(cs.minWidth) + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
        return { clientWidth: frame.clientWidth, scrollWidth: frame.scrollWidth, cols, floor };
      });
      const fits = r.scrollWidth <= r.clientWidth + 1;
      const allAtFloor = r.cols.every(w => Math.abs(w - r.floor) <= 8 /* border-collapse trims a few px */);
      expect(fits || allAtFloor).toBe(true);
    });
  }

  test('a 12-column table keeps every column at least 8ch and scrolls in its frame', async ({ page }) => {
    await boot(page);
    const cols = Array.from({ length: 12 }, (_, i) => `C${i + 1}`);
    const md = `| ${cols.join(' | ')} |\n| ${cols.map(() => '---').join(' | ')} |\n| ${cols.map(() => 'x').join(' | ')} |\n`;
    await openReading(page, md);
    const r = await page.evaluate(() => {
      const frame = document.querySelector('#noteContent .table-frame');
      const th = frame.querySelector('th');
      const ch = parseFloat(getComputedStyle(th).fontSize) * 0.5; // 1ch is at least ~0.5em for any font
      return {
        scrollWidth: frame.scrollWidth,
        clientWidth: frame.clientWidth,
        minCol: Math.min(...[...frame.querySelectorAll('th')].map(t => t.getBoundingClientRect().width)),
        ch,
      };
    });
    expect(r.scrollWidth).toBeGreaterThan(r.clientWidth);
    expect(r.minCol).toBeGreaterThanOrEqual(r.ch * 8);
  });

  test('an Arabic RTL table wraps the same way', async ({ page }) => {
    await boot(page);
    const ar = 'هذا نص عربي طويل جداً لا يتسع في سطر واحد داخل خلية الجدول ولذلك يجب أن يلتف إلى عدة أسطر. '.repeat(4);
    await openReading(page, `| الاسم | الوصف |\n| --- | --- |\n| أ | ${ar} |\n`);
    const m = await metrics(page);
    expect(m.scrollWidth).toBeLessThanOrEqual(m.clientWidth + 1);
    expect(Math.max(...m.cellHeights)).toBeGreaterThan(m.lineHeight * 2);
  });
});

// audit M19, decision D9: `:--`, `:-:`, `--:` were ignored (every cell was start-aligned).
// They are kept now and follow the direction of the table: "left" = start, "right" = end.
test.describe('[M19] column alignment follows the direction of the table', () => {
  const sides = (page, scope) => page.evaluate((sel) => {
    const row = document.querySelector(`${sel} tbody tr`);
    return [...row.querySelectorAll('td')].map((cell) => {
      const text = document.createRange();
      text.selectNodeContents(cell);
      const box = cell.getBoundingClientRect();
      const ink = text.getBoundingClientRect();
      const left = ink.left - box.left;
      const right = box.right - ink.right;
      if (Math.abs(left - right) <= 2) return 'center';
      return left < right ? 'left' : 'right';
    });
  }, scope);
  const table = (a, b, c) => `| ${a} | ${b} | ${c} |\n|:--|:-:|--:|\n| x1 | x2 | x3 |\n`;

  test('an English table: start is the left, end is the right', async ({ page }) => {
    await boot(page);
    await openReading(page, `Some English text.\n\n${table('One', 'Two', 'Three')}`);
    expect(await sides(page, '#noteContent')).toEqual(['left', 'center', 'right']);
  });

  test('an Arabic table is the mirror image: start is the right, end is the left', async ({ page }) => {
    await boot(page);
    await openReading(page, `نص عربي.\n\n| الصنف | الكمية | السعر |\n|:--|:-:|--:|\n| قلم | ثلاثة | خمسة |\n`);
    expect(await sides(page, '#noteContent')).toEqual(['right', 'center', 'left']);
  });

  test('QA M14: a Latin cell in an Arabic table aligns with its column', async ({ page }) => {
    await boot(page);
    await openReading(page, `نص عربي.\n\n| الصنف | الكمية | السعر |\n|:--|:-:|--:|\n| pen | ثلاثة | 5 USD |\n`);
    expect(await sides(page, '#noteContent')).toEqual(['right', 'center', 'left']);
  });

  test('the alignment changes with the direction the user sets by hand', async ({ page }) => {
    await boot(page);
    await openReading(page, `Some English text.\n\n${table('One', 'Two', 'Three')}`);
    await page.evaluate(() => window.toggleRTL()); // AUTO -> RTL
    expect(await page.evaluate(() => window._appState.forcedDir)).toBe('rtl');
    expect(await sides(page, '#noteContent')).toEqual(['right', 'center', 'left']);
    await page.evaluate(() => window.toggleRTL()); // RTL -> LTR
    expect(await sides(page, '#noteContent')).toEqual(['left', 'center', 'right']);
  });

  test('a column with no marker stays at the start', async ({ page }) => {
    await boot(page);
    await openReading(page, `| One | Two |\n|---|---|\n| x1 | x2 |\n`);
    expect(await sides(page, '#noteContent')).toEqual(['left', 'left']);
  });

  test('the table drawn inside the editor follows the same rule', async ({ page }) => {
    await boot(page);
    await page.evaluate((c) => {
      window._appState.files = [{ name: 'tbl.md', path: 'tbl.md', content: c, dirty: false }];
      window.renderFile(0);
      window.setViewMode('edit');
    }, `Intro line.\n\n${table('One', 'Two', 'Three')}\nAfter.\n`);
    await page.waitForSelector('.cm-mount .cm-lp-block table');
    expect(await sides(page, '.cm-mount .cm-lp-block')).toEqual(['left', 'center', 'right']);
  });
});
