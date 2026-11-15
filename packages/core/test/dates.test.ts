import { describe, expect, it } from 'vitest';
import {
  firstDayOfWeek,
  monthGrid,
  startOfWeek,
  addDays,
  addMonths,
  diffDays,
  formatDue,
  isISODate,
  nextOccurrence,
  nextWeekday,
} from '../src/index.ts';

describe('dates', () => {
  it('addDays crosses month and year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('addMonths clamps to the end of shorter months', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-11-15', 2)).toBe('2027-01-15');
  });

  it('diffDays works across DST changes', () => {
    expect(diffDays('2026-03-07', '2026-03-09')).toBe(2);
    expect(diffDays('2026-11-02', '2026-10-31')).toBe(-2);
  });

  it('nextWeekday is strictly after the start date', () => {
    // 2026-10-09 is a Friday.
    expect(nextWeekday(5, '2026-10-09')).toBe('2026-10-16');
    expect(nextWeekday(1, '2026-10-09')).toBe('2026-10-12');
  });

  it('nextOccurrence keeps the day of the month when it catches up over a short month', () => {
    expect(nextOccurrence('2026-01-31', 'monthly', '2026-03-01')).toBe('2026-03-31');
    expect(nextOccurrence('2026-01-31', 'monthly', '2026-01-31')).toBe('2026-02-28');
    expect(nextOccurrence('2024-02-29', 'yearly', '2027-06-01')).toBe('2028-02-29');
  });

  it('nextOccurrence goes back to the day the repeat was set on after a short month', () => {
    expect(nextOccurrence('2026-02-28', 'monthly', '2026-02-28', 31)).toBe('2026-03-31');
    expect(nextOccurrence('2026-02-28', 'monthly', '2026-02-28', 30)).toBe('2026-03-30');
    expect(nextOccurrence('2027-02-28', 'yearly', '2027-02-28', 29)).toBe('2028-02-29');
  });

  it('nextOccurrence skips past today for overdue repeating tasks', () => {
    expect(nextOccurrence('2026-10-01', 'daily', '2026-10-09')).toBe('2026-10-10');
    expect(nextOccurrence('2026-10-09', 'weekly', '2026-10-09')).toBe('2026-10-16');
    expect(nextOccurrence('2026-10-09', 'weekdays', '2026-10-09')).toBe('2026-10-12');
    expect(nextOccurrence('2026-01-31', 'monthly', '2026-01-31')).toBe('2026-02-28');
  });

  it('formatDue uses friendly words for nearby days', () => {
    expect(formatDue('2026-10-09', '2026-10-09')).toBe('Today');
    expect(formatDue('2026-10-10', '2026-10-09')).toBe('Tomorrow');
    expect(formatDue('2026-10-08', '2026-10-09')).toBe('Yesterday');
  });

  it('isISODate accepts only real dates', () => {
    expect(isISODate('2026-02-28')).toBe(true);
    expect(isISODate('2026-02-30')).toBe(false);
    expect(isISODate('tomorrow')).toBe(false);
    expect(isISODate(null)).toBe(false);
  });

  it('knows where a locale starts its week, and lays out a month', () => {
    expect(firstDayOfWeek('en-US')).toBe(0);
    expect(firstDayOfWeek('en-GB')).toBe(1);
    expect(firstDayOfWeek('de-DE')).toBe(1);
    expect(startOfWeek('2026-03-10', 1)).toBe('2026-03-09');
    expect(startOfWeek('2026-03-10', 0)).toBe('2026-03-08');
    expect(startOfWeek('2026-03-08', 0)).toBe('2026-03-08');
    const grid = monthGrid('2026-03-17', 1);
    expect(grid).toHaveLength(42);
    expect(grid[0]).toBe('2026-02-23');
    expect(grid[6]).toBe('2026-03-01');
    expect(monthGrid('2026-03-17', 0)[0]).toBe('2026-03-01');
  });
});
