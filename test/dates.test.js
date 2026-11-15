import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, addMonths, nextOccurrence, nextWeekday, formatDue, diffDays } from '../src/renderer/dates.js';

test('addDays crosses month and year boundaries', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('addMonths clamps to the end of shorter months', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2028-01-31', 1), '2028-02-29');
  assert.equal(addMonths('2026-11-15', 2), '2027-01-15');
});

test('diffDays works across DST changes', () => {
  assert.equal(diffDays('2026-03-07', '2026-03-09'), 2);
  assert.equal(diffDays('2026-11-02', '2026-10-31'), -2);
});

test('nextWeekday is strictly after the start date', () => {
  // 2026-10-09 is a Friday.
  assert.equal(nextWeekday(5, '2026-10-09'), '2026-10-16');
  assert.equal(nextWeekday(1, '2026-10-09'), '2026-10-12');
});

test('nextOccurrence skips past today for overdue repeating tasks', () => {
  assert.equal(nextOccurrence('2026-10-01', 'daily', '2026-10-09'), '2026-10-10');
  assert.equal(nextOccurrence('2026-10-09', 'weekly', '2026-10-09'), '2026-10-16');
  assert.equal(nextOccurrence('2026-10-09', 'weekdays', '2026-10-09'), '2026-10-12');
  assert.equal(nextOccurrence('2026-01-31', 'monthly', '2026-01-31'), '2026-02-28');
});

test('formatDue uses friendly words for nearby days', () => {
  assert.equal(formatDue('2026-10-09', '2026-10-09'), 'Today');
  assert.equal(formatDue('2026-10-10', '2026-10-09'), 'Tomorrow');
  assert.equal(formatDue('2026-10-08', '2026-10-09'), 'Yesterday');
});
