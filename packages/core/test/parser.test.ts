import { describe, expect, it } from 'vitest';
import { parseDueText, parseQuickAdd } from '../src/index.ts';

const TODAY = '2026-10-09'; // a Friday

describe('parseQuickAdd', () => {
  it('plain text becomes the title', () => {
    expect(parseQuickAdd('Buy milk', TODAY)).toEqual({
      title: 'Buy milk',
      due: null,
      recurrence: null,
      priority: null,
      projectName: null,
      labels: [],
    });
  });

  it('extracts date, priority, project and labels', () => {
    const p = parseQuickAdd('Pay rent tomorrow p1 #Home @bills @urgent', TODAY);
    expect(p.title).toBe('Pay rent');
    expect(p.due).toBe('2026-10-10');
    expect(p.priority).toBe(1);
    expect(p.projectName).toBe('Home');
    expect(p.labels).toEqual(['bills', 'urgent']);
  });

  it('understands common date phrases', () => {
    expect(parseQuickAdd('x today', TODAY).due).toBe(TODAY);
    expect(parseQuickAdd('x monday', TODAY).due).toBe('2026-10-12');
    expect(parseQuickAdd('x on friday', TODAY).due).toBe('2026-10-16');
    expect(parseQuickAdd('x next week', TODAY).due).toBe('2026-10-12');
    expect(parseQuickAdd('x in 3 days', TODAY).due).toBe('2026-10-12');
    expect(parseQuickAdd('x in 2 weeks', TODAY).due).toBe('2026-10-23');
    expect(parseQuickAdd('x Dec 25', TODAY).due).toBe('2026-12-25');
    expect(parseQuickAdd('x 3 jan', TODAY).due).toBe('2027-01-03');
    expect(parseQuickAdd('x 2026-11-01', TODAY).due).toBe('2026-11-01');
  });

  it('ignores invalid dates and leaves them in the title', () => {
    const p = parseQuickAdd('x feb 31', TODAY);
    expect(p.due).toBeNull();
    expect(p.title).toBe('x feb 31');
  });

  it('repeating tasks get a recurrence and a start date', () => {
    const daily = parseQuickAdd('Water plants every day', TODAY);
    expect([daily.due, daily.recurrence, daily.title]).toEqual([TODAY, 'daily', 'Water plants']);
    const weekly = parseQuickAdd('Team meeting every monday', TODAY);
    expect([weekly.recurrence, weekly.due]).toEqual(['weekly', '2026-10-12']);
    expect(parseQuickAdd('Standup every weekday', '2026-10-10').due).toBe('2026-10-12'); // Saturday
    expect(parseQuickAdd('Review every friday', TODAY).due).toBe(TODAY);
  });

  it('a specific date wins over the date a repeat gives', () => {
    const p = parseQuickAdd('Bins every week tuesday', TODAY);
    expect([p.recurrence, p.due]).toEqual(['weekly', '2026-10-13']);
  });

  it('does not treat words inside other words as shortcuts', () => {
    const p = parseQuickAdd('Email bob@example.com about p10 issue', TODAY);
    expect(p.title).toBe('Email bob@example.com about p10 issue');
    expect(p.labels).toEqual([]);
    expect(p.priority).toBeNull();
  });

  it('drops duplicate labels ignoring case', () => {
    expect(parseQuickAdd('x @Home @home', TODAY).labels).toEqual(['Home']);
  });

  it('reads a due date typed on its own, short weekday names included', () => {
    // 2026-11-15 is a Sunday.
    expect(parseDueText('fri', '2026-11-15')).toEqual({ due: '2026-11-20', ok: true });
    expect(parseDueText('next Tue', '2026-11-15')).toEqual({ due: '2026-11-17', ok: true });
    expect(parseDueText('thurs', '2026-11-15')).toEqual({ due: '2026-11-19', ok: true });
    expect(parseDueText('none', '2026-11-15')).toEqual({ due: null, ok: true });
    expect(parseDueText('someday', '2026-11-15')).toEqual({ due: null, ok: false });
    // Quick Add leaves short names in the title.
    expect(parseQuickAdd('Buy sun cream', '2026-11-15')).toMatchObject({ title: 'Buy sun cream', due: null });
  });
});
