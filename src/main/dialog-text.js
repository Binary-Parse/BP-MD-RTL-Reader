'use strict';

/**
 * dialog-text.js — titles and filter names of the native file dialogs, in the interface
 * language (QA-L2). The renderer's catalog lives in the page; main keeps this small map,
 * like context-menu.js and window-health.js do for their own text.
 */

const EN = Object.freeze({
  openFolder: 'Open Folder',
  openFile: 'Open File',
  saveMarkdown: 'Save Markdown File',
  markdown: 'Markdown',
  exportPdf: 'Export PDF',
  pdfDocument: 'PDF Document',
  exportEpub: 'Export EPUB',
  epubBook: 'EPUB Book',
  exportHtml: 'Export HTML',
  htmlDocument: 'HTML Document',
});

const AR = Object.freeze({
  openFolder: 'فتح مجلد',
  openFile: 'فتح ملف',
  saveMarkdown: 'حفظ ملف ماركداون',
  markdown: 'ماركداون',
  exportPdf: 'تصدير PDF',
  pdfDocument: 'مستند PDF',
  exportEpub: 'تصدير EPUB',
  epubBook: 'كتاب EPUB',
  exportHtml: 'تصدير HTML',
  htmlDocument: 'مستند HTML',
});

/** The dialog text for a UI locale; anything but 'ar' is English. */
function dialogText(locale) {
  return locale === 'ar' ? AR : EN;
}

module.exports = { dialogText };
