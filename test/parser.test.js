import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuickAdd } from '../src/renderer/parser.js';

const TODAY = '2026-10-09'; // a Friday

test('plain text becomes the title', () => {
  const p = parseQuickAdd('Buy milk', TODAY);
  assert.deepEqual(p, { title: 'Buy milk', due: null, recurrence: null, priority: null, projectName: null, labels: [] });
});

test('extracts date, priority, project and labels', () => {
  const p = parseQuickAdd('Pay rent tomorrow p1 #Home @bills @urgent', TODAY);
  assert.equal(p.title, 'Pay rent');
  assert.equal(p.due, '2026-10-10');
  assert.equal(p.priority, 1);
  assert.equal(p.projectName, 'Home');
  assert.deepEqual(p.labels, ['bills', 'urgent']);
});

test('understands common date phrases', () => {
  assert.equal(parseQuickAdd('x today', TODAY).due, TODAY);
  assert.equal(parseQuickAdd('x monday', TODAY).due, '2026-10-12');
  assert.equal(parseQuickAdd('x on friday', TODAY).due, '2026-10-16');
  assert.equal(parseQuickAdd('x next week', TODAY).due, '2026-10-12');
  assert.equal(parseQuickAdd('x in 3 days', TODAY).due, '2026-10-12');
  assert.equal(parseQuickAdd('x in 2 weeks', TODAY).due, '2026-10-23');
  assert.equal(parseQuickAdd('x Dec 25', TODAY).due, '2026-12-25');
  assert.equal(parseQuickAdd('x 3 jan', TODAY).due, '2027-01-03');
  assert.equal(parseQuickAdd('x 2026-11-01', TODAY).due, '2026-11-01');
});

test('ignores invalid dates and leaves them in the title', () => {
  const p = parseQuickAdd('x feb 31', TODAY);
  assert.equal(p.due, null);
  assert.equal(p.title, 'x feb 31');
});

test('repeating tasks get a recurrence and a start date', () => {
  assert.deepEqual(
    (({ due, recurrence, title }) => ({ due, recurrence, title }))(parseQuickAdd('Water plants every day', TODAY)),
    { due: TODAY, recurrence: 'daily', title: 'Water plants' });
  const weekly = parseQuickAdd('Team meeting every monday', TODAY);
  assert.equal(weekly.recurrence, 'weekly');
  assert.equal(weekly.due, '2026-10-12');
  const weekdays = parseQuickAdd('Standup every weekday', '2026-10-10'); // Saturday
  assert.equal(weekdays.due, '2026-10-12');
});

test('does not treat words inside other words as shortcuts', () => {
  const p = parseQuickAdd('Email bob@example.com about p10 issue', TODAY);
  assert.equal(p.title, 'Email bob@example.com about p10 issue');
  assert.deepEqual(p.labels, []);
  assert.equal(p.priority, null);
});
