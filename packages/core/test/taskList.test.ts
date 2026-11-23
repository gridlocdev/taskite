import { beforeEach, describe, expect, it } from 'vitest';
import { DAY_MS, INBOX_ID, TaskList, emptyData, normalize, type ChangeKind } from '../src/index.ts';

let list: TaskList;
let changes: ChangeKind[];

function make(raw: unknown = null, now = 1_000_000): TaskList {
  let n = 0;
  const l = new TaskList(normalize(raw, now), { now: () => now, newId: () => `id${++n}` });
  changes = [];
  l.onChange((kind) => changes.push(kind));
  return l;
}

function task(id: string) {
  const t = list.getTask(id);
  if (!t) throw new Error(`no task ${id}`);
  return t;
}

beforeEach(() => {
  list = make();
});

describe('TaskList', () => {
  it('starts with an Inbox and reports every change', () => {
    expect(list.data.projects[0]?.id).toBe(INBOX_ID);
    list.addTask({ title: 'One' });
    expect(changes).toEqual(['edit']);
  });

  it('adds tasks at the end of their project', () => {
    const a = list.addTask({ title: ' A ' });
    const b = list.addTask({ title: 'B' });
    expect(a.title).toBe('A');
    expect([a.order, b.order]).toEqual([0, 1]);
  });

  it('completing a repeating task moves its date instead', () => {
    const t = list.addTask({ title: 'Daily', due: '2026-10-09', recurrence: 'daily' });
    expect(list.completeTasks(t.id, '2026-10-09')).toEqual([
      { id: t.id, repeated: true, nextDue: '2026-10-10' },
    ]);
    expect(task(t.id).completed).toBe(false);
  });

  it('a monthly repeat on the 31st comes back to the 31st after February, check-off by check-off', () => {
    const t = list.addTask({ title: 'Rent', due: '2026-01-31', recurrence: 'monthly' });
    const dues = ['2026-01-31', '2026-02-28', '2026-03-31'].map((today) => {
      list.completeTasks(t.id, today);
      return task(t.id).due;
    });
    expect(dues).toEqual(['2026-02-28', '2026-03-31', '2026-04-30']);
    list.completeTasks(t.id, '2026-04-30');
    expect(task(t.id).due).toBe('2026-05-31');
    expect(task(t.id).repeatDay).toBeUndefined();
  });

  it('setting the date or the repeat by hand forgets the old day of the month', () => {
    const t = list.addTask({ title: 'Rent', due: '2026-01-31', recurrence: 'monthly' });
    list.completeTasks(t.id, '2026-01-31');
    expect(task(t.id).repeatDay).toBe(31);
    list.updateTasks(t.id, { due: '2026-02-15' });
    list.completeTasks(t.id, '2026-02-15');
    expect(task(t.id).due).toBe('2026-03-15');
    list.updateTasks(t.id, { due: '2026-04-30' });
    list.completeTasks(t.id, '2026-01-31');
    expect(task(t.id).repeatDay).toBeUndefined();
  });

  it('keeps a valid repeat day from the file and drops a bad one', () => {
    const raw = (repeatDay: unknown) => ({
      tasks: [{ id: 'a', title: 'A', due: '2026-02-28', recurrence: 'monthly', repeatDay }],
    });
    expect(make(raw(31)).getTask('a')?.repeatDay).toBe(31);
    expect(make(raw(40)).getTask('a')?.repeatDay).toBeUndefined();
    expect(make(raw('31')).getTask('a')?.repeatDay).toBeUndefined();
  });

  it('completing a parent completes its subtasks; undo restores', () => {
    const parent = list.addTask({ title: 'Parent' });
    const child = list.addTask({ title: 'Child', parentId: parent.id });
    list.completeTasks(parent.id);
    expect(task(child.id).completed).toBe(true);
    list.undo();
    expect(task(parent.id).completed).toBe(false);
    expect(task(child.id).completed).toBe(false);
  });

  it('reopening a subtask reopens its parent', () => {
    const parent = list.addTask({ title: 'Parent' });
    const child = list.addTask({ title: 'Child', parentId: parent.id });
    list.completeTasks(parent.id);
    list.reopenTasks(child.id);
    expect(task(parent.id).completed).toBe(false);
  });

  it('subtasks follow their parent to a new project', () => {
    const p = list.addProject('Work');
    const parent = list.addTask({ title: 'Parent' });
    const child = list.addTask({ title: 'Child', parentId: parent.id });
    expect(child.projectId).toBe(INBOX_ID);
    list.updateTasks(parent.id, { projectId: p.id });
    expect(task(child.id).projectId).toBe(p.id);
  });

  it('a subtask moved to another project or section on its own leaves its parent', () => {
    // Found by the random test (FUZZ_SEED=1 and 55): it kept a parent in another project or section.
    const p = list.addProject('Other');
    const s = list.addSection(INBOX_ID, 'S');
    const parent = list.addTask({ title: 'Parent' });
    const moved = list.addTask({ title: 'Moved', parentId: parent.id });
    const sectioned = list.addTask({ title: 'Sectioned', parentId: parent.id });
    const together = list.addTask({ title: 'Together', parentId: parent.id });
    list.updateTasks(moved.id, { projectId: p.id });
    list.updateTasks(sectioned.id, { sectionId: s?.id });
    expect(task(moved.id)).toMatchObject({ projectId: p.id, parentId: null });
    expect(task(sectioned.id)).toMatchObject({ sectionId: s?.id, parentId: null });
    // Moved with its parent, it stays a subtask.
    list.updateTasks([together.id, parent.id], { projectId: p.id });
    expect(task(together.id)).toMatchObject({ projectId: p.id, parentId: parent.id });
  });

  it('deleting a project moves its tasks to the Trash; the Inbox cannot be deleted', () => {
    const p = list.addProject('Temp');
    const t = list.addTask({ title: 'Gone', projectId: p.id });
    list.deleteProject(p.id);
    list.deleteProject(INBOX_ID);
    expect(list.liveTasks()).toEqual([]);
    expect(list.trashedTasks()[0]?.id).toBe(t.id);
    expect(list.getProject(INBOX_ID)).toBeDefined();
    list.restoreTasks(t.id);
    expect(task(t.id).projectId).toBe(INBOX_ID);
  });

  it("a deleted project's tasks belong to the Inbox at once, as the saved file would load them", () => {
    // Found by the random test (FUZZ_SEED=1): trashed tasks kept the gone project until the next reload.
    const p = list.addProject('Temp');
    const s = list.addSection(p.id, 'S');
    const earlier = list.addTask({ title: 'Trashed before', projectId: p.id, sectionId: s?.id });
    list.deleteTasks(earlier.id);
    const t = list.addTask({ title: 'Gone', projectId: p.id, sectionId: s?.id });
    list.deleteProject(p.id);
    for (const id of [earlier.id, t.id]) {
      expect(task(id).projectId).toBe(INBOX_ID);
      expect(task(id).sectionId).toBeUndefined();
    }
    expect(normalize(JSON.parse(JSON.stringify(list.data)))).toEqual(list.data);
    list.undo();
    expect(task(t.id).projectId).toBe(p.id);
  });

  it('findProjectByName ignores case, spaces, dashes and underscores', () => {
    const p = list.addProject('Side Project');
    expect(list.findProjectByName('sideproject')).toBe(p);
    expect(list.findProjectByName('side-project')).toBe(p);
    expect(list.findProjectByName('Side_Project')).toBe(p);
  });

  it('deleting moves a task and its subtasks to the Trash; restore brings both back', () => {
    const parent = list.addTask({ title: 'Parent' });
    const child = list.addTask({ title: 'Child', parentId: parent.id });
    list.deleteTasks(parent.id, 1000);
    expect(list.liveTasks()).toEqual([]);
    expect(task(child.id).deletedAt).toBe(1000);
    expect(list.trashList().map((t) => t.id)).toEqual([parent.id]);
    list.restoreTasks(parent.id);
    expect(list.liveTasks()).toHaveLength(2);
  });

  it('restoring a subtask also restores its trashed parent', () => {
    const parent = list.addTask({ title: 'Parent' });
    const child = list.addTask({ title: 'Child', parentId: parent.id });
    list.deleteTasks(parent.id);
    list.restoreTasks(child.id);
    expect(task(parent.id).deletedAt).toBeNull();
  });

  it('purge only deletes tasks in the Trash, and can be undone', () => {
    const kept = list.addTask({ title: 'Kept' });
    const gone = list.addTask({ title: 'Gone' });
    list.deleteTasks(gone.id);
    list.purgeTasks([kept.id, gone.id]);
    expect(list.getTask(kept.id)).toBeDefined();
    expect(list.getTask(gone.id)).toBeUndefined();
    list.undo();
    expect(list.getTask(gone.id)).toBeDefined();
  });

  it('emptyTrash removes every trashed task', () => {
    list.addTask({ title: 'Live' });
    const a = list.addTask({ title: 'A' });
    const b = list.addTask({ title: 'B' });
    list.deleteTasks([a.id, b.id]);
    list.emptyTrash();
    expect(list.data.tasks).toHaveLength(1);
  });

  it('clearCompleted moves done tasks to the Trash', () => {
    const t = list.addTask({ title: 'Done' });
    list.completeTasks(t.id);
    list.clearCompleted();
    expect(task(t.id).deletedAt).not.toBeNull();
  });

  it('removes tasks trashed too long ago, without an undo step', () => {
    const now = 100 * DAY_MS;
    const t = (id: string, deletedAt: number | null, parentId: string | null = null) => ({
      id,
      title: id,
      deletedAt,
      parentId,
      projectId: INBOX_ID,
    });
    list = make(
      {
        tasks: [
          t('old', now - 31 * DAY_MS),
          t('oldChild', now - 31 * DAY_MS, 'old'),
          t('liveChild', null, 'old'),
          t('recent', now - 29 * DAY_MS),
          t('live', null),
        ],
      },
      now,
    );
    expect(list.purgeExpired(now)).toBe(true);
    // A live subtask of an expired parent (only in hand-edited data) stays, as a task of its own.
    expect(list.data.tasks.map((x) => x.id).sort()).toEqual(['live', 'liveChild', 'recent']);
    expect(list.getTask('liveChild')?.parentId).toBeNull();
    expect(list.canUndo).toBe(false);
    expect(changes).toEqual(['settings']);
    expect(list.purgeExpired(now)).toBe(false);
  });

  it('Undo never brings back a task the Trash has deleted for good', () => {
    // Found by the random test (FUZZ_SEED=195 and 41): history steps still held the expired tasks.
    const later = 1_000_000 + 31 * DAY_MS;
    const old = list.addTask({ title: 'Old' });
    const purged = list.addTask({ title: 'Purged by hand' });
    list.deleteTasks([old.id, purged.id]);
    list.purgeTasks(purged.id);
    expect(list.purgeExpired(later)).toBe(true);
    list.undo();
    expect(list.getTask(old.id)).toBeUndefined();
    expect(list.getTask(purged.id)).toBeUndefined();
  });

  it('trashed tasks are left out of labels and subtasks', () => {
    const parent = list.addTask({ title: 'Parent' });
    const child = list.addTask({ title: 'Child', parentId: parent.id, labels: ['x'] });
    list.deleteTasks(child.id);
    expect(list.getSubtasks(parent.id)).toEqual([]);
    expect(list.getLabels()).toEqual([]);
  });

  it('labels are listed alphabetically without case duplicates, and can be removed everywhere', () => {
    list.addTask({ title: 'A', labels: ['home', 'Errands'] });
    list.addTask({ title: 'B', labels: ['Home'] });
    expect(list.getLabels()).toEqual(['Errands', 'home']);
    list.deleteLabel('HOME');
    expect(list.getLabels()).toEqual(['Errands']);
  });

  it('gives labels colours and renames them everywhere, as one undo step each', () => {
    const a = list.addTask({ title: 'A', labels: ['home', 'call'] });
    const b = list.addTask({ title: 'B', labels: ['Home'] });
    expect(list.labelColor('home')).toBeNull();
    list.editLabel('home', 'home', 'green');
    expect(list.labelColor('HOME')).toBe('green');
    expect(list.data.labelColors).toEqual({ home: 'green' });
    list.editLabel('Home', '@house chores', 'green');
    expect(task(a.id).labels).toEqual(['call', 'house-chores']);
    expect(task(b.id).labels).toEqual(['house-chores']);
    expect(list.labelColor('house-chores')).toBe('green');
    expect(list.labelColor('home')).toBeNull();
    // Renaming onto a label the task already has leaves one copy.
    list.editLabel('call', 'House-Chores', null);
    expect(task(a.id).labels).toEqual(['House-Chores']);
    list.undo();
    expect(task(a.id).labels).toEqual(['call', 'house-chores']);
    expect(list.editLabel('call', '  ', null)).toBe(false);
    list.deleteLabel('house-chores');
    expect(list.data.labelColors).toBeUndefined();
  });

  it('redo repeats an undone change; a new change clears redo', () => {
    const t = list.addTask({ title: 'Task' });
    list.updateTasks(t.id, { title: 'Renamed' });
    list.undo();
    expect(task(t.id).title).toBe('Task');
    expect(list.canRedo).toBe(true);
    list.redo();
    expect(task(t.id).title).toBe('Renamed');
    list.undo();
    list.updateTasks(t.id, { priority: 1 });
    expect(list.canRedo).toBe(false);
  });

  it('multi-task changes are one undo step', () => {
    const a = list.addTask({ title: 'A' });
    const b = list.addTask({ title: 'B' });
    list.updateTasks([a.id, b.id], { priority: 1 });
    list.completeTasks([a.id, b.id]);
    expect(list.liveTasks().filter((t) => t.completed)).toHaveLength(2);
    list.undo();
    expect(list.liveTasks().filter((t) => t.completed)).toHaveLength(0);
    expect(task(a.id).priority).toBe(1);
    list.undo();
    expect(task(b.id).priority).toBe(4);
  });

  it('batch makes several edits one undo step', () => {
    list.batch(() => {
      list.addProject('P');
      list.addTask({ title: 'T' });
    });
    expect(changes).toEqual(['edit']);
    list.undo();
    expect(list.data.tasks).toEqual([]);
    expect(list.data.projects).toHaveLength(1);
  });

  it('undo never changes settings', () => {
    list.addTask({ title: 'T' });
    list.updateSettings({ theme: 'dark' });
    list.undo();
    expect(list.data.settings.theme).toBe('dark');
  });

  it('keeps 100 undo steps', () => {
    for (let i = 0; i < 105; i++) list.addTask({ title: `T${i}` });
    let steps = 0;
    while (list.canUndo) {
      list.undo();
      steps++;
    }
    expect(steps).toBe(100);
    expect(list.data.tasks).toHaveLength(5);
  });

  it('remembering the view saves but is not an undo step, and repeats are ignored', () => {
    list.rememberView({ type: 'trash' });
    list.rememberView({ type: 'trash' });
    expect(list.data.settings.lastView).toEqual({ type: 'trash' });
    expect(changes).toEqual(['settings']);
    expect(list.canUndo).toBe(false);
  });

  it('replace swaps in new data and clears undo', () => {
    list.addTask({ title: 'T' });
    list.replace(emptyData());
    expect(list.canUndo).toBe(false);
    expect(changes).toEqual(['edit', 'load']);
  });

  it('new Quick Add projects take the next colour in turn, never gray', () => {
    expect(list.nextProjectColor()).toBe('orange');
    list.addProject('A');
    expect(list.nextProjectColor()).toBe('yellow');
  });

  it('marks steps that change only what an editor shows, and hands them back on undo and redo', () => {
    const t = list.addTask({ title: 'A' });
    changes = [];
    list.mark('labels added');
    expect(changes).toEqual(['view']);
    list.updateTasks(t.id, { labels: ['home'] });
    expect(list.markLast('labels set')).toBe(true);

    expect(list.undo()).toBe('labels set');
    expect(task(t.id).labels).toEqual([]);
    expect(list.undo()).toBe('labels added');
    expect(list.undo()).toBeUndefined();
    expect(list.canUndo).toBe(false);
    expect(list.redo()).toBeUndefined();
    expect(list.redo()).toBe('labels added');
    expect(list.redo()).toBe('labels set');
    expect(task(t.id).labels).toEqual(['home']);
    // A step of its own changed nothing to save; the add, undo and redo of real changes did.
    expect(changes).toEqual(['view', 'edit', 'edit', 'view', 'edit', 'edit', 'view', 'edit']);

    // Once the editor closes, its marks go: steps that only held one, and the marks on the others.
    list.undo();
    list.dropMarks();
    expect(list.redo()).toBeUndefined();
    expect(task(t.id).labels).toEqual(['home']);
    expect(list.undo()).toBeUndefined();
    expect(list.undo()).toBeUndefined();
    expect(list.canUndo).toBe(false);
  });

  it('markLast refuses when the last step changed nothing or only held a mark', () => {
    const t = list.addTask({ title: 'A' });
    list.updateTasks(t.id, { title: 'A' });
    expect(list.markLast('x')).toBe(false);
    list.mark('y');
    list.updateTasks(t.id, { title: 'B' });
    list.undo();
    expect(list.markLast('z')).toBe(false);
  });

  it('records no undo step for an edit that changes nothing', () => {
    const list = new TaskList(emptyData());
    const t = list.addTask({ title: 'A', priority: 2 });
    list.updateTasks(t.id, { priority: 1 });
    list.updateTasks(t.id, { priority: 1 });
    expect(list.lastEditChanged).toBe(false);
    list.updateTasks(t.id, { projectId: INBOX_ID });
    list.reorderTasks([t.id]);
    list.batch(() => list.updateTasks(t.id, { priority: 1 }));
    list.undo();
    expect(list.getTask(t.id)?.priority).toBe(2);
  });

  it('finds tasks and subtasks after every kind of change', () => {
    const list = new TaskList(emptyData());
    const a = list.addTask({ title: 'A' });
    const b = list.addTask({ title: 'B' });
    expect(list.getTask(b.id)?.title).toBe('B');
    const s1 = list.addTask({ title: 'S1', parentId: a.id });
    const s2 = list.addTask({ title: 'S2', parentId: a.id });
    expect(list.getSubtasks(a.id).map((t) => t.title)).toEqual(['S1', 'S2']);
    list.reorderTasks([s2.id, s1.id]);
    expect(list.getSubtasks(a.id).map((t) => t.title)).toEqual(['S2', 'S1']);
    list.deleteTasks(s2.id);
    expect(list.getSubtasks(a.id).map((t) => t.title)).toEqual(['S1']);
    list.undo();
    expect(list.getSubtasks(a.id)).toHaveLength(2);
    list.batch(() => {
      list.addTask({ title: 'S3', parentId: b.id });
      expect(list.getSubtasks(b.id).map((t) => t.title)).toEqual(['S3']);
    });
    list.deleteTasks(b.id);
    list.purgeTasks(b.id);
    expect(list.getTask(b.id)).toBeUndefined();
    expect(list.getSubtasks(b.id)).toEqual([]);
  });
});
