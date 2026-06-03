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
    'menu.cmEditor': 'Live-Preview Editor (CodeMirror)',
    'menu.panels': 'Panels', 'menu.showSidebar': 'Show Sidebar', 'menu.showInspector': 'Show Inspector',
    'menu.theme': 'Theme', 'menu.themePaper': 'Paper (light)', 'menu.themeInk': 'Ink (dark)', 'menu.themeSepia': 'Sepia',
    'menu.flipDirection': 'Flip Direction (RTL/LTR)', 'menu.calendar': 'Calendar', 'menu.gregorian': 'Gregorian',
    'menu.hijri': 'Hijri (Umm al-Qura)', 'menu.arabic': 'Arabic', 'menu.arabicInterface': 'Arabic Interface (العربية)',
    'menu.kashida': 'Kashida Justification', 'menu.typography': 'Typography', 'menu.recolourItalics': 'Recolour Italics',
    'menu.zoom': 'Zoom', 'menu.zoomIn': 'Zoom In', 'menu.zoomOut': 'Zoom Out', 'menu.resetZoom': 'Reset Zoom',
    'menu.commandPalette': 'Command Palette', 'menu.shortcuts': 'Keyboard Shortcuts',
    'menu.checkUpdates': 'Check for Updates…', 'menu.about': 'About BP MD RTL Reader',
    // Welcome screen (T-R7). Title/lede/openFileSub carry inline markup → data-i18n-html.
    'welcome.title': 'Welcome to <em>BP MD RTL Reader</em>',
    'welcome.lede': 'A markdown reader that treats prose like a literary object. Bilingual to its core. Open a folder of <code style="font-family: var(--mono); font-size: 14px; color: var(--accent);">.md</code> files — or open a single file — to begin.',
    'welcome.openFolder': 'Open Folder', 'welcome.openFolderSub': 'Pick a folder containing your markdown files.',
    'welcome.openFile': 'Open File', 'welcome.openFileSub': 'Open a single <code style="font-family: var(--mono); font-size: 11px;">.md</code> file.',
    'welcome.newNote': 'New Note', 'welcome.newNoteSub': 'Start a fresh note in a new tab.',
    'welcome.tryDemo': 'Try Demo', 'welcome.tryDemoSub': 'Sample notes in English and Arabic.',
    'welcome.recent': 'Recent', 'welcome.recentEmpty': 'No recent files yet.',
    // Find bar + sidebar search + titlebar search (T-R7).
    'find.placeholder': 'Find in note…', 'find.prev': 'Previous', 'find.next': 'Next', 'find.close': 'Close',
    'search.placeholder': 'Search in all files…', 'search.empty': 'Type to search.',
    'titlebar.search': 'Search files…',
    // Command palette (T-R7). en values MUST match the PALETTE_COMMANDS names verbatim
    // (ellipsis/casing/arrows) so the default English palette is byte-identical.
    'palette.placeholder': 'Type a command, search files…', 'palette.noMatches': 'No matches.',
    'palette.navigate': 'navigate', 'palette.openHint': 'open', 'palette.close': 'close',
    'palette.sec.files': 'Files', 'palette.sec.view': 'View', 'palette.sec.help': 'Help', 'palette.sec.filesInFolder': 'Files in folder',
    'palette.openFolder': 'Open Folder…', 'palette.openFile': 'Open File…', 'palette.newNote': 'New Note',
    'palette.save': 'Save', 'palette.exportHtml': 'Export HTML', 'palette.exportPdf': 'Export PDF', 'palette.loadDemo': 'Load demo notes',
    'palette.modeLive': 'Mode: Live preview', 'palette.modeSplit': 'Mode: Split view', 'palette.modeSource': 'Mode: Source',
    'palette.toggleCmEditor': 'Toggle Live-Preview Editor (CodeMirror)',
    'palette.flip': 'Flip direction (RTL ⇄ LTR)',
    'palette.themePaper': 'Theme: Paper', 'palette.themeInk': 'Theme: Ink', 'palette.themeSepia': 'Theme: Sepia',
    'palette.toggleSidebar': 'Toggle Sidebar', 'palette.toggleInspector': 'Toggle Inspector',
    'palette.toggleArabic': 'Toggle Arabic Interface (العربية)', 'palette.toggleKashida': 'Toggle Arabic Kashida Justification',
    'palette.toggleItalic': 'Toggle Italic Recolour',
    'palette.zoomIn': 'Zoom In', 'palette.zoomOut': 'Zoom Out', 'palette.resetZoom': 'Reset Zoom',
    'palette.shortcuts': 'Keyboard Shortcuts', 'palette.about': 'About BP MD RTL Reader',
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
    'menu.cmEditor': 'محرّر المعاينة الحيّة (CodeMirror)',
    'menu.panels': 'اللوحات', 'menu.showSidebar': 'إظهار الشريط الجانبي', 'menu.showInspector': 'إظهار المُعايِن',
    'menu.theme': 'السمة', 'menu.themePaper': 'ورقي (فاتح)', 'menu.themeInk': 'حبر (داكن)', 'menu.themeSepia': 'بنّي داكن',
    'menu.flipDirection': 'قلب الاتجاه (RTL/LTR)', 'menu.calendar': 'التقويم', 'menu.gregorian': 'ميلادي',
    'menu.hijri': 'هجري (أم القرى)', 'menu.arabic': 'العربية', 'menu.arabicInterface': 'الواجهة العربية (العربية)',
    'menu.kashida': 'ضبط بالكشيدة', 'menu.typography': 'الطباعة', 'menu.recolourItalics': 'تلوين المائل',
    'menu.zoom': 'التكبير', 'menu.zoomIn': 'تكبير', 'menu.zoomOut': 'تصغير', 'menu.resetZoom': 'إعادة التكبير',
    'menu.commandPalette': 'لوحة الأوامر', 'menu.shortcuts': 'اختصارات لوحة المفاتيح',
    'menu.checkUpdates': 'التحقق من التحديثات…', 'menu.about': 'حول BP MD RTL Reader',
    // Welcome screen (T-R7). The product name + the .md extension stay Latin (content).
    'welcome.title': 'مرحبًا بك في <em>BP MD RTL Reader</em>',
    'welcome.lede': 'قارئ ماركداون يعامل النص كعمل أدبي، ثنائي اللغة في جوهره. افتح مجلدًا من ملفات <code style="font-family: var(--mono); font-size: 14px; color: var(--accent);">.md</code> — أو افتح ملفًا واحدًا — للبدء.',
    'welcome.openFolder': 'فتح مجلد', 'welcome.openFolderSub': 'اختر مجلدًا يحتوي على ملفات ماركداون.',
    'welcome.openFile': 'فتح ملف', 'welcome.openFileSub': 'افتح ملف <code style="font-family: var(--mono); font-size: 11px;">.md</code> واحدًا.',
    'welcome.newNote': 'ملاحظة جديدة', 'welcome.newNoteSub': 'ابدأ ملاحظة جديدة في تبويب جديد.',
    'welcome.tryDemo': 'جرّب العرض', 'welcome.tryDemoSub': 'ملاحظات تجريبية بالعربية والإنجليزية.',
    'welcome.recent': 'الأخيرة', 'welcome.recentEmpty': 'لا ملفات حديثة بعد.',
    // Find bar + sidebar search + titlebar search (T-R7).
    'find.placeholder': 'بحث في الملاحظة…', 'find.prev': 'السابق', 'find.next': 'التالي', 'find.close': 'إغلاق',
    'search.placeholder': 'بحث في كل الملفات…', 'search.empty': 'اكتب للبحث.',
    'titlebar.search': 'بحث في الملفات…',
    // Command palette (T-R7). Latin acronyms (HTML/PDF/RTL/LTR) + product name stay verbatim.
    'palette.placeholder': 'اكتب أمرًا أو ابحث في الملفات…', 'palette.noMatches': 'لا نتائج.',
    'palette.navigate': 'تنقّل', 'palette.openHint': 'فتح', 'palette.close': 'إغلاق',
    'palette.sec.files': 'الملفات', 'palette.sec.view': 'عرض', 'palette.sec.help': 'مساعدة', 'palette.sec.filesInFolder': 'ملفات في المجلد',
    'palette.openFolder': 'فتح مجلد…', 'palette.openFile': 'فتح ملف…', 'palette.newNote': 'ملاحظة جديدة',
    'palette.save': 'حفظ', 'palette.exportHtml': 'تصدير HTML', 'palette.exportPdf': 'تصدير PDF', 'palette.loadDemo': 'تحميل ملاحظات تجريبية',
    'palette.modeLive': 'الوضع: معاينة حيّة', 'palette.modeSplit': 'الوضع: عرض مقسّم', 'palette.modeSource': 'الوضع: المصدر',
    'palette.toggleCmEditor': 'تبديل محرّر المعاينة الحيّة (CodeMirror)',
    'palette.flip': 'قلب الاتجاه (RTL ⇄ LTR)',
    'palette.themePaper': 'السمة: ورقي', 'palette.themeInk': 'السمة: حبر', 'palette.themeSepia': 'السمة: بنّي داكن',
    'palette.toggleSidebar': 'إظهار/إخفاء الشريط الجانبي', 'palette.toggleInspector': 'إظهار/إخفاء المُعايِن',
    'palette.toggleArabic': 'تبديل الواجهة العربية (العربية)', 'palette.toggleKashida': 'تبديل الضبط بالكشيدة',
    'palette.toggleItalic': 'تبديل تلوين المائل',
    'palette.zoomIn': 'تكبير', 'palette.zoomOut': 'تصغير', 'palette.resetZoom': 'إعادة التكبير',
    'palette.shortcuts': 'اختصارات لوحة المفاتيح', 'palette.about': 'حول BP MD RTL Reader',
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
