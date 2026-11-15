import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../src/renderer/store.js';

/** @type {unknown[]} */
let saved;

beforeEach(async () => {
  saved = [];
  await store.init({ load: async () => null, save: async (d) => { saved.push(structuredClone(d)); } });
});

test('starts with an Inbox and saves on every change', () => {
  assert.equal(store.getData().projects[0].id, store.INBOX_ID);
  store.addTask({ title: 'One' });
  assert.equal(saved.length, 1);
});

test('completing a repeating task moves its date instead', () => {
  const t = store.addTask({ title: 'Daily', due: '2026-10-09', recurrence: 'daily' });
  const result = store.completeTask(t.id, '2026-10-09');
  assert.deepEqual(result, { repeated: true, nextDue: '2026-10-10' });
  assert.equal(store.getTask(t.id).completed, false);
});

test('completing a parent completes its subtasks; undo restores', () => {
  const parent = store.addTask({ title: 'Parent' });
  const child = store.addTask({ title: 'Child', parentId: parent.id });
  store.completeTask(parent.id);
  assert.equal(store.getTask(child.id).completed, true);
  store.undo();
  assert.equal(store.getTask(parent.id).completed, false);
  assert.equal(store.getTask(child.id).completed, false);
});

test('subtasks follow their parent to a new project', () => {
  const p = store.addProject('Work');
  const parent = store.addTask({ title: 'Parent' });
  const child = store.addTask({ title: 'Child', parentId: parent.id });
  store.updateTask(parent.id, { projectId: p.id });
  assert.equal(store.getTask(child.id).projectId, p.id);
});

test('deleting a project moves its tasks to the Trash; Inbox cannot be deleted', () => {
  const p = store.addProject('Temp');
  const t = store.addTask({ title: 'Gone', projectId: p.id });
  store.deleteProject(p.id);
  store.deleteProject(store.INBOX_ID);
  assert.equal(store.liveTasks().length, 0);
  assert.equal(store.trashedTasks()[0].id, t.id);
  assert.ok(store.getProject(store.INBOX_ID));
  // Restoring a task whose project is gone puts it in the Inbox.
  store.restoreTasks(t.id);
  assert.equal(store.getTask(t.id).projectId, store.INBOX_ID);
});

test('findProjectByName ignores case and spaces', () => {
  const p = store.addProject('Side Project');
  assert.equal(store.findProjectByName('sideproject'), p);
  assert.equal(store.findProjectByName('side-project'), p);
});

test('normalize repairs incomplete saved data', () => {
  const data = store.normalize({ tasks: [{ id: 'a', title: 'x', projectId: 'missing', priority: 9 }] });
  assert.equal(data.tasks[0].projectId, store.INBOX_ID);
  assert.equal(data.tasks[0].priority, 4);
  assert.deepEqual(data.tasks[0].labels, []);
  assert.equal(data.settings.theme, 'auto');
});

test('deleting moves a task and its subtasks to the Trash; restore brings both back', () => {
  const parent = store.addTask({ title: 'Parent' });
  const child = store.addTask({ title: 'Child', parentId: parent.id });
  store.deleteTasks(parent.id, 1000);
  assert.equal(store.liveTasks().length, 0);
  assert.equal(store.getTask(child.id).deletedAt, 1000);
  store.restoreTasks(parent.id);
  assert.equal(store.liveTasks().length, 2);
});

test('restoring a subtask also restores its trashed parent', () => {
  const parent = store.addTask({ title: 'Parent' });
  const child = store.addTask({ title: 'Child', parentId: parent.id });
  store.deleteTasks(parent.id);
  store.restoreTasks(child.id);
  assert.equal(store.getTask(parent.id).deletedAt, null);
});

test('purge only deletes tasks in the Trash, and can be undone', () => {
  const kept = store.addTask({ title: 'Kept' });
  const gone = store.addTask({ title: 'Gone' });
  store.deleteTasks(gone.id);
  store.purgeTasks([kept.id, gone.id]);
  assert.ok(store.getTask(kept.id));
  assert.equal(store.getTask(gone.id), undefined);
  store.undo();
  assert.ok(store.getTask(gone.id));
});

test('emptyTrash removes every trashed task', () => {
  store.addTask({ title: 'Live' });
  const a = store.addTask({ title: 'A' });
  const b = store.addTask({ title: 'B' });
  store.deleteTasks([a.id, b.id]);
  store.emptyTrash();
  assert.equal(store.getData().tasks.length, 1);
});

test('clearCompleted moves done tasks to the Trash', () => {
  const t = store.addTask({ title: 'Done' });
  store.completeTask(t.id);
  store.clearCompleted();
  assert.notEqual(store.getTask(t.id).deletedAt, null);
});

test('trashed tasks older than the limit are deleted on start', async () => {
  const day = 24 * 60 * 60 * 1000;
  const now = 100 * day;
  const task = (id, deletedAt) => ({ id, title: id, deletedAt, projectId: store.INBOX_ID });
  await store.init({
    load: async () => ({ tasks: [task('old', now - 31 * day), task('recent', now - 29 * day), task('live', null)] }),
    save: async () => {},
  }, { now });
  assert.deepEqual(store.getData().tasks.map((t) => t.id).sort(), ['live', 'recent']);
});

test('trashed tasks are left out of labels and subtasks', () => {
  const parent = store.addTask({ title: 'Parent' });
  const child = store.addTask({ title: 'Child', parentId: parent.id, labels: ['x'] });
  store.deleteTasks(child.id);
  assert.deepEqual(store.getSubtasks(parent.id), []);
  assert.deepEqual(store.getLabels(), []);
});

test('redo repeats an undone change; a new change clears redo', () => {
  const t = store.addTask({ title: 'Task' });
  store.updateTask(t.id, { title: 'Renamed' });
  store.undo();
  assert.equal(store.getTask(t.id).title, 'Task');
  assert.ok(store.canRedo());
  store.redo();
  assert.equal(store.getTask(t.id).title, 'Renamed');
  store.undo();
  store.updateTask(t.id, { priority: 1 });
  assert.equal(store.canRedo(), false);
});

test('batch changes are one undo step', () => {
  const a = store.addTask({ title: 'A' });
  const b = store.addTask({ title: 'B' });
  store.updateTask([a.id, b.id], { priority: 1 });
  store.completeTasks([a.id, b.id]);
  assert.equal(store.liveTasks().filter((t) => t.completed).length, 2);
  store.undo();
  assert.equal(store.liveTasks().filter((t) => t.completed).length, 0);
  assert.equal(store.getTask(a.id).priority, 1);
  store.undo();
  assert.equal(store.getTask(b.id).priority, 4);
});

test('the last view is kept, and a bad one is dropped', () => {
  assert.deepEqual(store.normalize({ settings: { lastView: { type: 'label', name: 'x' } } }).settings.lastView, { type: 'label', name: 'x' });
  assert.equal(store.normalize({ settings: { lastView: { type: 'nope' } } }).settings.lastView, null);
  assert.equal(store.normalize({ settings: { lastView: { type: 'project' } } }).settings.lastView, null);
  store.rememberView({ type: 'trash' });
  assert.deepEqual(store.getData().settings.lastView, { type: 'trash' });
  assert.equal(saved.length, 1);
});

test('saving retries, reports a failure once, then reports when it works again', async () => {
  let failures = 4;
  const statuses = [];
  await store.init({
    load: async () => null,
    save: async () => {
      if (failures-- > 0) throw new Error('disk full');
    },
  }, { retryDelayMs: 0 });
  const stop = store.onSaveStatus((s) => statuses.push(s.ok));
  assert.equal(await store.save(), false);
  assert.deepEqual(statuses, [false]);
  assert.equal(await store.save(), true);
  assert.deepEqual(statuses, [false, true]);
  assert.equal(await store.save(), true);
  assert.deepEqual(statuses, [false, true]);
  stop();
});
