// @ts-check
/**
 * b9-vault-watch.spec.js — T-B9 renderer side: on a `vault:changed` notification the app
 * re-lists the vault and reconciles. EC-A2: a file with unsaved edits whose disk copy
 * diverged is flagged `conflict` (edits kept, never silently overwritten); files with no
 * local edits adopt the disk content; new files appear in the tree.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_PATH = path.resolve(__dirname, '../index.html');
const INDEX_URL = `file:///${INDEX_PATH.replace(/\\/g, '/')}`;

// Seed an open vault with two files and stub readVault to return `entries` next time.
async function seed(page, files, freshEntries) {
  await page.evaluate(({ files, fresh }) => {
    let reads = 0;
    const vault = { id: 'cap-vault', name: 'myvault', generation: 1 };
    const snapshot = (list) => ({ vault, entries: list.map((f, i) => ({ name: f.name, relPath: f.path || f.relPath, documentId: `cap-doc-${i}`, content: f.content })) });
    window.electronAPI = {
      openFolder: () => Promise.resolve({ canceled: false, vault }),
      readVault: () => Promise.resolve(reads++ === 0 ? snapshot(files) : snapshot(fresh)),
    };
    window.__seedDirty = files.map(f => !!f.dirty);
  }, { files, fresh: freshEntries });
  await page.evaluate(() => window.openVault());
  await page.evaluate(() => {
    window.__seedDirty.forEach((dirty, i) => { window._appState.files[i].dirty = dirty; });
    window.renderFile(0);
  });
}

test.describe('[T-B9] vault watch → renderer reconcile (EC-A2)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app', { state: 'visible' });
  });

  test('active file with NO local edits adopts the disk content (silent reload)', async ({ page }) => {
    await seed(page,
      [{ name: 'a.md', path: 'a.md', content: '# Old A' }],
      [{ name: 'a.md', relPath: 'a.md', content: '# New A from disk' }]);
    await page.evaluate(() => window.handleVaultChanged({ vaultId: 'cap-vault', generation: 1, files: ['a.md'] }));
    const f = await page.evaluate(() => window._appState.files[0]);
    expect(f.content).toBe('# New A from disk');
    expect(!!f.conflict).toBe(false);
    await expect(page.locator('#noteContent')).toContainText('New A from disk');
  });

  test('EC-A2: active file WITH unsaved edits + diverged disk → conflict; edits kept', async ({ page }) => {
    await seed(page,
      [{ name: 'a.md', path: 'a.md', content: '# My unsaved edits', dirty: true }],
      [{ name: 'a.md', relPath: 'a.md', content: '# Different on disk' }]);
    await page.evaluate(() => window.handleVaultChanged({ vaultId: 'cap-vault', generation: 1, files: ['a.md'] }));
    const f = await page.evaluate(() => window._appState.files[0]);
    expect(f.conflict).toBe(true);
    expect(f.content).toBe('# My unsaved edits');     // edits NOT overwritten
    expect(f.diskContent).toBe('# Different on disk'); // disk version stashed for resolve
    await expect(page.locator('#toast')).toContainText('changed on disk');
    // EC-A2 surface: the active conflicted file shows a resolve banner with both choices.
    await expect(page.locator('#conflictBar .conflict-banner')).toHaveCount(1);
    await expect(page.locator('#conflictBar .cf-reload')).toBeVisible();
    await expect(page.locator('#conflictBar .cf-keep')).toBeVisible();
  });

  test('EC-A2 resolve: "Reload from disk" takes the disk version + clears conflict/dirty', async ({ page }) => {
    await seed(page,
      [{ name: 'a.md', path: 'a.md', content: '# My edits', dirty: true }],
      [{ name: 'a.md', relPath: 'a.md', content: '# Disk version' }]);
    await page.evaluate(() => window.handleVaultChanged({ vaultId: 'cap-vault', generation: 1, files: ['a.md'] }));
    await page.locator('#conflictBar .cf-reload').click();
    const f = await page.evaluate(() => window._appState.files[0]);
    expect(f.content).toBe('# Disk version');
    expect(f.dirty).toBe(false);
    expect(f.conflict).toBe(false);
    await expect(page.locator('#conflictBar .conflict-banner')).toHaveCount(0);
  });

  test('EC-A2 resolve: "Keep my edits" retains edits + dirty, clears the banner', async ({ page }) => {
    await seed(page,
      [{ name: 'a.md', path: 'a.md', content: '# My edits', dirty: true }],
      [{ name: 'a.md', relPath: 'a.md', content: '# Disk version' }]);
    await page.evaluate(() => window.handleVaultChanged({ vaultId: 'cap-vault', generation: 1, files: ['a.md'] }));
    await page.locator('#conflictBar .cf-keep').click();
    const f = await page.evaluate(() => window._appState.files[0]);
    expect(f.content).toBe('# My edits'); // edits retained
    expect(f.dirty).toBe(true);
    expect(f.conflict).toBe(false);
    await expect(page.locator('#conflictBar .conflict-banner')).toHaveCount(0);
  });

  test('a CRLF-only difference is NOT treated as a conflict (EOL-normalized compare)', async ({ page }) => {
    await seed(page,
      [{ name: 'a.md', path: 'a.md', content: 'line one\nline two', dirty: true }],
      [{ name: 'a.md', relPath: 'a.md', content: 'line one\r\nline two' }]); // same text, CRLF on disk
    await page.evaluate(() => window.handleVaultChanged({ vaultId: 'cap-vault', generation: 1, files: ['a.md'] }));
    const f = await page.evaluate(() => window._appState.files[0]);
    expect(!!f.conflict).toBe(false);
    await expect(page.locator('#conflictBar .conflict-banner')).toHaveCount(0);
  });

  test('a background (non-active) dirty file diverging on disk gets a ⚠ tab marker', async ({ page }) => {
    await seed(page,
      [{ name: 'a.md', path: 'a.md', content: 'A' }, { name: 'b.md', path: 'b.md', content: 'B edits', dirty: true }],
      [{ name: 'a.md', relPath: 'a.md', content: 'A' }, { name: 'b.md', relPath: 'b.md', content: 'B changed on disk' }]);
    // Open b as a tab, then return to a so b is genuinely a background tab.
    await page.evaluate(() => { window.renderFile(1); window.renderFile(0); });
    await page.evaluate(() => window.handleVaultChanged({ vaultId: 'cap-vault', generation: 1, files: ['b.md'] }));
    expect(await page.evaluate(() => window._appState.files[1].conflict)).toBe(true);
    await expect(page.locator('.tab.conflict')).toHaveCount(1);
    await expect(page.locator('.tab.conflict .tab-conflict')).toBeVisible();
  });

  test('a newly-created file on disk appears in the tree', async ({ page }) => {
    await seed(page,
      [{ name: 'a.md', path: 'a.md', content: 'A' }],
      [{ name: 'a.md', relPath: 'a.md', content: 'A' }, { name: 'b.md', relPath: 'b.md', content: '# B is new' }]);
    await page.evaluate(() => window.handleVaultChanged({ vaultId: 'cap-vault', generation: 1, files: ['b.md'] }));
    expect(await page.locator('.tree-node').count()).toBe(2); // both files now listed
    const tree = await page.locator('.tree-node').allInnerTexts();
    expect(tree.join(' ')).toContain('b.md');
    expect(await page.evaluate(() => window._appState.files.map(f => f.path))).toContain('b.md');
  });

  test('a change for a DIFFERENT vault is ignored', async ({ page }) => {
    await seed(page,
      [{ name: 'a.md', path: 'a.md', content: 'A' }],
      [{ name: 'a.md', relPath: 'a.md', content: 'CHANGED' }]);
    await page.evaluate(() => window.handleVaultChanged({ vaultId: 'cap-other', generation: 1, files: ['a.md'] }));
    expect(await page.evaluate(() => window._appState.files[0].content)).toBe('A'); // untouched
  });
});
