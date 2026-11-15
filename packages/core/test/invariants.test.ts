import { describe, expect, it } from 'vitest';
import { INBOX_ID, TaskList, emptyData, type AppData } from '../src/index.ts';

const DAY = 86_400_000;

/**
 * The rules that relate tasks (PRD §4.4, §6): a live subtask has a live, top-level parent and sits in its
 * parent's project and section; a live task's section exists in its project.
 */
function checkInvariants(data: AppData): void {
  const byId = new Map(data.tasks.map((t) => [t.id, t]));
  for (const t of data.tasks) {
    if (t.deletedAt !== null) continue;
    const project = data.projects.find((p) => p.id === t.projectId);
    expect(project, `${t.title} is in a project that exists`).toBeDefined();
    if (t.sectionId)
      expect(
        project?.sections?.some((s) => s.id === t.sectionId),
        `${t.title}'s section exists`,
      ).toBe(true);
    if (!t.parentId) continue;
    const parent = byId.get(t.parentId);
    expect(parent, `${t.title}'s parent exists`).toBeDefined();
    if (!parent) continue;
    expect(parent.parentId, `${t.title}'s parent is top-level`).toBeNull();
    expect(parent.deletedAt, `${t.title}'s parent is live`).toBeNull();
    expect(t.projectId, `${t.title} is in its parent's project`).toBe(parent.projectId);
    expect(t.sectionId, `${t.title} is in its parent's section`).toBe(parent.sectionId);
  }
}

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

  it('hold through a random run of moves, trashes, restores and deletes', () => {
    let seed = 7;
    const rand = (n: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % n;
    };
    const { list, tick, now } = setup();
    const pick = <T>(xs: readonly T[]): T | undefined => xs[rand(Math.max(xs.length, 1))];
    for (let step = 0; step < 600; step++) {
      tick(DAY);
      const live = list.liveTasks();
      const top = live.filter((t) => !t.parentId);
      const trashed = list.trashedTasks();
      const projects = list.data.projects;
      const project = pick(projects)!;
      const before = new Set(live.map((t) => t.id));
      let purging = false;
      switch (rand(11)) {
        case 0:
          list.addProject(`P${step}`);
          break;
        case 1:
          list.addSection(project.id, `S${step}`);
          break;
        case 2:
        case 3:
          list.addTask({
            title: `T${step}`,
            projectId: project.id,
            sectionId: pick(project.sections ?? [])?.id,
          });
          break;
        case 4: {
          const parent = pick(top);
          if (parent) list.addTask({ title: `C${step}`, parentId: parent.id });
          break;
        }
        case 5: {
          const t = pick(live);
          if (t) list.deleteTasks(t.id);
          break;
        }
        case 6: {
          const t = pick(trashed);
          if (t) list.restoreTasks(t.id);
          break;
        }
        case 7: {
          const t = pick(top);
          const to = pick(projects);
          if (t && to) list.updateTasks(t.id, { projectId: to.id, sectionId: pick(to.sections ?? [])?.id });
          break;
        }
        case 8: {
          const s = pick(project.sections ?? []);
          if (s) list.deleteSection(project.id, s.id);
          else list.deleteProject(project.id);
          break;
        }
        case 9:
          purging = true;
          if (rand(2)) list.emptyTrash();
          else list.purgeExpired(now() + 31 * DAY);
          break;
        case 10:
          list.undo();
          break;
      }
      checkInvariants(list.data);
      if (purging)
        for (const id of before) expect(list.getTask(id), 'a live task survives a purge').toBeDefined();
    }
  });
});
