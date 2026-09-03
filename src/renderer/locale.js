/**
 * locale.js — UI string catalog + lookup (T-R7 core). Pure.
 * The data layer for a fully Arabic UI; the DOM wiring/mirroring is applied
 * by the renderer using these strings + uiDirection.
 */

import { translate, localeDirection } from './locale-logic.js';

export { localeDirection };

export const MESSAGES = {
  en: {
    'menu.file': 'File', 'menu.edit': 'Edit', 'menu.view': 'View', 'menu.help': 'Help',
    'action.openFolder': 'Open Folder', 'action.openFile': 'Open File',
    'action.newNote': 'New Note', 'action.save': 'Save', 'action.export': 'Export HTML',
    'panel.files': 'Files', 'panel.tags': 'Tags', 'panel.search': 'Search',
    // B4 (multi-folder workspaces): the loose-file pseudo-root and the per-folder close
    // affordance in the sidebar tree.
    'sidebar.openFiles': 'Open files', 'sidebar.closeFolder': 'Close folder',
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
    // T-F19 chrome: menu, palette and Settings dialog.
    'menu.chrome': 'Chrome', 'menu.autoHideTitlebar': 'Auto-hide Top Bar',
    'menu.hideStatusBar': 'Hide Bottom Status Bar', 'menu.settings': 'Settings…',
    'palette.autoHideTitlebar': 'Auto-hide Top Bar', 'palette.hideStatusBar': 'Hide Bottom Status Bar',
    'palette.settings': 'Settings…',
    // v10 redesign: the "on" state of the same two toggles, so the menu/palette/context
    // menu/shortcut sheet can name the direction a click will go (the Settings dialog's
    // switch keeps the static name above — see CHROME_TOGGLES in app.js).
    'menu.alwaysShowTitlebar': 'Always Show Top Bar', 'menu.showStatusBar': 'Show Bottom Status Bar',
    'palette.alwaysShowTitlebar': 'Always Show Top Bar', 'palette.showStatusBar': 'Show Bottom Status Bar',
    'settings.title': 'Settings', 'settings.window': 'Window', 'settings.appearance': 'Appearance',
    'settings.windowTitle': 'Window title',
    'settings.windowTitleDesc': 'What Windows shows in the taskbar and Alt+Tab. The app icon is unchanged either way; unsaved files are marked with a leading dot.',
    'settings.titleModeFile': 'File name', 'settings.titleModeApp': 'App name',
    'settings.autoHideTitlebar': 'Auto-hide top bar',
    'settings.autoHideTitlebarDesc': 'Hides the top bar and the window controls until the pointer reaches the top edge. Always reachable from View or Ctrl+Shift+T. While it is hidden the window cannot be dragged.',
    'settings.hideStatusBar': 'Hide bottom status bar',
    'settings.hideStatusBarDesc': 'Removes the status bar and gives its row back to the note. Ctrl+Shift+B.',
    'settings.files': 'Files',
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
    // T-F18: the two panel toggles that moved into the titlebar.
    'titlebar.toggleSidebar': 'Toggle Sidebar', 'titlebar.toggleInspector': 'Toggle Inspector',
    // v10 redesign (2026-08-25): fullscreen toggle, label swaps with state.
    'titlebar.fullscreen': 'Full screen', 'titlebar.exitFullscreen': 'Exit full screen',
    // Command palette (T-R7). en values MUST match the PALETTE_COMMANDS names verbatim
    // (ellipsis/casing/arrows) so the default English palette is byte-identical.
    'palette.placeholder': 'Type a command, search files…', 'palette.noMatches': 'No matches.',
    'palette.navigate': 'navigate', 'palette.openHint': 'open', 'palette.close': 'close',
    'palette.sec.files': 'Files', 'palette.sec.view': 'View', 'palette.sec.help': 'Help', 'palette.sec.filesInFolder': 'Files in folder',
    'palette.openFolder': 'Open Folder…', 'palette.openFile': 'Open File…', 'palette.newNote': 'New Note',
    'palette.save': 'Save', 'palette.exportHtml': 'Export HTML', 'palette.exportPdf': 'Export PDF', 'palette.loadDemo': 'Load demo notes',
    'palette.modeLive': 'Mode: Live preview', 'palette.modeSplit': 'Mode: Split view', 'palette.modeSource': 'Mode: Source',
    'palette.toggleCmEditor': 'Toggle Live-Preview Editor (CodeMirror)',
    'palette.toggleReading': 'Toggle Reading Mode',
    'palette.flip': 'Flip direction (RTL ⇄ LTR)',
    'palette.themePaper': 'Theme: Paper', 'palette.themeInk': 'Theme: Ink', 'palette.themeSepia': 'Theme: Sepia',
    'palette.toggleSidebar': 'Toggle Sidebar', 'palette.toggleInspector': 'Toggle Inspector',
    'palette.toggleArabic': 'Toggle Arabic Interface (العربية)', 'palette.toggleKashida': 'Toggle Arabic Kashida Justification',
    'palette.toggleItalic': 'Toggle Italic Recolour',
    'palette.zoomIn': 'Zoom In', 'palette.zoomOut': 'Zoom Out', 'palette.resetZoom': 'Reset Zoom',
    'palette.shortcuts': 'Keyboard Shortcuts', 'palette.about': 'About BP MD RTL Reader',
    'readerControls.toggle': 'Reader settings', 'readerControls.title': 'Reader settings', 'readerControls.textSize': 'Text size',
    'readerControls.decreaseText': 'Decrease text size', 'readerControls.increaseText': 'Increase text size', 'readerControls.resetText': 'Reset text size',
    'readerControls.contentWidth': 'Content width',
    // v1.2 Word-style close/save dialog: a themed three-way prompt replaces the old
    // English-only native confirm() (which offered only discard/cancel — the default
    // button was the data-losing one).
    'dlg.unsavedTitle': 'Unsaved changes',
    'dlg.saveOnePre': 'Do you want to save the changes to ',
    'dlg.saveOnePost': '?',
    'dlg.saveMany': 'You have {n} unsaved note{s}. Save them before closing?',
    'dlg.hint': 'Your changes will be lost if you don’t save.',
    'dlg.save': 'Save', 'dlg.saveAll': 'Save All',
    'dlg.dontSave': 'Don’t Save', 'dlg.closeWithoutSaving': 'Close without Saving',
    'dlg.cancel': 'Cancel',
    // Crash/forced-exit recovery (autorecovery snapshots, Word-style).
    'recovery.title': 'Recover unsaved notes?',
    'recovery.body': '{n} note{s} from a previous session were never saved. Restore them?',
    'recovery.restore': 'Restore', 'recovery.discard': 'Discard',
    'recovery.hint': 'They reopen as unsaved copies — use Save As to keep them.',
    'recovery.restored': 'Restored {n} note{s} — save them to keep them',
    // Settings: optional auto-save (files opened from disk only; untitled notes still
    // need Save As because their on-disk location is unknown).
    'settings.autosave': 'Auto-save',
    'settings.autosaveDesc': 'Automatically saves open files about every 30 seconds. Untitled notes still need Save As.',
    // Toasts (previously hard-coded English at every call site).
    'toast.saved': 'Saved {name}', 'toast.savedAs': 'Saved as {name}',
    'toast.noFileToSave': 'No file to save',
    'toast.couldNotSave': 'Could not save',
    'toast.couldNotSaveName': 'Could not save {name} ({reason})',
    'toast.saveCanceled': 'Save canceled — the note is still unsaved',
    'toast.downloaded': 'Downloaded {name}',
    'toast.openedFile': 'Opened {name}', 'toast.couldNotOpenFile': 'Could not open file',
    'toast.openFileFailed': 'Could not open “{name}”',
    'toast.folderNoNotes': 'Folder opened — no .md files found',
    'toast.openedFolder': 'Opened “{name}” — {n} note{s}',
    'toast.couldNotOpenFolder': 'Could not open folder',
    'toast.demoLoaded': 'Demo notes loaded',
    'toast.skippedType': 'Skipped “{name}” — only .md/.markdown/.txt files',
    'toast.skippedSize': 'Skipped “{name}” — file exceeds 10 MB limit',
    'toast.couldNotRead': 'Could not read “{name}”',
    'toast.loadedN': 'Loaded {n} file{s}',
    'toast.reopenedConflict': '“{name}” is already open with unsaved edits — kept your version',
    'toast.reloaded': 'Reloaded from disk', 'toast.keptEdits': 'Kept your edits',
    'toast.vaultTruncated': 'Folder is large — showing the first {n} files',
    'toast.leftVault': '“{name}” was saved outside the open folder',
    // Status bar (previously hard-coded English).
    'status.noFolder': 'no folder', 'status.folder': 'folder: {name}', 'status.folders': 'folders: {n}',
    'status.lnCol': 'ln {l} · col {c}', 'status.nWords': '{n} words',
    'sc.cycleTheme': 'Cycle Theme',
    // Right-click menu, per-surface items (tree rows / tabs / wikilinks). The renderer
    // builds these locally — main never sees content paths, so Reveal/Copy Path ask
    // main to resolve the file's own capability server-side.
    'ctx.reveal': 'Reveal in File Explorer', 'ctx.copyPath': 'Copy Path',
    'ctx.close': 'Close', 'ctx.closeOthers': 'Close Other Tabs', 'ctx.closeAll': 'Close All Tabs',
    'ctx.duplicate': 'Duplicate Note', 'ctx.openNote': 'Open Note', 'ctx.copyName': 'Copy Name',
    'ctxmenu.label': 'Context menu', 'dropdown.label': 'Menu',
    'toast.theme': 'Theme: {name}', 'toast.direction': 'Direction: {dir}',
    'toast.sidebar': 'Sidebar: {state}', 'toast.inspector': 'Inspector: {state}',
    'toast.shown': 'shown', 'toast.hidden': 'hidden',
    'toast.calendar': 'Calendar: {name}',
    'toast.kashida': 'Arabic justification: {state}',
    'toast.italicRecolor': 'Italic recolour: {state}',
    'toast.on': 'on', 'toast.off': 'off', 'toast.kashidaOn': 'kashida', 'toast.kashidaOff': 'ragged',
    'toast.cmEditor': 'Live-preview editor: {state}',
    'toast.updateAvailable': 'Update available: {latest} (you have {current})',
    'toast.upToDate': 'You’re up to date ({current})',
    'toast.exported': 'Exported {name}',
    'toast.noNoteFound': 'No note found for “{target}”',
    'toast.openedNFiles': 'Opened {n} file{s}',
    'toast.topbarHidden': 'Top bar hidden — move the pointer to the top edge, or press Ctrl+Shift+T. Ctrl+, opens Settings.',
    'toast.statusbarHidden': 'Status bar hidden — press Ctrl+Shift+B to bring it back. Ctrl+, opens Settings.',
    'doc.unsaved': 'unsaved', 'doc.readTime': '≈ {n} min read',
    // v1.2: the writing toolbar strip (previously zero localization — 24 English-only
    // tooltips/labels). Shortcut parentheses are content, not untranslated English.
    'tb.heading': 'Heading level', 'tb.bold': 'Bold (Ctrl+B)', 'tb.boldName': 'Bold',
    'tb.italic': 'Italic (Ctrl+I)', 'tb.italicName': 'Italic',
    'tb.strike': 'Strikethrough', 'tb.underline': 'Underline',
    'tb.code': 'Inline code', 'tb.highlight': 'Highlight (==)',
    'tb.sub': 'Subscript (~x~)', 'tb.sup': 'Superscript (^x^)',
    'tb.clear': 'Clear formatting', 'tb.link': 'Insert link', 'tb.wikilink': 'Insert wikilink',
    'tb.math': 'Inline math (KaTeX)', 'tb.footnote': 'Insert footnote',
    'tb.quote': 'Blockquote', 'tb.callout': 'Callout (> [!NOTE])',
    'tb.ul': 'Bulleted list', 'tb.ol': 'Numbered list', 'tb.task': 'Task list',
    'tb.outdent': 'Outdent (Shift+Tab)', 'tb.indent': 'Indent (Tab)',
    'tb.codeblock': 'Insert code block', 'tb.table': 'Insert table', 'tb.image': 'Insert image',
    'tb.rule': 'Insert horizontal rule',
    'tb.h1': 'Heading 1', 'tb.h2': 'Heading 2', 'tb.h3': 'Heading 3',
    'tb.h4': 'Heading 4', 'tb.h5': 'Heading 5', 'tb.h6': 'Heading 6',
    'tb.tableControls': 'Table controls',
    'tb.rowAfter': 'Insert row below', 'tb.rowDelete': 'Delete row',
    'tb.colAfter': 'Insert column right', 'tb.colDelete': 'Delete column',
    'tb.rowPlus': '+ Row', 'tb.rowMinus': '− Row', 'tb.colPlus': '+ Col', 'tb.colMinus': '− Col',
    'tb.newTab': 'New tab (Ctrl+N)', 'tb.newTabName': 'New tab',
    'win.minimize': 'Minimize', 'win.maximize': 'Maximize', 'win.close': 'Close',
    'src.label': 'Markdown source',
    'banner.conflict': '⚠ “{name}” changed on disk while you had unsaved edits.',
    'banner.keepMine': 'Keep my edits', 'banner.reload': 'Reload from disk',
    'tab.conflictTip': '{name} — changed on disk (unresolved)',

  },
  ar: {
    'menu.file': 'ملف', 'menu.edit': 'تحرير', 'menu.view': 'عرض', 'menu.help': 'مساعدة',
    'action.openFolder': 'فتح مجلد', 'action.openFile': 'فتح ملف',
    'action.newNote': 'ملاحظة جديدة', 'action.save': 'حفظ', 'action.export': 'تصدير HTML',
    'panel.files': 'الملفات', 'panel.tags': 'الوسوم', 'panel.search': 'بحث',
    'sidebar.openFiles': 'ملفات مفتوحة', 'sidebar.closeFolder': 'إغلاق المجلد',
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
    // T-F19 chrome: menu, palette and Settings dialog.
    'menu.chrome': 'الإطار', 'menu.autoHideTitlebar': 'إخفاء الشريط العلوي تلقائيًا',
    'menu.hideStatusBar': 'إخفاء شريط الحالة', 'menu.settings': 'الإعدادات…',
    'palette.autoHideTitlebar': 'إخفاء الشريط العلوي تلقائيًا', 'palette.hideStatusBar': 'إخفاء شريط الحالة',
    'palette.settings': 'الإعدادات…',
    // v10 redesign: the "on" state of the same two toggles (see the English block's
    // comment). Proposed wording — please correct on sight.
    'menu.alwaysShowTitlebar': 'إظهار الشريط العلوي دائمًا', 'menu.showStatusBar': 'إظهار شريط الحالة',
    'palette.alwaysShowTitlebar': 'إظهار الشريط العلوي دائمًا', 'palette.showStatusBar': 'إظهار شريط الحالة',
    'settings.title': 'الإعدادات', 'settings.window': 'النافذة', 'settings.appearance': 'المظهر',
    'settings.windowTitle': 'عنوان النافذة',
    'settings.windowTitleDesc': 'ما يظهر في شريط المهام وفي Alt+Tab. أيقونة البرنامج لا تتغيّر، والملفات غير المحفوظة تُعلّم بنقطة في البداية.',
    'settings.titleModeFile': 'اسم الملف', 'settings.titleModeApp': 'اسم البرنامج',
    'settings.autoHideTitlebar': 'إخفاء الشريط العلوي تلقائيًا',
    'settings.autoHideTitlebarDesc': 'يُخفي الشريط العلوي وأزرار النافذة حتّى يبلغ المؤشّر الحافّة العليا. متاح دائمًا من قائمة عرض أو بـ Ctrl+Shift+T. ولا يمكن سحب النافذة وهو مخفيّ.',
    'settings.hideStatusBar': 'إخفاء شريط الحالة',
    'settings.hideStatusBarDesc': 'يُزيل شريط الحالة ويعيد مساحته للملاحظة. Ctrl+Shift+B.',
    'settings.files': 'الملفات',
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
    // T-F18: مفتاحا اللوحتين المنقولان إلى شريط العنوان.
    'titlebar.toggleSidebar': 'إظهار/إخفاء الشريط الجانبي', 'titlebar.toggleInspector': 'إظهار/إخفاء المُعايِن',
    // v10 redesign (2026-08-25): مفتاح ملء الشاشة، يتبدّل نصّه مع الحالة.
    'titlebar.fullscreen': 'ملء الشاشة', 'titlebar.exitFullscreen': 'الخروج من ملء الشاشة',
    // Command palette (T-R7). Latin acronyms (HTML/PDF/RTL/LTR) + product name stay verbatim.
    'palette.placeholder': 'اكتب أمرًا أو ابحث في الملفات…', 'palette.noMatches': 'لا نتائج.',
    'palette.navigate': 'تنقّل', 'palette.openHint': 'فتح', 'palette.close': 'إغلاق',
    'palette.sec.files': 'الملفات', 'palette.sec.view': 'عرض', 'palette.sec.help': 'مساعدة', 'palette.sec.filesInFolder': 'ملفات في المجلد',
    'palette.openFolder': 'فتح مجلد…', 'palette.openFile': 'فتح ملف…', 'palette.newNote': 'ملاحظة جديدة',
    'palette.save': 'حفظ', 'palette.exportHtml': 'تصدير HTML', 'palette.exportPdf': 'تصدير PDF', 'palette.loadDemo': 'تحميل ملاحظات تجريبية',
    'palette.modeLive': 'الوضع: معاينة حيّة', 'palette.modeSplit': 'الوضع: عرض مقسّم', 'palette.modeSource': 'الوضع: المصدر',
    'palette.toggleCmEditor': 'تبديل محرّر المعاينة الحيّة (CodeMirror)',
    'palette.toggleReading': 'وضع القراءة',
    'palette.flip': 'قلب الاتجاه (RTL ⇄ LTR)',
    'palette.themePaper': 'السمة: ورقي', 'palette.themeInk': 'السمة: حبر', 'palette.themeSepia': 'السمة: بنّي داكن',
    'palette.toggleSidebar': 'إظهار/إخفاء الشريط الجانبي', 'palette.toggleInspector': 'إظهار/إخفاء المُعايِن',
    'palette.toggleArabic': 'تبديل الواجهة العربية (العربية)', 'palette.toggleKashida': 'تبديل الضبط بالكشيدة',
    'palette.toggleItalic': 'تبديل تلوين المائل',
    'palette.zoomIn': 'تكبير', 'palette.zoomOut': 'تصغير', 'palette.resetZoom': 'إعادة التكبير',
    'palette.shortcuts': 'اختصارات لوحة المفاتيح', 'palette.about': 'حول BP MD RTL Reader',
    'readerControls.toggle': 'إعدادات القراءة', 'readerControls.title': 'إعدادات القراءة', 'readerControls.textSize': 'حجم النص',
    'readerControls.decreaseText': 'تصغير حجم النص', 'readerControls.increaseText': 'زيادة حجم النص', 'readerControls.resetText': 'إعادة حجم النص',
    'readerControls.contentWidth': 'عرض المحتوى',
    // v1.2 حوار الإغلاق بنمط Word: ثلاثة خيارات بدل confirm() الإنجليزي ثنائي الخيارات.
    'dlg.unsavedTitle': 'تغييرات غير محفوظة',
    'dlg.saveOnePre': 'هل تريد حفظ التغييرات في ',
    'dlg.saveOnePost': '؟',
    'dlg.saveMany': 'لديك {n} ملاحظة غير محفوظة. هل تريد حفظها قبل الإغلاق؟',
    'dlg.hint': 'ستفقد تغييراتك إن لم تحفظها.',
    'dlg.save': 'حفظ', 'dlg.saveAll': 'حفظ الكل',
    'dlg.dontSave': 'عدم الحفظ', 'dlg.closeWithoutSaving': 'إغلاق دون حفظ',
    'dlg.cancel': 'إلغاء',
    // الاسترداد بعد الأعطال أو الإغلاق القسري.
    'recovery.title': 'استرداد ملاحظات غير محفوظة؟',
    'recovery.body': 'توجد {n} ملاحظة من جلسة سابقة لم تُحفظ. هل تريد استعادتها؟',
    'recovery.restore': 'استرداد', 'recovery.discard': 'تجاهل',
    'recovery.hint': 'تُفتح كنسخ غير محفوظة — استخدم «حفظ باسم» للاحتفاظ بها.',
    'recovery.restored': 'استُرجعت {n} ملاحظة — احفظها للاحتفاظ بها',
    // الإعدادات: حفظ تلقائي اختياري (للملفات المفتوحة من القرص فقط).
    'settings.autosave': 'الحفظ التلقائي',
    'settings.autosaveDesc': 'يحفظ الملفات المفتوحة تلقائيًا كل 30 ثانية تقريبًا. الملاحظات بلا اسم تحتاج «حفظ باسم».',
    // رسائل التوست (كانت إنجليزية ثابتة في كل مواضع الاستدعاء).
    'toast.saved': 'تم حفظ {name}', 'toast.savedAs': 'تم الحفظ باسم {name}',
    'toast.noFileToSave': 'لا ملف للحفظ',
    'toast.couldNotSave': 'تعذّر الحفظ',
    'toast.couldNotSaveName': 'تعذّر حفظ {name} ({reason})',
    'toast.saveCanceled': 'أُلغي الحفظ — الملاحظة ما زالت غير محفوظة',
    'toast.downloaded': 'تم تنزيل {name}',
    'toast.openedFile': 'فُتح {name}', 'toast.couldNotOpenFile': 'تعذّر فتح الملف',
    'toast.openFileFailed': 'تعذّر فتح «{name}»',
    'toast.folderNoNotes': 'فُتح المجلد — لا ملفات .md',
    'toast.openedFolder': 'فُتح «{name}» — {n} ملاحظة',
    'toast.couldNotOpenFolder': 'تعذّر فتح المجلد',
    'toast.demoLoaded': 'حُمّلت الملاحظات التجريبية',
    'toast.skippedType': 'تخطّينا «{name}» — المسموح .md/.markdown/.txt فقط',
    'toast.skippedSize': 'تخطّينا «{name}» — يتجاوز حد 10 ميغابايت',
    'toast.couldNotRead': 'تعذّرت قراءة «{name}»',
    'toast.loadedN': 'حُمّلت {n} ملفات',
    'toast.reopenedConflict': '«{name}» مفتوح بتعديلات غير محفوظة — أبقينا نسختك',
    'toast.reloaded': 'أُعيد التحميل من القرص', 'toast.keptEdits': 'أبقينا تعديلاتك',
    'toast.vaultTruncated': 'المجلد كبير — نعرض أول {n} ملف',
    'toast.leftVault': '«{name}» حُفظ خارج المجلد المفتوح',
    // شريط الحالة (كان إنجليزيًا ثابتًا).
    'status.noFolder': 'لا مجلد', 'status.folder': 'مجلد: {name}', 'status.folders': 'مجلدات: {n}',
    'status.lnCol': 'س {l} · عمود {c}', 'status.nWords': '{n} كلمة',
    'sc.cycleTheme': 'تبديل السمة',
    // كليك يمين: بنود كل سطح (شجرة الملفات / التبويبات / روابط الويكي).
    'ctx.reveal': 'إظهار في مستكشف الملفات', 'ctx.copyPath': 'نسخ المسار',
    'ctx.close': 'إغلاق', 'ctx.closeOthers': 'إغلاق التبويبات الأخرى', 'ctx.closeAll': 'إغلاق كل التبويبات',
    'ctx.duplicate': 'مضاعفة الملاحظة', 'ctx.openNote': 'فتح الملاحظة', 'ctx.copyName': 'نسخ الاسم',
    'ctxmenu.label': 'القائمة السياقية', 'dropdown.label': 'القائمة',
    'toast.theme': 'السمة: {name}', 'toast.direction': 'الاتجاه: {dir}',
    'toast.sidebar': 'الشريط الجانبي: {state}', 'toast.inspector': 'المُعايِن: {state}',
    'toast.shown': 'ظاهر', 'toast.hidden': 'مخفي',
    'toast.calendar': 'التقويم: {name}',
    'toast.kashida': 'ضبط العربية: {state}',
    'toast.italicRecolor': 'تلوين المائل: {state}',
    'toast.on': 'مفعل', 'toast.off': 'معطل', 'toast.kashidaOn': 'بالكشيدة', 'toast.kashidaOff': 'متعرج',
    'toast.cmEditor': 'محرّر المعاينة الحيّة: {state}',
    'toast.updateAvailable': 'يتوفر تحديث: {latest} (لديك {current})',
    'toast.upToDate': 'لديك أحدث إصدار ({current})',
    'toast.exported': 'تم تصدير {name}',
    'toast.noNoteFound': 'لا ملاحظة باسم «{target}»',
    'toast.openedNFiles': 'فُتحت {n} ملفات',
    'toast.topbarHidden': 'الشريط العلوي مخفي — حرّك المؤشر إلى الحافة العليا أو اضغط Ctrl+Shift+T. وCtrl+, يفتح الإعدادات.',
    'toast.statusbarHidden': 'شريط الحالة مخفي — اضغط Ctrl+Shift+B لإعادته. وCtrl+, يفتح الإعدادات.',
    'doc.unsaved': 'غير محفوظة', 'doc.readTime': '≈ {n} د قراءة',
    // v1.2: شريط أدوات الكتابة (كان بلا أي تعريب — 24 تلميحاً إنجليزياً). أقواس الاختصارات
    // محتوى لا يُترجم.
    'tb.heading': 'مستوى العنوان', 'tb.bold': 'عريض (Ctrl+B)', 'tb.boldName': 'عريض',
    'tb.italic': 'مائل (Ctrl+I)', 'tb.italicName': 'مائل',
    'tb.strike': 'يتوسطه خط', 'tb.underline': 'تسطير',
    'tb.code': 'شفرة داخل السطر', 'tb.highlight': 'تظليل (==)',
    'tb.sub': 'أسفل النص (~x~)', 'tb.sup': 'أعلى النص (^x^)',
    'tb.clear': 'مسح التنسيق', 'tb.link': 'إدراج رابط', 'tb.wikilink': 'إدراج رابط ويكي',
    'tb.math': 'رياضيات داخل السطر (KaTeX)', 'tb.footnote': 'إدراج هامش سفلي',
    'tb.quote': 'اقتباس', 'tb.callout': 'تنبيه (> [!NOTE])',
    'tb.ul': 'قائمة نقطية', 'tb.ol': 'قائمة مرقمة', 'tb.task': 'قائمة مهام',
    'tb.outdent': 'تقليل الإزاحة (Shift+Tab)', 'tb.indent': 'زيادة الإزاحة (Tab)',
    'tb.codeblock': 'إدراج كتلة شفرة', 'tb.table': 'إدراج جدول', 'tb.image': 'إدراج صورة',
    'tb.rule': 'إدراج فاصل أفقي',
    'tb.h1': 'عنوان 1', 'tb.h2': 'عنوان 2', 'tb.h3': 'عنوان 3',
    'tb.h4': 'عنوان 4', 'tb.h5': 'عنوان 5', 'tb.h6': 'عنوان 6',
    'tb.tableControls': 'أدوات الجدول',
    'tb.rowAfter': 'إدراج صف أسفل', 'tb.rowDelete': 'حذف الصف',
    'tb.colAfter': 'إدراج عمود لليمين', 'tb.colDelete': 'حذف العمود',
    'tb.rowPlus': '+ صف', 'tb.rowMinus': '− صف', 'tb.colPlus': '+ عمود', 'tb.colMinus': '− عمود',
    'tb.newTab': 'تبويب جديد (Ctrl+N)', 'tb.newTabName': 'تبويب جديد',
    'win.minimize': 'تصغير', 'win.maximize': 'تكبير', 'win.close': 'إغلاق',
    'src.label': 'مصدر الماركداون',
    'banner.conflict': '⚠ «{name}» تغيّر على القرص أثناء وجود تعديلات غير محفوظة.',
    'banner.keepMine': 'أبقِ تعديلاتي', 'banner.reload': 'أعد التحميل من القرص',
    'tab.conflictTip': '{name} — تغيّر على القرص (لم يُحسم)',

  },
};

/** Translate a key for a locale, falling back to English then the key itself. */
export function t(key, locale = 'en') {
  return translate(MESSAGES, key, locale);
}

/**
 * Fill `{name}`-style placeholders in a catalog template. Unknown vars render as
 * empty (never the literal `{key}`), so a missing variable can't leak keys to the UI.
 */
export function formatMessage(template, vars = {}) {
  return String(template == null ? '' : template).replace(/\{(\w+)\}/g, (_, k) => {
    const v = vars[k];
    return v == null ? '' : String(v);
  });
}
