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
    expect(parseQuickAdd('x next week', TODAY).due).toBe('2026-10-16');
    expect(parseQuickAdd('x in 3 days', TODAY).due).toBe('2026-10-12');
    expect(parseQuickAdd('x in 2 weeks', TODAY).due).toBe('2026-10-23');
    expect(parseQuickAdd('x Dec 25', TODAY).due).toBe('2026-12-25');
    expect(parseQuickAdd('x 3 jan', TODAY).due).toBe('2027-01-03');
    expect(parseQuickAdd('x 2026-11-01', TODAY).due).toBe('2026-11-01');
  });

  it('reads "next" and amounts of time from today', () => {
    const due = (text: string, today = TODAY) => parseQuickAdd(`x ${text}`, today).due;
    // TODAY is Friday 2026-10-09.
    expect(due('next week')).toBe('2026-10-16');
    expect(due('next month')).toBe('2026-11-09');
    expect(due('next year')).toBe('2027-10-09');
    expect(due('next monday')).toBe('2026-10-19');
    expect(due('next friday')).toBe('2026-10-16');
    expect(due('this friday')).toBe(TODAY);
    expect(due('this weekend')).toBe('2026-10-10');
    expect(due('next weekend')).toBe('2026-10-17');
    expect(due('in a week')).toBe('2026-10-16');
    expect(due('in two months')).toBe('2026-12-09');
    expect(due('in 1 year')).toBe('2027-10-09');
    expect(due('3 days from now')).toBe('2026-10-12');
    expect(due('the day after tomorrow')).toBe('2026-10-11');
    expect(due('end of month')).toBe('2026-10-31');
    expect(due('next month', '2026-01-31')).toBe('2026-02-28');
    // On a Sunday, "next monday" is not tomorrow; plain "monday" is.
    const sunday = '2026-11-15';
    expect(due('next monday', sunday)).toBe('2026-11-23');
    expect(due('monday', sunday)).toBe('2026-11-16');
    expect(due('next week', sunday)).toBe('2026-11-22');
    expect(parseDueText('next mon', sunday)).toEqual({ due: '2026-11-23', ok: true });
    expect(parseQuickAdd('Call mum next monday p2', sunday)).toMatchObject({
      title: 'Call mum',
      priority: 2,
    });
    expect(parseQuickAdd('Plan the weekend trip', sunday)).toMatchObject({
      title: 'Plan the weekend trip',
      due: null,
    });
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
    expect(parseDueText('next Tue', '2026-11-15')).toEqual({ due: '2026-11-24', ok: true });
    expect(parseDueText('thurs', '2026-11-15')).toEqual({ due: '2026-11-19', ok: true });
    expect(parseDueText('none', '2026-11-15')).toEqual({ due: null, ok: true });
    expect(parseDueText('someday', '2026-11-15')).toEqual({ due: null, ok: false });
    // Quick Add leaves short names in the title.
    expect(parseQuickAdd('Buy sun cream', '2026-11-15')).toMatchObject({ title: 'Buy sun cream', due: null });
  });

  it('takes "on" with a month date, as it does with a weekday', () => {
    expect(parseQuickAdd('Call mom on may 5', '2026-03-10')).toMatchObject({
      title: 'Call mom',
      due: '2026-05-05',
    });
    expect(parseQuickAdd('Call mom on 5 may', '2026-03-10')).toMatchObject({
      title: 'Call mom',
      due: '2026-05-05',
    });
  });

  it('finds the next feb 29 when this year and next have none', () => {
    expect(parseQuickAdd('Leap party feb 29', '2027-03-01')).toMatchObject({
      title: 'Leap party',
      due: '2028-02-29',
    });
    expect(parseQuickAdd('Nope feb 31', '2027-03-01').due).toBeNull();
  });
});
