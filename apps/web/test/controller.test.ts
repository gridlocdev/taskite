import { describe, expect, it } from 'vitest';
import { INBOX_ID } from '@taskite/core';
import { makeApp } from './helpers.ts';

describe('AppController', () => {
  it('deleting a project or label from another view stays on that view', async () => {
    const { app } = await makeApp();
    const work = app.list.addProject('Work');
    app.addTask('Call mum @phone', 'end');
    app.go({ type: 'today' });
    const confirmed = () => {
      const d = app.dialog.value;
      if (d?.kind === 'confirm') d.run();
    };
    app.deleteProject(work.id);
    confirmed();
    expect(app.view.value).toEqual({ type: 'today' });
    app.removeLabel('phone');
    confirmed();
    expect(app.view.value).toEqual({ type: 'today' });
    // From its own view, it goes to the Inbox.
    const home = app.list.addProject('Home');
    app.go({ type: 'project', id: home.id });
    app.deleteProject(home.id);
    confirmed();
    expect(app.view.value).toEqual({ type: 'project', id: INBOX_ID });
  });

  it('says what section automations did, with one Undo for all of it (PRD §6.1)', async () => {
    const { app } = await makeApp();
    const doing = app.list.addSection(INBOX_ID, 'Doing')?.id ?? '';
    const done = app.list.addSection(INBOX_ID, 'Done')?.id ?? '';
    app.list.setSectionAutomations(INBOX_ID, doing, [{ on: 'enter', do: [{ priority: 1 }] }]);
    app.list.setSectionAutomations(INBOX_ID, done, [
      { on: 'enter', do: [{ complete: true }, { addLabel: 'shipped' }] },
    ]);
    app.go({ type: 'project', id: INBOX_ID });
    app.addTask('Write', `section:${doing}`);
    expect(app.notice.value?.text).toBe('Added "Write". Automation: set it to priority 1.');
    const [write] = app.ids.value;
    app.dropInto([write!], done, null);
    expect(app.notice.value?.text).toBe('Moved to Done. Automation: completed it, added @shipped.');
    app.notice.value?.action?.run();
    expect(app.list.getTask(write!)).toMatchObject({ sectionId: doing, completed: false, labels: [] });
    // A move no rule answers to keeps quiet, as before.
    app.dismissNotice();
    app.dropInto([write!], undefined, null);
    expect(app.notice.value).toBeNull();
  });

  it('opens on Today when the file has no saved view', async () => {
    const { app } = await makeApp();
    expect(app.view.value).toEqual({ type: 'today' });
  });

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

  it('saves editor changes as one undo step each, and nothing when nothing changed', async () => {
    const { app } = await makeApp();
    app.addTask('Plan trip', 'end');
    const id = app.ids.value[0]!;
    const changes: unknown[] = [];
    app.list.onChange((k) => changes.push(k));
    // Added in Today, so it is due today.
    app.saveTask(id, { title: 'Plan trip', description: '', labels: [], due: '2026-03-10' });
    expect(changes).toEqual([]);
    app.saveTask(id, { title: 'Plan the trip', labels: ['travel'] });
    app.saveTask(id, { priority: 2 });
    expect(app.list.getTask(id)).toMatchObject({ title: 'Plan the trip', labels: ['travel'], priority: 2 });
    app.list.undo();
    expect(app.list.getTask(id)?.priority).toBe(4);
    app.list.undo();
    expect(app.list.getTask(id)?.title).toBe('Plan trip');
    // Clearing the date of a repeating task stops it repeating.
    app.saveTask(id, { recurrence: 'daily' });
    app.saveTask(id, { due: null });
    expect(app.list.getTask(id)).toMatchObject({ due: null, recurrence: null });
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

  it('moves tasks between sections with ⌥← ⌥→ and by dropping, each as one undo step', async () => {
    const { app } = await makeApp();
    app.go({ type: 'project', id: INBOX_ID });
    const a = app.list.addTask({ title: 'A' });
    const sub = app.list.addTask({ title: 'A1', parentId: a.id });
    const b = app.list.addTask({ title: 'B' });
    app.saveSection(INBOX_ID, null, 'Doing');
    app.saveSection(INBOX_ID, null, 'Done');
    const [doing, done] = app.list.getProject(INBOX_ID)?.sections ?? [];
    app.click(sub.id); // a subtask moves with its parent
    app.moveChosenSection(1);
    expect(app.list.getTask(a.id)?.sectionId).toBe(doing?.id);
    expect(app.list.getTask(sub.id)?.sectionId).toBe(doing?.id);
    app.moveChosenSection(1);
    app.moveChosenSection(1); // already in the last section
    expect(app.list.getTask(a.id)?.sectionId).toBe(done?.id);
    app.dropInto([b.id, sub.id], doing?.id, null);
    expect(app.list.getTask(b.id)?.sectionId).toBe(doing?.id);
    expect(app.list.getTask(sub.id)?.sectionId).toBe(done?.id);
    app.undo();
    expect(app.list.getTask(b.id)?.sectionId).toBeUndefined();
    app.setBoard(true);
    expect(app.content.value.board).toBe(true);
  });

  it('saves the open editor before another dialog replaces it (PRD §9.1)', async () => {
    const { app } = await makeApp();
    const t = app.list.addTask({ title: 'A' });
    app.open({ kind: 'task', id: t.id });
    let typed = 'A, edited';
    app.setDraft({
      flush: () => app.saveTask(t.id, { title: typed }),
      dirty: () => typed !== app.list.getTask(t.id)?.title,
    });
    expect(app.hasDraft()).toBe(true);
    app.toggle('commands');
    expect(app.list.getTask(t.id)?.title).toBe('A, edited');
    typed = 'A, again';
    app.close();
    expect(app.list.getTask(t.id)?.title).toBe('A, again');
  });

  it('never saves an editor into a task that went to the Trash', async () => {
    const { app } = await makeApp();
    const t = app.list.addTask({ title: 'A' });
    app.list.deleteTasks(t.id);
    app.saveTask(t.id, { title: 'B' });
    expect(app.list.getTask(t.id)?.title).toBe('A');
  });

  it("drops a notice's Undo once another change is made, so it can't undo that one", async () => {
    const { app } = await makeApp();
    for (const t of ['A', 'B']) app.addTask(t, 'end');
    app.click(app.ids.value[0]!);
    await app.toggleComplete();
    const stale = app.notice.value?.action;
    expect(stale?.label).toBe('Undo');
    app.list.addTask({ title: 'C' });
    expect(app.notice.value?.action).toBeNull();
    stale?.run();
    expect(app.list.liveTasks().map((t) => t.title)).toContain('C');
  });

  it('Undo while a task is still animating out cancels that change, not the one before it', async () => {
    let finish = () => {};
    const { app, catalog } = await makeApp(null, () => new Promise<void>((r) => (finish = r)));
    for (const t of ['A', 'B']) app.addTask(t, 'end');
    // With nothing else to undo (as just after opening), ⌘Z still reaches the completion that is animating.
    app.list.replace(structuredClone(app.list.data));
    const [a, b] = app.ids.value;
    app.click(a!);
    const completing = app.toggleComplete();
    expect(catalog.get('edit.undo')?.enabled?.()).toBe(true);
    catalog.run('edit.undo');
    finish();
    await completing;
    expect(app.list.getTask(a!)?.completed).toBe(false);
    expect(app.list.getTask(b!)).toBeDefined();
    app.click(b!);
    const trashing = app.trash();
    app.undo();
    finish();
    await trashing;
    expect(app.list.getTask(b!)?.deletedAt).toBeNull();
    expect(app.list.liveTasks().map((t) => t.title)).toEqual(['A', 'B']);
  });

  it('reads Quick Add words in the subtask field', async () => {
    const { app } = await makeApp();
    const parent = app.list.addTask({ title: 'Trip' });
    app.addSubtask(parent.id, 'Call mom tomorrow p1 @phone');
    const [sub] = app.list.getSubtasks(parent.id);
    expect(sub).toMatchObject({ title: 'Call mom', due: '2026-03-11', priority: 1, labels: ['phone'] });
  });

  it('starts a new ⇧ range after the view changes', async () => {
    const { app } = await makeApp();
    app.addTask('A', 'end');
    app.click(app.ids.value[0]!);
    const work = app.list.addProject('Work');
    for (const t of ['X', 'Y', 'Z']) app.list.addTask({ title: t, projectId: work.id });
    app.go({ type: 'project', id: work.id });
    app.step(1, true);
    app.step(1, true);
    expect(app.selected.value.size).toBe(2);
  });

  it('moves the cursor to the next row when its row goes away', async () => {
    const { app } = await makeApp();
    for (const t of ['A', 'B', 'C']) app.addTask(t, 'end');
    const [, b, c] = app.ids.value;
    app.click(b!);
    app.list.deleteTasks([b!]);
    expect(app.cursor.value).toBe(c);
    expect([...app.selected.value]).toEqual([c]);
  });

  it('checking off a row outside the choice keeps the choice', async () => {
    const { app } = await makeApp();
    for (const t of ['A', 'B', 'C', 'D']) app.addTask(t, 'end');
    const [a, b, c, d] = app.ids.value;
    app.click(a!);
    app.click(c!, { range: true });
    await app.toggleComplete([d!]);
    expect([...app.selected.value]).toEqual([a, b, c]);
    expect(app.cursor.value).toBe(c);
  });
});
