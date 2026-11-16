import { describe, expect, it } from 'vitest';
import { INBOX_ID, TaskList, emptyData } from '../src/index.ts';
import { checkInvariants } from './support/invariants.ts';

const DAY = 86_400_000;

function setup() {
  let n = 0;
  let clock = 1_000;
  const list = new TaskList(emptyData(), { newId: () => `id${++n}`, now: () => clock });
  return { list, tick: (ms = 1) => (clock += ms), now: () => clock };
}

describe('subtasks stay with their parent', () => {
  it('emptying the Trash never deletes a live subtask of a trashed parent', () => {
    const { list, tick } = setup();
    const a = list.addSection(INBOX_ID, 'A');
    const b = list.addSection(INBOX_ID, 'B');
    if (!a || !b) throw new Error('no section');
    const parent = list.addTask({ title: 'T', sectionId: a.id });
    const s1 = list.addTask({ title: 'S1', parentId: parent.id });
    list.addTask({ title: 'S2', parentId: parent.id });
    tick();
    list.deleteTasks(s1.id);
    list.updateTasks(parent.id, { sectionId: b.id });
    list.restoreTasks(s1.id);
    checkInvariants(list.data);
    tick();
    list.deleteSection(INBOX_ID, b.id);
    list.emptyTrash();
    checkInvariants(list.data);
    // S1 followed its parent into section B, so it went to the Trash with it.
    expect(list.data.tasks).toEqual([]);
  });

  it('purging a parent leaves a subtask that was restored on its own', () => {
    const { list, tick } = setup();
    const p = list.addProject('P');
    const parent = list.addTask({ title: 'T', projectId: p.id });
    const sub = list.addTask({ title: 'S', parentId: parent.id });
    tick();
    list.deleteTasks(parent.id);
    tick();
    list.restoreTasks(sub.id);
    expect(list.getTask(parent.id)?.deletedAt).toBeNull();
    list.deleteTasks(parent.id);
    list.restoreTasks(sub.id);
    list.deleteTasks(parent.id);
    list.purgeTasks(parent.id);
    expect(list.getTask(parent.id)).toBeUndefined();
  });

  it('a trashed subtask moves with its parent and comes back beside it', () => {
    const { list, tick } = setup();
    const p = list.addProject('P');
    const q = list.addProject('Q');
    const parent = list.addTask({ title: 'T', projectId: p.id });
    const sub = list.addTask({ title: 'S', parentId: parent.id });
    tick();
    list.deleteTasks(sub.id);
    list.updateTasks(parent.id, { projectId: q.id });
    list.deleteProject(p.id);
    list.restoreTasks(sub.id);
    expect(list.getTask(sub.id)?.projectId).toBe(q.id);
    checkInvariants(list.data);
  });

  it('expiry takes only subtasks that are in the Trash', () => {
    const { list, tick, now } = setup();
    const parent = list.addTask({ title: 'T' });
    const sub = list.addTask({ title: 'S', parentId: parent.id });
    // Hand-edited data: a live subtask under a parent that has been in the Trash for 40 days.
    list.deleteTasks(parent.id);
    list.restoreTasks(sub.id);
    const data = structuredClone(list.data);
    const t = data.tasks.find((x) => x.id === parent.id)!;
    t.deletedAt = now() - 40 * DAY;
    const loaded = new TaskList(data, { now });
    tick();
    loaded.purgeExpired(now());
    expect(loaded.getTask(sub.id)).toBeDefined();
  });
});
