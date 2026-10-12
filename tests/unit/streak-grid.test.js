import { describe, test, expect } from 'vitest';
import { streakGrid, readingLevel } from '../../src/renderer/components/streak-grid.js';

describe('readingLevel', () => {
  test('is 0 for no reading and scales with the goal', () => {
    expect(readingLevel(0, 10)).toBe(0);
    expect(readingLevel(3, 10)).toBe(1);
    expect(readingLevel(5, 10)).toBe(2);
    expect(readingLevel(10, 10)).toBe(3);
    expect(readingLevel(20, 10)).toBe(4);
  });

  test('without a goal any reading is level 1', () => {
    expect(readingLevel(0, 0)).toBe(0);
    expect(readingLevel(1, 0)).toBe(1);
    expect(readingLevel(90, 0)).toBe(1);
  });

  test('ignores invalid minutes', () => {
    expect(readingLevel(-4, 10)).toBe(0);
    expect(readingLevel(NaN, 10)).toBe(0);
    expect(readingLevel(undefined, 10)).toBe(0);
  });
});

describe('streakGrid', () => {
  const TODAY = '2026-10-03';

  test('lays out whole Monday-first weeks ending with the current week', () => {
    const cells = streakGrid({}, TODAY, { weeks: 2, goal: 10 });
    expect(cells).toHaveLength(14);
    expect(cells[0].date).toBe('2026-09-21');
    expect(cells[6].date).toBe('2026-09-27');
    expect(cells[7].date).toBe('2026-09-28');
    expect(cells[12].date).toBe(TODAY);
    expect(cells[13].date).toBe('2026-10-04');
  });

  test('marks only the days after today as future', () => {
    const cells = streakGrid({}, TODAY, { weeks: 2, goal: 10 });
    expect(cells.filter((c) => c.future).map((c) => c.date)).toEqual(['2026-10-04']);
    expect(cells[12].future).toBe(false);
  });

  test('carries minutes and level from the stored days', () => {
    const cells = streakGrid({ '2026-10-03': 12, '2026-10-01': 4, '2026-09-28': 25 }, TODAY, { weeks: 2, goal: 10 });
    const byDate = new Map(cells.map((c) => [c.date, c]));
    expect(byDate.get('2026-10-03')).toMatchObject({ minutes: 12, level: 3, future: false });
    expect(byDate.get('2026-10-01')).toMatchObject({ minutes: 4, level: 1 });
    expect(byDate.get('2026-09-28')).toMatchObject({ minutes: 25, level: 4 });
    expect(byDate.get('2026-09-30')).toMatchObject({ minutes: 0, level: 0 });
  });

  test('a Sunday today ends its own week column', () => {
    const cells = streakGrid({}, '2026-10-04', { weeks: 1, goal: 10 });
    expect(cells.map((c) => c.date)).toEqual([
      '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04',
    ]);
    expect(cells.some((c) => c.future)).toBe(false);
  });

  test('crosses a month and a year boundary', () => {
    const cells = streakGrid({}, '2027-01-02', { weeks: 1, goal: 10 });
    expect(cells[0].date).toBe('2026-12-28');
    expect(cells[5].date).toBe('2027-01-02');
  });

  test('defaults to twelve weeks', () => {
    expect(streakGrid({}, TODAY, { goal: 10 })).toHaveLength(84);
    expect(streakGrid({}, TODAY)).toHaveLength(84);
  });

  test('tolerates missing days and rejects a bad date', () => {
    expect(streakGrid(null, TODAY, { weeks: 1 }).every((c) => c.minutes === 0)).toBe(true);
    expect(streakGrid({}, 'nope', { weeks: 2 })).toEqual([]);
    expect(streakGrid({}, undefined, { weeks: 2 })).toEqual([]);
  });

  test('ignores non-numeric stored values', () => {
    const cells = streakGrid({ '2026-10-03': 'lots' }, TODAY, { weeks: 1, goal: 10 });
    expect(cells.find((c) => c.date === TODAY)).toMatchObject({ minutes: 0, level: 0 });
  });
});
