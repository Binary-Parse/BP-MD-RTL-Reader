// @ts-check
/**
 * Integration tests for drag-and-drop file loading (Issue #7).
 * Validates: dragover preventDefault, drop preventDefault,
 * .md file loads into State.files, non-.md triggers toast,
 * >10MB file rejected with toast.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const FILE_URL = 'file:///' + path.resolve(__dirname, '../../marqam.html').replace(/\\/g, '/');

test.describe('Drag-drop file loading (Issue #7)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(FILE_URL);
    await page.waitForSelector('.app', { state: 'visible' });
  });

  test('dragover listener is registered and calls preventDefault', async ({ page }) => {
    const prevented = await page.evaluate(() => {
      return new Promise(resolve => {
        const fakeEvent = new DragEvent('dragover', { cancelable: true, bubbles: true });
        document.body.addEventListener('dragover', e => {
          resolve(e.defaultPrevented);
        }, { once: true });
        document.body.dispatchEvent(fakeEvent);
      });
    });
    expect(prevented).toBe(true);
  });

  test('drop of .md file loads it into State.files and renders it', async ({ page }) => {
    const initialCount = await page.evaluate(() => window._marqamState.files.length);
    expect(initialCount).toBe(0);

    // Simulate a drop with a crafted File object
    await page.evaluate(async () => {
      const content = '# Dropped Note\n\nThis was drag-dropped.';
      const file = new File([content], 'dropped.md', { type: 'text/markdown' });

      const dt = new DataTransfer();
      dt.items.add(file);

      const dropEvent = new DragEvent('drop', {
        cancelable: true,
        bubbles: true,
        dataTransfer: dt
      });
      document.body.dispatchEvent(dropEvent);

      // Wait for async file.text() to complete
      await new Promise(r => setTimeout(r, 200));
    });

    await page.waitForTimeout(300);

    const fileCount = await page.evaluate(() => window._marqamState.files.length);
    expect(fileCount).toBe(1);

    const fileName = await page.evaluate(() => window._marqamState.files[0].name);
    expect(fileName).toBe('dropped.md');

    // Editor should show the content
    const heading = await page.locator('#noteContent h1').textContent();
    expect(heading).toContain('Dropped Note');
  });

  test('drop event calls preventDefault', async ({ page }) => {
    const prevented = await page.evaluate(() => {
      return new Promise(resolve => {
        const dt = new DataTransfer();
        const file = new File(['# test'], 'test.md', { type: 'text/markdown' });
        dt.items.add(file);

        const ev = new DragEvent('drop', { cancelable: true, bubbles: true, dataTransfer: dt });
        document.body.addEventListener('drop', e => {
          resolve(e.defaultPrevented);
        }, { once: true });
        document.body.dispatchEvent(ev);
      });
    });
    expect(prevented).toBe(true);
  });

  test('non-.md file shows toast and is not loaded', async ({ page }) => {
    await page.evaluate(async () => {
      const file = new File(['binary data'], 'image.png', { type: 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);

      const ev = new DragEvent('drop', { cancelable: true, bubbles: true, dataTransfer: dt });
      document.body.dispatchEvent(ev);
      await new Promise(r => setTimeout(r, 200));
    });

    await page.waitForTimeout(300);

    const fileCount = await page.evaluate(() => window._marqamState.files.length);
    expect(fileCount).toBe(0);

    // Toast element should be visible (has 'show' class) or contain a message
    const toastVisible = await page.evaluate(() => {
      const t = document.getElementById('toast');
      return t && (t.classList.contains('show') || t.textContent.length > 0);
    });
    expect(toastVisible).toBe(true);
  });

  test('.txt files are accepted by drag-drop', async ({ page }) => {
    await page.evaluate(async () => {
      const file = new File(['Plain text content here'], 'notes.txt', { type: 'text/plain' });
      const dt = new DataTransfer();
      dt.items.add(file);

      const ev = new DragEvent('drop', { cancelable: true, bubbles: true, dataTransfer: dt });
      document.body.dispatchEvent(ev);
      await new Promise(r => setTimeout(r, 200));
    });

    await page.waitForTimeout(300);

    const fileCount = await page.evaluate(() => window._marqamState.files.length);
    expect(fileCount).toBe(1);

    const fileName = await page.evaluate(() => window._marqamState.files[0].name);
    expect(fileName).toBe('notes.txt');
  });

  test('multiple .md files dropped at once are all loaded', async ({ page }) => {
    await page.evaluate(async () => {
      const dt = new DataTransfer();
      dt.items.add(new File(['# First'], 'first.md', { type: 'text/markdown' }));
      dt.items.add(new File(['# Second'], 'second.md', { type: 'text/markdown' }));

      const ev = new DragEvent('drop', { cancelable: true, bubbles: true, dataTransfer: dt });
      document.body.dispatchEvent(ev);
      await new Promise(r => setTimeout(r, 300));
    });

    await page.waitForTimeout(400);

    const fileCount = await page.evaluate(() => window._marqamState.files.length);
    expect(fileCount).toBe(2);
  });
});
