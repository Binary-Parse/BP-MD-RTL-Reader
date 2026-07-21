/**
 * locale.test.js — T-R7 pure UI string catalog (locale.js): translate with fallback,
 * and the direction implied by a locale.
 */
import { describe, test, expect } from 'vitest';
import { t, localeDirection, MESSAGES } from '../../src/renderer/locale.js';

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
    expect(Object.keys(MESSAGES.ar).sort()).toEqual(Object.keys(MESSAGES.en).sort());
  });

  test('catalog covers the dropdown MENU items (T-R7 expansion)', () => {
    for (const key of [
      'menu.open', 'menu.openFolder', 'menu.openFile', 'menu.new', 'menu.newNote', 'menu.newDaily',
      'menu.save', 'menu.saveAs', 'menu.exportHtml', 'menu.exportPdf', 'menu.loadDemo',
      'menu.closeTab', 'menu.closeWindow',
      'menu.undo', 'menu.redo', 'menu.cut', 'menu.copy', 'menu.paste', 'menu.selectAll',
      'menu.find', 'menu.bold', 'menu.italic', 'menu.insertLink', 'menu.insertWikilink',
      'menu.mode', 'menu.livePreview', 'menu.splitView', 'menu.sourceMode', 'menu.panels',
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
      'prop.file', 'prop.words', 'prop.read', 'prop.direction', 'prop.mode', 'status.markdown']) {
      expect(MESSAGES.en[key], `en missing ${key}`).toBeTruthy();
      expect(MESSAGES.ar[key], `ar missing ${key}`).toBeTruthy();
      expect(MESSAGES.ar[key]).not.toBe(MESSAGES.en[key]); // actually translated
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
});

describe('localeDirection — T-R7', () => {
  test('ar → rtl, everything else → ltr', () => {
    expect(localeDirection('ar')).toBe('rtl');
    expect(localeDirection('en')).toBe('ltr');
    expect(localeDirection('fr')).toBe('ltr');
  });
});

test('unknown locale falls back to the English catalog before returning the key', () => {
  expect(t('menu.file', 'xx')).toBe('File');
  expect(t('missing.translation.key', 'xx')).toBe('missing.translation.key');
});
