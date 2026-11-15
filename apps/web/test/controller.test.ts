import { describe, expect, it } from 'vitest';
import { INBOX_ID } from '@taskite/core';
import { makeApp } from './helpers.ts';

describe('AppController', () => {
  it('adds from the add-task row with Quick Add and the view defaults', async () => {
    const { app } = await makeApp();
    app.go({ type: 'today' });
    expect(app.addTask('Call mum p1 @phone', 'end')).toBe(true);
    const [task] = app.list.activeTasks();
    expect(task).toMatchObject({ title: 'Call mum', priority: 1, labels: ['phone'], due: '2026-03-10' });
    expect(app.addTask('   ', 'end')).toBe(false);
  });

  it('creates a #Project and says so with Undo', async () => {
    const { app } = await makeApp();
    app.addTask('Plan trip #Holiday-2026', 'end');
    expect(app.list.findProjectByName('Holiday 2026')).toBeDefined();
    expect(app.notice.value?.text).toBe('Created new project "Holiday 2026".');
    app.notice.value?.action?.run();
    expect(app.list.activeTasks()).toHaveLength(0);
    expect(app.list.findProjectByName('Holiday 2026')).toBeUndefined();
  });

  it('opens New Task in the Inbox from views that take no new tasks', async () => {
    const { app } = await makeApp();
    app.go({ type: 'trash' });
    app.newTask();
    expect(app.shown.value).toEqual({ type: 'project', id: INBOX_ID });
    expect(app.composer.value).toBe('end');
    app.go({ type: 'upcoming' });
    app.newTask();
    expect(app.composer.value).toBe('day:2026-03-10');
  });

  it('completes the chosen tasks, moves the cursor on, and offers Undo', async () => {
    const { app } = await makeApp();
    for (const t of ['A', 'B', 'C']) app.addTask(t, 'end');
    const [a, b, c] = app.ids.value;
    app.click(a!);
    app.click(b!, { range: true });
    await app.toggleComplete();
    expect(app.notice.value?.text).toBe('2 tasks completed.');
    expect(app.ids.value).toEqual([c]);
    expect(app.cursor.value).toBe(c);
    app.notice.value?.action?.run();
    expect(app.ids.value).toEqual([a, b, c]);
  });

  it('moves a repeating task to its next date', async () => {
    const { app } = await makeApp();
    app.addTask('Water plants every day', 'end');
    app.step(1);
    await app.toggleComplete();
    expect(app.notice.value?.text).toBe('Nice! "Water plants" is next due tomorrow.');
    expect(app.list.activeTasks()[0]?.due).toBe('2026-03-11');
  });

  it('un-checks tasks in Completed', async () => {
    const { app } = await makeApp();
    app.addTask('A', 'end');
    app.step(1);
    await app.toggleComplete();
    app.go({ type: 'completed' });
    app.step(1);
    await app.toggleComplete();
    expect(app.list.activeTasks()).toHaveLength(1);
    expect(app.notice.value?.text).toBe('Task reopened.');
  });

  it('trashes, restores and empties the Trash after asking', async () => {
    const { app } = await makeApp();
    app.addTask('A', 'end');
    app.step(1);
    await app.trash();
    expect(app.notice.value?.text).toBe('Moved "A" to the Trash.');
    app.go({ type: 'trash' });
    app.step(1);
    app.restore();
    expect(app.list.trashList()).toHaveLength(0);
    app.go({ type: 'project', id: INBOX_ID });
    app.step(1);
    await app.trash();
    app.emptyTrash();
    const d = app.dialog.value;
    expect(d?.kind).toBe('confirm');
    expect(app.list.trashList()).toHaveLength(1);
    if (d?.kind === 'confirm') d.run();
    expect(app.list.trashList()).toHaveLength(0);
  });

  it('chooses with arrows, Shift+arrows and ⌘-click', async () => {
    const { app } = await makeApp();
    for (const t of ['A', 'B', 'C', 'D']) app.addTask(t, 'end');
    const [a, b, c, d] = app.ids.value;
    app.step(1);
    expect(app.selectedIds()).toEqual([a]);
    app.step(1, true);
    app.step(1, true);
    expect(app.selectedIds()).toEqual([a, b, c]);
    app.click(d!, { toggle: true });
    expect(app.selectedIds()).toEqual([a, b, c, d]);
    app.click(b!, { toggle: true });
    expect(app.selectedIds()).toEqual([a, c, d]);
    app.clearSelection();
    expect(app.targetIds()).toEqual([b]);
  });

  it('clears recurrence with the date, and gives a repeating task a date', async () => {
    const { app } = await makeApp();
    app.addTask('Gym every week', 'end');
    const id = app.ids.value[0]!;
    app.setDue([id], null);
    expect(app.list.getTask(id)).toMatchObject({ due: null, recurrence: null });
    app.saveTask(id, { recurrence: 'weekly' });
    expect(app.list.getTask(id)).toMatchObject({ due: '2026-03-10', recurrence: 'weekly' });
  });

  it('moves tasks to a project, and a subtask on its own leaves its parent', async () => {
    const { app } = await makeApp();
    app.addTask('Parent', 'end');
    const parent = app.ids.value[0]!;
    app.addSubtask(parent, 'Child');
    const work = app.list.addProject('Work');
    const child = app.list.getSubtasks(parent)[0]!.id;
    app.moveTo([child], work.id);
    expect(app.list.getTask(child)).toMatchObject({ projectId: work.id, parentId: null });
    expect(app.notice.value?.text).toBe('Moved task to Work.');
  });

  it('remembers the view and falls back when its project is gone', async () => {
    const { app } = await makeApp();
    const p = app.list.addProject('Errands');
    app.go({ type: 'project', id: p.id });
    expect(app.list.data.settings.lastView).toEqual({ type: 'project', id: p.id });
    app.list.deleteProject(p.id);
    expect(app.shown.value).toEqual({ type: 'project', id: INBOX_ID });
  });

  it('keeps a failed save on screen with Try again', async () => {
    const { app, store, session } = await makeApp();
    store.failSaves = 5;
    app.addTask('A', 'end');
    await session.flush();
    app.saveStatusChanged(session.status.value);
    expect(app.notice.value).toMatchObject({
      text: "Couldn't save your tasks.",
      sticky: true,
      tone: 'error',
    });
    store.failSaves = 0;
    app.notice.value?.action?.run();
    await session.flush();
    app.saveStatusChanged(session.status.value);
    expect(app.notice.value?.text).toBe('Saved.');
  });

  it('searches and leaves search with Escape (an empty query)', async () => {
    const { app } = await makeApp();
    app.addTask('Buy milk', 'end');
    app.addTask('Call bank', 'end');
    app.setSearch('milk');
    expect(app.title()).toBe('Search: milk');
    expect(app.ids.value).toHaveLength(1);
    app.setSearch('');
    expect(app.ids.value).toHaveLength(2);
  });
});
