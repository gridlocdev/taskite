import { beforeEach, describe, expect, it } from 'vitest';
import {
  INBOX_ID,
  TaskList,
  addDraft,
  dueTone,
  emptyData,
  resolveDraft,
  resolveView,
  sidebarCounts,
  trashAge,
  viewContent,
  visibleIds,
  DAY_MS,
} from '../src/index.ts';

const TODAY = '2026-10-09'; // a Friday
let list: TaskList;

beforeEach(() => {
  let n = 0;
  list = new TaskList(emptyData(), { newId: () => `t${++n}`, now: () => 0 });
});

const titles = (view: Parameters<typeof viewContent>[1]) =>
  viewContent(list, view, TODAY).sections.map((s) => [s.heading, s.rows.map((r) => r.task.title)]);

describe('views', () => {
  it('a project lists open tasks in order with their open subtasks under them', () => {
    const a = list.addTask({ title: 'A' });
    list.addTask({ title: 'B' });
    list.addTask({ title: 'A1', parentId: a.id });
    const done = list.addTask({ title: 'A2', parentId: a.id });
    list.completeTasks(done.id);
    const content = viewContent(list, { type: 'project', id: INBOX_ID }, TODAY);
    expect(content.sections[0]?.rows.map((r) => [r.task.title, r.isSubtask])).toEqual([
      ['A', false],
      ['A1', true],
      ['B', false],
    ]);
    expect(content.empty).toBeNull();
  });

  it('Today shows overdue first, then today by priority', () => {
    list.addTask({ title: 'late', due: '2026-10-01' });
    list.addTask({ title: 'today p4', due: TODAY });
    list.addTask({ title: 'today p1', due: TODAY, priority: 1 });
    list.addTask({ title: 'later', due: '2026-10-20' });
    const sections = titles({ type: 'today' });
    expect(sections[0]).toEqual(['Overdue', ['late']]);
    expect(sections[1]?.[1]).toEqual(['today p1', 'today p4']);
  });

  it('Today with nothing due is empty', () => {
    expect(viewContent(list, { type: 'today' }, TODAY).empty?.title).toBe('Nothing due today');
  });

  it('Upcoming has the rest of this week a day at a time, then Next Week, then Later', () => {
    // TODAY is Friday 2026-10-09.
    list.addTask({ title: 'sat', due: '2026-10-10' });
    list.addTask({ title: 'mon', due: '2026-10-12' });
    list.addTask({ title: 'sun after', due: '2026-10-18' });
    list.addTask({ title: 'far', due: '2026-12-01' });
    const monday = viewContent(list, { type: 'upcoming' }, TODAY, 1);
    expect(monday.sections.map((s) => s.key)).toEqual([
      'day:2026-10-09',
      'day:2026-10-10',
      'day:2026-10-11',
      'next-week',
      'later',
    ]);
    expect(monday.sections.filter((s) => s.key.startsWith('day:')).every((s) => s.addSlot === s.key)).toBe(
      true,
    );
    const next = monday.sections.find((s) => s.key === 'next-week')!;
    expect(next.rows.map((r) => r.task.title)).toEqual(['mon', 'sun after']);
    expect(next.addSlot).toBe('day:2026-10-12');
    expect(next.heading).toMatch(/^Next Week · Oct 12 – 18$/);
    expect(monday.sections.at(-1)?.rows[0]?.task.title).toBe('far');
    // A week that starts on Sunday ends on Saturday, so Sunday the 11th belongs to next week.
    const sunday = viewContent(list, { type: 'upcoming' }, TODAY, 0);
    expect(sunday.sections.map((s) => s.key)).toEqual([
      'day:2026-10-09',
      'day:2026-10-10',
      'next-week',
      'later',
    ]);
    expect(sunday.sections[2]?.heading).toMatch(/Oct 11 – 17$/);
  });

  it('Completed groups by the day tasks were done, newest first', () => {
    const l = new TaskList(emptyData(), { now: () => new Date(2026, 9, 8, 12).getTime() });
    const a = l.addTask({ title: 'a' });
    l.completeTasks(a.id);
    const content = viewContent(l, { type: 'completed' }, TODAY);
    expect(content.sections.map((s) => s.key)).toEqual(['2026-10-08']);
  });

  it('search matches titles, descriptions and labels, open tasks first', () => {
    const done = list.addTask({ title: 'milk run' });
    list.completeTasks(done.id);
    list.addTask({ title: 'x', description: 'buy MILK' });
    list.addTask({ title: 'y', labels: ['milky'] });
    list.addTask({ title: 'z' });
    expect(visibleIds(viewContent(list, { type: 'search', query: 'milk' }, TODAY))).toEqual([
      't2',
      't3',
      't1',
    ]);
  });

  it('a gone project or label view falls back to the Inbox', () => {
    expect(resolveView(list, { type: 'project', id: 'nope' })).toEqual({ type: 'project', id: INBOX_ID });
    expect(resolveView(list, { type: 'label', name: 'nope' })).toEqual({ type: 'project', id: INBOX_ID });
    list.addTask({ title: 'x', labels: ['Home'] });
    expect(resolveView(list, { type: 'label', name: 'home' })).toEqual({ type: 'label', name: 'home' });
  });

  it('sidebar counts open tasks per place', () => {
    list.addTask({ title: 'a', due: TODAY, labels: ['x'] });
    const b = list.addTask({ title: 'b' });
    list.deleteTasks(b.id);
    const counts = sidebarCounts(list, TODAY);
    expect([counts.inbox, counts.today, counts.trash, counts.labels.get('x')]).toEqual([1, 1, 1, 1]);
  });

  it('drafts take defaults from where they are typed', () => {
    expect(resolveDraft('x', { type: 'today' }, 'end', TODAY).due).toBe(TODAY);
    expect(resolveDraft('x', { type: 'upcoming' }, 'day:2026-10-11', TODAY).due).toBe('2026-10-11');
    expect(resolveDraft('x tomorrow', { type: 'today' }, 'end', TODAY).due).toBe('2026-10-10');
    expect(resolveDraft('x @Home', { type: 'label', name: 'home' }, 'end', TODAY).labels).toEqual(['Home']);
    expect(resolveDraft('x', { type: 'label', name: 'home' }, 'end', TODAY).labels).toEqual(['home']);
    expect(resolveDraft('x', { type: 'project', id: 'p' }, 'end', TODAY).projectId).toBe('p');
  });

  it('adding a draft creates its #project in one undo step', () => {
    const added = addDraft(list, resolveDraft('Plan trip #side_trip p2', { type: 'today' }, 'end', TODAY));
    expect(added.createdProject?.name).toBe('side trip');
    expect(added.task?.projectId).toBe(added.createdProject?.id);
    expect(added.task?.priority).toBe(2);
    list.undo();
    expect([list.data.tasks.length, list.data.projects.length]).toEqual([0, 1]);
    expect(addDraft(list, resolveDraft('#x @y', { type: 'today' }, 'end', TODAY)).task).toBeNull();
  });

  it('trash age and due colours', () => {
    expect(trashAge(0, 0)).toBe('Deleted today · 30 days left');
    expect(trashAge(0, 3 * DAY_MS)).toBe('Deleted 3 days ago · 27 days left');
    expect(trashAge(0, 30 * DAY_MS)).toBe('Deleted 30 days ago · goes today');
    expect(['2026-10-08', TODAY, '2026-10-15', '2026-10-16'].map((d) => dueTone(d, TODAY))).toEqual([
      'overdue',
      'today',
      'soon',
      null,
    ]);
  });
});
