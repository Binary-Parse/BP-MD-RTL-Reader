/**
 * coverage-gaps.test.js — pins remaining edge branches across new modules.
 */
import { describe, test, expect } from 'vitest';
import { sanitizeHtml, sanitizeSvg, renderTrusted } from '../../src/renderer/trusted.js';
import { parseFrontMatter } from '../../src/renderer/frontmatter.js';
import { t } from '../../src/renderer/locale.js';
import { extractHeadings, activeHeading } from '../../src/renderer/outline.js';
import { resolveDirection, stepCaret } from '../../src/renderer/bidi.js';
import { migrate, createSettingsStore, defaultSettings } from '../../src/main/settings.js';
import path from 'node:path';

describe('trusted.js guards', () => {
  test('no DOMPurify → empty string', () => {
    expect(sanitizeHtml('<p>x</p>', null)).toBe('');
    expect(sanitizeSvg('<svg/>', undefined)).toBe('');
  });
  test('renderTrusted with no escapeHtml + no marked → String(md)', () => {
    expect(renderTrusted('raw')).toBe('raw');
  });
});

describe('frontmatter edge', () => {
  test('null input', () => expect(parseFrontMatter(null)).toEqual({ data: {}, body: '' }));
});

describe('locale fallback', () => {
  test('missing key in ar falls back to en', () => {
    expect(t('status.ready', 'ar')).toBe('جاهز');
    expect(t('menu.file', 'zz')).toBe('File'); // unknown locale → en table
  });
});

describe('outline guards', () => {
  test('no md / no marked → []', () => {
    expect(extractHeadings('', {})).toEqual([]);
    expect(extractHeadings('# x', {})).toEqual([]);
  });
  test('activeHeading empty offsets', () => expect(activeHeading(0, [])).toBe(-1));
});

describe('bidi edge', () => {
  test('resolveDirection non-string + stepCaret clamp', () => {
    expect(resolveDirection(123, 'rtl')).toBe('rtl');
    expect(stepCaret('ab', 0, -1)).toBe(0);
  });
});

describe('settings save/lastSession', () => {
  test('migrate keeps a valid lastSession', () => {
    const m = migrate({ lastSession: { vaultPath: '/v', openPaths: ['a', 1], activePath: 'a' } });
    expect(m.lastSession.vaultPath).toBe('/v');
    expect(m.lastSession.openPaths).toEqual(['a']); // non-strings dropped
  });
  test('save returns error when fs throws', () => {
    const fs = { writeFileSync: () => { throw new Error('ro'); }, renameSync: () => {}, readFileSync: () => { throw new Error('no'); } };
    const store = createSettingsStore({ fs, path, userDataDir: '/ud' });
    expect(store.save(defaultSettings())).toEqual({ error: 'write-failed' });
  });
});

describe('context-menu defaults + settings enums (branch coverage)', () => {
  test('builder default isOpenable (no deps) → no open-link', async () => {
    const { buildContextMenuTemplate } = await import('../../src/main/context-menu.js');
    const t = buildContextMenuTemplate({ linkURL: 'https://x', isEditable: false });
    expect(t.some(i => i.id === 'open-link')).toBe(false); // default () => false
    const t2 = buildContextMenuTemplate({ mediaType: 'image', isEditable: false }); // no srcURL
    expect(t2.some(i => i.id === 'copy-image-address')).toBe(false);
  });
  test('migrate honors all enum + window branches', async () => {
    const { migrate } = await import('../../src/main/settings.js');
    const m = migrate({
      uiDirection: 'rtl', uiLocale: 'ar', numerals: 'arabic-indic', calendar: 'hijri',
      sidebarVisible: false, inspectorVisible: false,
      window: { x: 10, y: 20, w: 900, h: 700, maximized: true },
    });
    expect(m).toMatchObject({
      uiDirection: 'rtl', uiLocale: 'ar', numerals: 'arabic-indic', calendar: 'hijri',
      sidebarVisible: false, inspectorVisible: false,
    });
    expect(m.window).toMatchObject({ x: 10, y: 20, w: 900, h: 700, maximized: true });
  });
});
