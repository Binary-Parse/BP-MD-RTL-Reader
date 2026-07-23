/**
 * @vitest-environment jsdom
 */
import { describe, expect, test, vi } from 'vitest';
import { tableFrameLabel, updateTableFrameOverflow, wrapTablesInFrames } from '../../src/renderer/components/table-frame.js';

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

  test('updates overflow on window resize when ResizeObserver is unavailable', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const root = rootWithTable();
    document.body.appendChild(root);
    wrapTablesInFrames(root);
    const frame = root.querySelector('.table-frame');

    setWidths(frame, 240, 240);
    expect(frame.hasAttribute('tabindex')).toBe(false);
    setWidths(frame, 240, 480);
    window.dispatchEvent(new Event('resize'));
    expect(frame.getAttribute('tabindex')).toBe('0');
    setWidths(frame, 240, 240);
    window.dispatchEvent(new Event('resize'));
    expect(frame.hasAttribute('tabindex')).toBe(false);

    root.remove();
    vi.unstubAllGlobals();
  });

  test('schedules cleanup for a detached no-ResizeObserver frame when the next render has no tables', async () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const root = rootWithTable();
    document.body.appendChild(root);
    wrapTablesInFrames(root);

    // Let the initial deferred cleanup run while the frame is still connected.
    await Promise.resolve();
    const cleanupSchedule = vi.spyOn(globalThis, 'queueMicrotask');
    root.remove();
    wrapTablesInFrames(document.createElement('div'));
    expect(cleanupSchedule).toHaveBeenCalledTimes(1);
    await Promise.resolve();

    cleanupSchedule.mockRestore();
    vi.unstubAllGlobals();
  });
  test('uses the English label by default', () => {
    expect(tableFrameLabel()).toBe('Scrollable table');
  });
});
