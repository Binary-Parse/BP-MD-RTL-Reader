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
    'panel.inspector': 'Inspector', 'panel.outline': 'Outline', 'panel.properties': 'Properties',
    'prop.file': 'File', 'prop.words': 'Words', 'prop.read': 'Read', 'prop.direction': 'Direction', 'prop.mode': 'Mode',
    'status.words': 'words', 'status.ready': 'ready', 'status.markdown': 'markdown', 'doc.note': 'note',
    // Dropdown MENU items (T-R7). Dedicated keys preserving the EXACT chrome strings,
    // including the '…' ellipsis and the HTML/PDF/RTL acronyms (which are content, not English).
    'menu.open': 'Open', 'menu.openFolder': 'Open Folder…', 'menu.openFile': 'Open File…',
    'menu.new': 'New', 'menu.newNote': 'New Note', 'menu.newDaily': 'New Daily Note',
    'menu.save': 'Save', 'menu.saveAs': 'Save As…', 'menu.exportHtml': 'Export HTML', 'menu.exportPdf': 'Export PDF',
    'menu.loadDemo': 'Load Demo Notes', 'menu.closeTab': 'Close Tab', 'menu.closeWindow': 'Close Window',
    'menu.undo': 'Undo', 'menu.redo': 'Redo', 'menu.cut': 'Cut', 'menu.copy': 'Copy', 'menu.paste': 'Paste',
    'menu.selectAll': 'Select All', 'menu.find': 'Find…', 'menu.bold': 'Bold', 'menu.italic': 'Italic',
    'menu.insertLink': 'Insert Link', 'menu.insertWikilink': 'Insert Wikilink',
    'menu.mode': 'Mode', 'menu.livePreview': 'Live Preview', 'menu.splitView': 'Split View', 'menu.sourceMode': 'Source Mode',
    'menu.panels': 'Panels', 'menu.showSidebar': 'Show Sidebar', 'menu.showInspector': 'Show Inspector',
    'menu.theme': 'Theme', 'menu.themePaper': 'Paper (light)', 'menu.themeInk': 'Ink (dark)', 'menu.themeSepia': 'Sepia',
    'menu.flipDirection': 'Flip Direction (RTL/LTR)', 'menu.calendar': 'Calendar', 'menu.gregorian': 'Gregorian',
    'menu.hijri': 'Hijri (Umm al-Qura)', 'menu.arabic': 'Arabic', 'menu.arabicInterface': 'Arabic Interface (العربية)',
    'menu.kashida': 'Kashida Justification', 'menu.typography': 'Typography', 'menu.recolourItalics': 'Recolour Italics',
    'menu.zoom': 'Zoom', 'menu.zoomIn': 'Zoom In', 'menu.zoomOut': 'Zoom Out', 'menu.resetZoom': 'Reset Zoom',
    'menu.commandPalette': 'Command Palette', 'menu.shortcuts': 'Keyboard Shortcuts',
    'menu.checkUpdates': 'Check for Updates…', 'menu.about': 'About BP MD RTL Reader',
  },
  ar: {
    'menu.file': 'ملف', 'menu.edit': 'تحرير', 'menu.view': 'عرض', 'menu.help': 'مساعدة',
    'action.openFolder': 'فتح مجلد', 'action.openFile': 'فتح ملف',
    'action.newNote': 'ملاحظة جديدة', 'action.save': 'حفظ', 'action.export': 'تصدير HTML',
    'panel.files': 'الملفات', 'panel.tags': 'الوسوم', 'panel.search': 'بحث',
    'panel.inspector': 'المعاينة', 'panel.outline': 'المخطّط', 'panel.properties': 'الخصائص',
    'prop.file': 'الملف', 'prop.words': 'الكلمات', 'prop.read': 'القراءة', 'prop.direction': 'الاتجاه', 'prop.mode': 'الوضع',
    'status.words': 'كلمة', 'status.ready': 'جاهز', 'status.markdown': 'ماركداون', 'doc.note': 'مقالة',
    // Dropdown MENU items (T-R7). Latin acronyms (HTML/PDF/RTL/LTR) and the product name are
    // kept verbatim — they are content, not untranslated English.
    'menu.open': 'فتح', 'menu.openFolder': 'فتح مجلد…', 'menu.openFile': 'فتح ملف…',
    'menu.new': 'جديد', 'menu.newNote': 'ملاحظة جديدة', 'menu.newDaily': 'ملاحظة يومية جديدة',
    'menu.save': 'حفظ', 'menu.saveAs': 'حفظ باسم…', 'menu.exportHtml': 'تصدير HTML', 'menu.exportPdf': 'تصدير PDF',
    'menu.loadDemo': 'تحميل ملاحظات تجريبية', 'menu.closeTab': 'إغلاق التبويب', 'menu.closeWindow': 'إغلاق النافذة',
    'menu.undo': 'تراجع', 'menu.redo': 'إعادة', 'menu.cut': 'قص', 'menu.copy': 'نسخ', 'menu.paste': 'لصق',
    'menu.selectAll': 'تحديد الكل', 'menu.find': 'بحث…', 'menu.bold': 'عريض', 'menu.italic': 'مائل',
    'menu.insertLink': 'إدراج رابط', 'menu.insertWikilink': 'إدراج رابط ويكي',
    'menu.mode': 'الوضع', 'menu.livePreview': 'معاينة حيّة', 'menu.splitView': 'عرض مقسّم', 'menu.sourceMode': 'وضع المصدر',
    'menu.panels': 'اللوحات', 'menu.showSidebar': 'إظهار الشريط الجانبي', 'menu.showInspector': 'إظهار المُعايِن',
    'menu.theme': 'السمة', 'menu.themePaper': 'ورقي (فاتح)', 'menu.themeInk': 'حبر (داكن)', 'menu.themeSepia': 'بنّي داكن',
    'menu.flipDirection': 'قلب الاتجاه (RTL/LTR)', 'menu.calendar': 'التقويم', 'menu.gregorian': 'ميلادي',
    'menu.hijri': 'هجري (أم القرى)', 'menu.arabic': 'العربية', 'menu.arabicInterface': 'الواجهة العربية (العربية)',
    'menu.kashida': 'ضبط بالكشيدة', 'menu.typography': 'الطباعة', 'menu.recolourItalics': 'تلوين المائل',
    'menu.zoom': 'التكبير', 'menu.zoomIn': 'تكبير', 'menu.zoomOut': 'تصغير', 'menu.resetZoom': 'إعادة التكبير',
    'menu.commandPalette': 'لوحة الأوامر', 'menu.shortcuts': 'اختصارات لوحة المفاتيح',
    'menu.checkUpdates': 'التحقق من التحديثات…', 'menu.about': 'حول BP MD RTL Reader',
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
