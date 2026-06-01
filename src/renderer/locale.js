/**
 * locale.js — UI string catalog + lookup (T-R7 core). Pure.
 * The data layer for a fully Arabic UI; the DOM wiring/mirroring is applied
 * by the renderer using these strings + uiDirection.
 */

export const MESSAGES = {
  en: {
    'menu.file': 'File', 'menu.edit': 'Edit', 'menu.view': 'View', 'menu.help': 'Help',
    'action.openFolder': 'Open Folder', 'action.openFile': 'Open File',
    'action.newNote': 'New Note', 'action.save': 'Save', 'action.export': 'Export HTML',
    'panel.files': 'Files', 'panel.tags': 'Tags', 'panel.search': 'Search',
    'status.words': 'words', 'status.ready': 'ready', 'doc.note': 'note',
  },
  ar: {
    'menu.file': 'ملف', 'menu.edit': 'تحرير', 'menu.view': 'عرض', 'menu.help': 'مساعدة',
    'action.openFolder': 'فتح مجلد', 'action.openFile': 'فتح ملف',
    'action.newNote': 'ملاحظة جديدة', 'action.save': 'حفظ', 'action.export': 'تصدير HTML',
    'panel.files': 'الملفات', 'panel.tags': 'الوسوم', 'panel.search': 'بحث',
    'status.words': 'كلمة', 'status.ready': 'جاهز', 'doc.note': 'مقالة',
  },
};

/** Translate a key for a locale, falling back to English then the key itself. */
export function t(key, locale = 'en') {
  const table = MESSAGES[locale] || MESSAGES.en;
  if (key in table) return table[key];
  if (key in MESSAGES.en) return MESSAGES.en[key];
  return key;
}

/** UI direction implied by a locale. */
export function localeDirection(locale) {
  return locale === 'ar' ? 'rtl' : 'ltr';
}
