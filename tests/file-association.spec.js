// @ts-check
/**
 * File-association tests. Verifies that when the main process sends an
 * 'open-external-file' IPC event (which happens when the user double-clicks
 * a .md file in Windows Explorer with BP MD RTL Reader as the default handler), the
 * renderer adds the file to State.files and renders it.
 *
 * We can't drive a real OS file association in Playwright, so we simulate the
 * IPC delivery by calling window.openExternalFile() directly with the same
 * payload shape that main.js sends.
 */

const { test, expect } = require('@playwright/test');
const path = require('path');

const FILE_URL = 'file:///' + path.resolve(__dirname, '../marqam.html').replace(/\\/g, '/');

async function goto(page) {
  await page.goto(FILE_URL);
  await page.waitForSelector('.app', { state: 'visible' });
}

test.describe('[FA] File association — open .md from Explorer', () => {

  test('openExternalFile adds the file to State.files and renders it', async ({ page }) => {
    await goto(page);
    await page.evaluate(() => {
      window.openExternalFile({
        name: 'note.md',
        path: 'C:\\Users\\test\\Documents\\note.md',
        content: '# Hello from Explorer\n\nThis came in via file association.'
      });
    });
    await page.waitForTimeout(200);
    const state = await page.evaluate(() => {
      const s = window._marqamState;
      return {
        count: s.files.length,
        firstName: s.files[0] && s.files[0].name,
        firstContent: s.files[0] && s.files[0].content,
        activeFile: s.activeFile
      };
    });
    expect(state.count).toBe(1);
    expect(state.firstName).toBe('note.md');
    expect(state.firstContent).toMatch(/Hello from Explorer/);
    expect(state.activeFile).toBe(0);
  });

  test('preview pane shows the heading from the externally-opened file', async ({ page }) => {
    await goto(page);
    await page.evaluate(() => {
      window.openExternalFile({
        name: 'demo.md',
        path: 'demo.md',
        content: '# BP MD RTL Reader external open works\n\nbody text here'
      });
    });
    await page.waitForTimeout(300);
    const previewText = await page.$eval('#noteContent', el => el.textContent);
    expect(previewText).toContain('BP MD RTL Reader external open works');
  });

  test('second openExternalFile call adds a second tab (not overwrites)', async ({ page }) => {
    await goto(page);
    await page.evaluate(() => {
      window.openExternalFile({ name: 'one.md', path: '/p/one.md', content: '# One' });
    });
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      window.openExternalFile({ name: 'two.md', path: '/p/two.md', content: '# Two' });
    });
    await page.waitForTimeout(150);
    const names = await page.evaluate(() => window._marqamState.files.map(f => f.name));
    expect(names).toEqual(['one.md', 'two.md']);
    const active = await page.evaluate(() => window._marqamState.activeFile);
    expect(active).toBe(1);
  });

  test('opening the same path twice refreshes the existing tab (no duplicate)', async ({ page }) => {
    await goto(page);
    await page.evaluate(() => {
      window.openExternalFile({ name: 'x.md', path: '/p/x.md', content: '# First' });
    });
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      window.openExternalFile({ name: 'x.md', path: '/p/x.md', content: '# Updated' });
    });
    await page.waitForTimeout(150);
    const result = await page.evaluate(() => ({
      count: window._marqamState.files.length,
      content: window._marqamState.files[0].content
    }));
    expect(result.count).toBe(1);
    expect(result.content).toMatch(/Updated/);
  });

  test('malformed payload (missing content) is ignored silently', async ({ page }) => {
    await goto(page);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.evaluate(() => {
      window.openExternalFile({ name: 'bad.md' }); // no content
    });
    await page.waitForTimeout(150);
    const count = await page.evaluate(() => window._marqamState.files.length);
    expect(count).toBe(0);
    expect(errors).toEqual([]);
  });
});
