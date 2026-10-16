/**
 * locale.test.js — T-R7 pure UI string catalog (locale.js): translate with fallback,
 * and the direction implied by a locale.
 */
import { describe, test, expect } from 'vitest';
import { t, tPlural, pluralCategory, formatMessage, localeDirection, MESSAGES, isolateLatinVars } from '../../src/renderer/locale.js';

const plainKeys = (table) => [...new Set(Object.keys(table).map((k) => k.split('#')[0]))].sort();

describe('t (translate) — T-R7', () => {
  test('returns the locale string when present', () => {
    expect(t('menu.file', 'ar')).toBe('ملف');
    expect(t('menu.file', 'en')).toBe('File');
    expect(t('panel.files', 'ar')).toBe('الملفات');
  });
  test('falls back to English, then to the key itself', () => {
    expect(t('menu.view', 'fr')).toBe('View');   // unknown locale → en
    expect(t('does.not.exist', 'ar')).toBe('does.not.exist'); // unknown key → key
    expect(t('does.not.exist')).toBe('does.not.exist');
  });
  test('defaults to English when no locale is given', () => {
    expect(t('menu.edit')).toBe('Edit');
  });
  test('en and ar catalogs cover the same keys (no missing translations)', () => {
    // Plural forms (`key#one`, …) differ by language (audit M20); the plain keys must match.
    expect(plainKeys(MESSAGES.ar)).toEqual(plainKeys(MESSAGES.en));
  });

  test('catalog covers the dropdown MENU items (T-R7 expansion)', () => {
    for (const key of [
      'menu.open', 'menu.openFolder', 'menu.openFile', 'menu.new', 'menu.newNote', 'menu.newDaily',
      'menu.save', 'menu.saveAs', 'menu.exportHtml', 'menu.exportPdf', 'menu.loadDemo',
      'menu.closeTab', 'menu.closeWindow',
      'menu.undo', 'menu.redo', 'menu.cut', 'menu.copy', 'menu.paste', 'menu.selectAll',
      'menu.find', 'menu.bold', 'menu.italic', 'menu.insertLink', 'menu.insertWikilink',
      'menu.panels',
      'menu.showSidebar', 'menu.showInspector', 'menu.theme', 'menu.themePaper', 'menu.themeInk',
      'menu.themeSepia', 'menu.flipDirection', 'menu.calendar', 'menu.gregorian', 'menu.hijri',
      'menu.arabic', 'menu.arabicInterface', 'menu.kashida', 'menu.typography', 'menu.recolourItalics',
      'menu.zoom', 'menu.zoomIn', 'menu.zoomOut', 'menu.resetZoom', 'menu.commandPalette',
      'menu.shortcuts', 'menu.checkUpdates', 'menu.about']) {
      expect(MESSAGES.en[key], `en missing ${key}`).toBeTruthy();
      expect(MESSAGES.ar[key], `ar missing ${key}`).toBeTruthy();
      expect(MESSAGES.ar[key], `${key} not translated`).not.toBe(MESSAGES.en[key]);
    }
  });

  test('catalog covers the inspector + status chrome (T-R7 expansion)', () => {
    for (const key of ['panel.inspector', 'panel.outline', 'panel.properties',
      'prop.file', 'prop.words', 'prop.read', 'prop.direction', 'status.markdown']) {
      expect(MESSAGES.en[key], `en missing ${key}`).toBeTruthy();
      expect(MESSAGES.ar[key], `ar missing ${key}`).toBeTruthy();
      expect(MESSAGES.ar[key]).not.toBe(MESSAGES.en[key]); // actually translated
    }
  });

  // T5.1c: the Inspector "Notes" section and the floating selection bar are user-visible
  // chrome, so both catalogs must carry them (and the Arabic must be a real translation).
  test('catalog covers the highlights + margin notes chrome (T5.1c)', () => {
    for (const key of ['panel.notes', 'notes.empty', 'hl.highlight', 'hl.note', 'hl.noteTitle',
      'hl.notePlaceholder', 'hl.saved', 'hl.removed', 'hl.remove', 'hl.notFound',
      'hl.saveFailed', 'hl.multiNode']) {
      expect(MESSAGES.en[key], `en missing ${key}`).toBeTruthy();
      expect(MESSAGES.ar[key], `ar missing ${key}`).toBeTruthy();
      expect(MESSAGES.ar[key]).not.toBe(MESSAGES.en[key]);
    }
  });

  test('catalog covers all reader control labels and accessible names', () => {
    for (const key of [
      'readerControls.toggle', 'readerControls.title', 'readerControls.textSize',
      'readerControls.decreaseText', 'readerControls.increaseText', 'readerControls.resetText',
      'readerControls.contentWidth',
    ]) {
      expect(MESSAGES.en[key], `en missing ${key}`).toBeTruthy();
      expect(MESSAGES.ar[key], `ar missing ${key}`).toBeTruthy();
      expect(MESSAGES.ar[key], `${key} not translated`).not.toBe(MESSAGES.en[key]);
    }
  });

  // v10 redesign: the two chrome visibility toggles name the direction they will go
  // (menu.autoHideTitlebar/menu.hideStatusBar are the "off→on" labels already covered
  // above; these are the "on→off" labels, distinct strings, not a re-key of the same one).
  test('catalog covers the "on" state of the two chrome visibility toggles', () => {
    for (const key of [
      'menu.alwaysShowTitlebar', 'menu.showStatusBar',
      'palette.alwaysShowTitlebar', 'palette.showStatusBar',
    ]) {
      expect(MESSAGES.en[key], `en missing ${key}`).toBeTruthy();
      expect(MESSAGES.ar[key], `ar missing ${key}`).toBeTruthy();
      expect(MESSAGES.ar[key], `${key} not translated`).not.toBe(MESSAGES.en[key]);
    }
    expect(MESSAGES.en['menu.alwaysShowTitlebar']).not.toBe(MESSAGES.en['menu.autoHideTitlebar']);
    expect(MESSAGES.en['menu.showStatusBar']).not.toBe(MESSAGES.en['menu.hideStatusBar']);
  });
});

describe('localeDirection — T-R7', () => {
  test('ar → rtl, everything else → ltr', () => {
    expect(localeDirection('ar')).toBe('rtl');
    expect(localeDirection('en')).toBe('ltr');
    expect(localeDirection('fr')).toBe('ltr');
  });
});

// QA-L7: a Latin value inside an Arabic sentence keeps its own order.
test('isolateLatinVars wraps only strings with a Latin letter in FSI…PDI', () => {
  expect(isolateLatinVars({ name: 'notes v2.md', n: 3, ar: 'ملاحظة', num: '12' }))
    .toEqual({ name: '\u2068notes v2.md\u2069', n: 3, ar: 'ملاحظة', num: '12' });
  expect(isolateLatinVars(undefined)).toBeUndefined();
});

test('unknown locale falls back to the English catalog before returning the key', () => {
  expect(t('menu.file', 'xx')).toBe('File');
  expect(t('missing.translation.key', 'xx')).toBe('missing.translation.key');
});

describe('plural forms (audit M20)', () => {
  const say = (key, n, locale, vars = {}) => formatMessage(tPlural(key, n, locale), { n, ...vars });

  test('English: one for 1, other for everything else', () => {
    expect(say('recovery.body', 1, 'en')).toBe('1 note from a previous session was never saved. Restore it?');
    expect(say('recovery.body', 3, 'en')).toBe('3 notes from a previous session were never saved. Restore them?');
    expect(say('status.nWords', 0, 'en')).toBe('0 words');
    expect(say('status.nWords', 1, 'en')).toBe('1 word');
    expect(say('toast.openedFolder', 1, 'en', { name: 'demo' })).toBe('Opened “demo” — 1 note');
    expect(say('toast.openedFolder', 12, 'en', { name: 'demo' })).toBe('Opened “demo” — 12 notes');
  });

  test('Arabic: singular, dual, plural of 3 to 10, 11 to 99, and hundreds', () => {
    expect(say('lib.noteCount', 0, 'ar')).toBe('لا ملاحظات');
    expect(say('lib.noteCount', 1, 'ar')).toBe('ملاحظة واحدة');
    expect(say('lib.noteCount', 2, 'ar')).toBe('ملاحظتان');
    expect(say('lib.noteCount', 3, 'ar')).toBe('3 ملاحظات');
    expect(say('lib.noteCount', 10, 'ar')).toBe('10 ملاحظات');
    expect(say('lib.noteCount', 11, 'ar')).toBe('11 ملاحظة');
    expect(say('lib.noteCount', 100, 'ar')).toBe('100 ملاحظة');
    expect(say('lib.noteCount', 103, 'ar')).toBe('103 ملاحظات');
    expect(say('toast.loadedN', 2, 'ar')).toBe('حُمّل ملفان');
    expect(say('toast.loadedN', 5, 'ar')).toBe('حُمّلت 5 ملفات');
    expect(say('toast.loadedN', 15, 'ar')).toBe('حُمّل 15 ملفًا');
    expect(say('status.nWords', 5, 'ar')).toBe('5 كلمات');
    expect(say('status.nWords', 2, 'ar')).toBe('كلمتان');
  });

  test('the category comes from the language; an unknown language counts as English', () => {
    expect([0, 1, 2, 3, 11, 100].map((n) => pluralCategory(n, 'ar'))).toEqual(['zero', 'one', 'two', 'few', 'many', 'other']);
    expect([0, 1, 2].map((n) => pluralCategory(n, 'en'))).toEqual(['other', 'one', 'other']);
    expect(pluralCategory(1, 'xx')).toBe('one');
    expect(say('status.nWords', 1, 'xx')).toBe('1 word');
  });

  test('a missing form, a key without forms and a value that is no number use the plain key', () => {
    expect(tPlural('status.nWords', 0, 'ar')).toBe(MESSAGES.ar['status.nWords']); // Arabic "zero" has no form here
    expect(tPlural('doc.readTime', 1, 'en')).toBe(MESSAGES.en['doc.readTime']);
    expect(tPlural('status.nWords', '1', 'en')).toBe('{n} words');
    expect(tPlural('status.nWords', undefined, 'en')).toBe('{n} words');
    expect(tPlural('status.nWords', NaN, 'en')).toBe('{n} words');
    expect(tPlural('no.such.key', 1, 'en')).toBe('no.such.key');
  });

  test('every form belongs to a plain key, and every English form has an Arabic one', () => {
    for (const table of [MESSAGES.en, MESSAGES.ar]) {
      for (const key of Object.keys(table).filter((k) => k.includes('#'))) {
        const [plain, form] = key.split('#');
        expect(table).toHaveProperty([plain]);
        expect(['zero', 'one', 'two', 'few', 'many']).toContain(form);
      }
    }
    for (const key of Object.keys(MESSAGES.en).filter((k) => k.includes('#'))) expect(MESSAGES.ar).toHaveProperty([key]);
  });

  test('no sentence builds its plural from an "s" parameter any more', () => {
    const all = [...Object.values(MESSAGES.en), ...Object.values(MESSAGES.ar)];
    expect(all.filter((text) => text.includes('{s}') || text.includes('(s)'))).toEqual([]);
  });

  test('a form keeps the placeholders of its sentence, except a number it spells out', () => {
    const names = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((v) => v !== 'n').sort();
    for (const table of [MESSAGES.en, MESSAGES.ar]) {
      for (const key of Object.keys(table).filter((k) => k.includes('#'))) {
        expect(names(table[key])).toEqual(names(table[key.split('#')[0]]));
      }
    }
  });
});
