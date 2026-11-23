import { describe, expect, it } from 'vitest';
import {
  TaskList,
  emptyData,
  parseQuickAdd,
  projectNameFromTag,
  quickAddLine,
  tasksAsText,
} from '../src/index.ts';

const TODAY = '2026-10-09';

function make() {
  let n = 0;
  const list = new TaskList(emptyData(), { now: () => 1_000_000, newId: () => `id${++n}` });
  const home = list.addProject('Big Plans');
  return { list, home };
}

describe('copying tasks as text (PRD §4.9)', () => {
  it('writes each task as a Markdown task with what Quick Add would read', () => {
    const { list, home } = make();
    const a = list.addTask({
      title: 'Pay rent',
      projectId: home.id,
      due: '2026-11-01',
      recurrence: 'monthly',
      priority: 1,
      labels: ['bills', 'home'],
    });
    const b = list.addTask({ title: 'Buy milk' });
    list.completeTasks([b.id]);
    expect(tasksAsText(list, [a.id, b.id])).toBe(
      '- [ ] Pay rent 2026-11-01 every month p1 #Big-Plans @bills @home\n- [x] Buy milk',
    );
  });

  it('reads back through Quick Add as the same task', () => {
    const { list, home } = make();
    const t = list.addTask({
      title: 'Water the plants',
      projectId: home.id,
      due: '2026-10-12',
      recurrence: 'weekly',
      priority: 2,
      labels: ['garden'],
    });
    const back = parseQuickAdd(quickAddLine(list, t), TODAY);
    expect(back).toMatchObject({
      title: 'Water the plants',
      due: '2026-10-12',
      recurrence: 'weekly',
      priority: 2,
      labels: ['garden'],
    });
    expect(projectNameFromTag(back.projectName ?? '')).toBe('Big Plans');
  });

  it('puts notes and subtasks under their task, and lists a subtask chosen alone on its own', () => {
    const { list } = make();
    const parent = list.addTask({ title: 'Plan trip', description: 'Book early.\n\nWindow seat.' });
    const sub = list.addTask({ title: 'Book flights', parentId: parent.id });
    const gone = list.addTask({ title: 'Old idea', parentId: parent.id });
    list.deleteTasks([gone.id]);
    expect(tasksAsText(list, [parent.id, sub.id])).toBe(
      '- [ ] Plan trip\n  Book early.\n  Window seat.\n  - [ ] Book flights',
    );
    expect(tasksAsText(list, [sub.id])).toBe('- [ ] Book flights');
  });
});
