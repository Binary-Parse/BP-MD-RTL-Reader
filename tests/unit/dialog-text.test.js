import { describe, test, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { dialogText } = require('../../src/main/dialog-text.js');

// QA-L2: the native file dialogs were English in the Arabic interface.
describe('dialogText', () => {
  test('Arabic interface → Arabic titles and filter names', () => {
    const ar = dialogText('ar');
    expect(ar.openFolder).toBe('فتح مجلد');
    expect(ar.openFile).toBe('فتح ملف');
    expect(ar.exportPdf).toBe('تصدير PDF');
  });

  test('anything else → the English text the main tests pin', () => {
    for (const locale of ['en', undefined, null, 'fr']) {
      expect(dialogText(locale).openFile).toBe('Open File');
      expect(dialogText(locale).markdown).toBe('Markdown');
    }
  });

  test('both languages have the same keys, none empty', () => {
    const en = dialogText('en');
    const ar = dialogText('ar');
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
    for (const value of [...Object.values(en), ...Object.values(ar)]) expect(value.trim()).not.toBe('');
  });
});
