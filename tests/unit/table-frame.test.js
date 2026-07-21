/**
 * @vitest-environment jsdom
 */
import { describe, expect, test, vi } from 'vitest';
import { tableFrameLabel, updateTableFrameOverflow, wrapTablesInFrames } from '../../src/renderer/table-frame.js';

function rootWithTable(dir = 'ltr') {
  const root = document.createElement('div');
  root.innerHTML = `<table dir="${dir}"><tr><td>Cell</td></tr></table>`;
  return root;
}

function setWidths(frame, clientWidth, scrollWidth) {
  Object.defineProperty(frame, 'clientWidth', { configurable: true, value: clientWidth });
  Object.defineProperty(frame, 'scrollWidth', { configurable: true, value: scrollWidth });
}

describe('table frames', () => {
  test('wraps once, preserves the table direction, and labels the accessible scroll region', () => {
    const root = rootWithTable('rtl');

    wrapTablesInFrames(root, { locale: 'ar' });
    wrapTablesInFrames(root, { locale: 'ar' });

    const frame = root.querySelector('.table-frame');
    const table = frame.querySelector('table');
    expect(root.querySelectorAll('.table-frame')).toHaveLength(1);
    expect(table.getAttribute('dir')).toBe('rtl');
    expect(frame.getAttribute('role')).toBe('region');
    expect(frame.getAttribute('aria-label')).toBe('جدول قابل للتمرير أفقيًا');
  });

  test('makes only an overflowing frame keyboard-focusable', () => {
    const root = rootWithTable();
    wrapTablesInFrames(root);
    const frame = root.querySelector('.table-frame');

    setWidths(frame, 240, 480);
    expect(updateTableFrameOverflow(frame)).toBe(true);
    expect(frame.getAttribute('tabindex')).toBe('0');

    setWidths(frame, 240, 240);
    expect(updateTableFrameOverflow(frame)).toBe(false);
    expect(frame.hasAttribute('tabindex')).toBe(false);
  });

  test('does not require ResizeObserver in DOM test environments', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const root = rootWithTable();

    expect(() => wrapTablesInFrames(root)).not.toThrow();
    vi.unstubAllGlobals();
  });

  test('uses the English label by default', () => {
    expect(tableFrameLabel()).toBe('Scrollable table');
  });
});
