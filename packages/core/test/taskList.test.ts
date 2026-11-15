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
});
