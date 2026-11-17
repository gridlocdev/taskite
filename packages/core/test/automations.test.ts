import { beforeEach, describe, expect, it } from 'vitest';
import {
  INBOX_ID,
  MAX_ACTIONS,
  MAX_RULES,
  TaskList,
  cleanAutomations,
  describeAutomations,
  describeRule,
  emptyData,
  normalize,
  parseDataFile,
  serialize,
  type SectionAutomation,
} from '../src/index.ts';
import { checkInvariants } from './support/invariants.ts';

let list: TaskList;

beforeEach(() => {
  let n = 0;
  list = new TaskList(emptyData(), { newId: () => `id${++n}`, now: () => 5 });
});

const anywhere = () => true;
const section = (projectId: string, id: string) => list.getSection(projectId, id);

describe('section automations in the file (PRD §6.1)', () => {
  it('keeps the actions it understands, in order', () => {
    const rules = cleanAutomations(
      [
        {
          on: 'enter',
          do: [
            { complete: true },
            { due: 'today' },
            { due: '+3' },
            { due: null },
            { priority: 1 },
            { addLabel: ' shipped ' },
          ],
        },
        { on: 'complete', do: [{ removeLabel: 'focus' }, { moveTo: { projectId: 'p', sectionId: null } }] },
      ],
      anywhere,
    );
    expect(rules).toEqual([
      {
        on: 'enter',
        do: [{ complete: true }, { due: 'today' }, { due: '+3' }, { due: null }, { priority: 1 }],
      },
      { on: 'complete', do: [{ removeLabel: 'focus' }, { moveTo: { projectId: 'p', sectionId: null } }] },
    ]);
  });

  it('drops actions it does not understand, and rules left with none', () => {
    const rules = cleanAutomations(
      [
        {
          on: 'enter',
          do: [{ ring: 'bell' }, { priority: 7 }, { due: '+0' }, { due: '+999' }, { due: 'soon' }],
        },
        { on: 'leave', do: [{ complete: true }] },
        { on: 'complete', do: [{ addLabel: '  ' }, { complete: 'yes' }, { complete: false, extra: 1 }] },
        { on: 'complete', do: [{ moveTo: { projectId: 'gone', sectionId: null } }] },
        'nonsense',
        { on: 'enter', do: [{ due: 'tomorrow' }] },
      ],
      (projectId) => projectId !== 'gone',
    );
    expect(rules).toEqual([{ on: 'enter', do: [{ due: 'tomorrow' }] }]);
  });

  it(`keeps at most ${MAX_RULES} rules of ${MAX_ACTIONS} actions`, () => {
    const many = Array.from({ length: 12 }, () => ({
      on: 'enter',
      do: Array.from({ length: 7 }, () => ({ complete: true })),
    }));
    const rules = cleanAutomations(many, anywhere);
    expect(rules).toHaveLength(MAX_RULES);
    expect(rules.every((r) => r.do.length === MAX_ACTIONS)).toBe(true);
  });

  it('reads rules from a file, dropping moves to places that are not there', () => {
    const data = normalize({
      projects: [
        {
          id: 'w',
          name: 'Work',
          sections: [
            {
              id: 'doing',
              name: 'Doing',
              automations: [
                { on: 'complete', do: [{ moveTo: { projectId: 'w', sectionId: 'done' } }] },
                { on: 'enter', do: [{ moveTo: { projectId: 'w', sectionId: 'nowhere' } }] },
              ],
            },
            { id: 'done', name: 'Done', automations: [] },
          ],
        },
      ],
    });
    const [doing, done] = data.projects.find((p) => p.id === 'w')?.sections ?? [];
    expect(doing?.automations).toEqual([
      { on: 'complete', do: [{ moveTo: { projectId: 'w', sectionId: 'done' } }] },
    ]);
    expect(done && 'automations' in done).toBe(false);
  });

  it('saves and reloads rules unchanged, and leaves them out while a section has none', () => {
    const s = list.addSection(INBOX_ID, 'Done');
    if (!s) throw new Error('no section');
    expect(serialize(list.data)).not.toContain('automations');
    const rules: SectionAutomation[] = [{ on: 'enter', do: [{ complete: true }, { addLabel: 'shipped' }] }];
    list.setSectionAutomations(INBOX_ID, s.id, rules);
    const loaded = parseDataFile(serialize(list.data));
    if (!loaded.ok) throw new Error('did not load');
    expect(loaded.data.projects[0]?.sections?.[0]?.automations).toEqual(rules);
  });
});

describe('editing section automations', () => {
  it('saving rules is one undo step, and saving the same rules records nothing', () => {
    const s = list.addSection(INBOX_ID, 'Doing');
    if (!s) throw new Error('no section');
    const rules: SectionAutomation[] = [{ on: 'enter', do: [{ due: 'today' }] }];
    list.setSectionAutomations(INBOX_ID, s.id, rules);
    expect(section(INBOX_ID, s.id)?.automations).toEqual(rules);
    list.setSectionAutomations(INBOX_ID, s.id, structuredClone(rules));
    list.undo();
    expect(section(INBOX_ID, s.id)?.automations).toBeUndefined();
    list.redo();
    list.setSectionAutomations(INBOX_ID, s.id, []);
    expect(section(INBOX_ID, s.id) && 'automations' in section(INBOX_ID, s.id)!).toBe(false);
    checkInvariants(list.data);
  });

  it('keeps its own copy of the rules it was given', () => {
    const s = list.addSection(INBOX_ID, 'Doing');
    if (!s) throw new Error('no section');
    const rules: SectionAutomation[] = [{ on: 'enter', do: [{ due: 'today' }] }];
    list.setSectionAutomations(INBOX_ID, s.id, rules);
    rules[0]?.do.push({ complete: true });
    expect(section(INBOX_ID, s.id)?.automations?.[0]?.do).toHaveLength(1);
  });

  it('deleting a section drops its rules and every move to it, and Undo brings them back', () => {
    const doing = list.addSection(INBOX_ID, 'Doing');
    const done = list.addSection(INBOX_ID, 'Done');
    if (!doing || !done) throw new Error('no section');
    const toDone: SectionAutomation = {
      on: 'complete',
      do: [{ addLabel: 'x' }, { moveTo: { projectId: INBOX_ID, sectionId: done.id } }],
    };
    list.setSectionAutomations(INBOX_ID, doing.id, [
      toDone,
      { on: 'enter', do: [{ moveTo: { projectId: INBOX_ID, sectionId: done.id } }] },
    ]);
    list.setSectionAutomations(INBOX_ID, done.id, [{ on: 'enter', do: [{ complete: true }] }]);
    list.deleteSection(INBOX_ID, done.id);
    expect(section(INBOX_ID, doing.id)?.automations).toEqual([{ on: 'complete', do: [{ addLabel: 'x' }] }]);
    checkInvariants(list.data);
    list.undo();
    expect(section(INBOX_ID, doing.id)?.automations).toEqual([
      toDone,
      { on: 'enter', do: [{ moveTo: { projectId: INBOX_ID, sectionId: done.id } }] },
    ]);
    expect(section(INBOX_ID, done.id)?.automations).toEqual([{ on: 'enter', do: [{ complete: true }] }]);
  });

  it('deleting a project drops moves into it or any of its sections', () => {
    const doing = list.addSection(INBOX_ID, 'Doing');
    const work = list.addProject('Work', 'blue');
    const later = list.addSection(work.id, 'Later');
    if (!doing || !later) throw new Error('no section');
    list.setSectionAutomations(INBOX_ID, doing.id, [
      { on: 'enter', do: [{ moveTo: { projectId: work.id, sectionId: null } }] },
      { on: 'complete', do: [{ moveTo: { projectId: work.id, sectionId: later.id } }, { priority: 2 }] },
    ]);
    list.deleteProject(work.id);
    expect(section(INBOX_ID, doing.id)?.automations).toEqual([{ on: 'complete', do: [{ priority: 2 }] }]);
    checkInvariants(list.data);
  });

  it('Edit Label… renames the label in rules too, ignoring case', () => {
    const doing = list.addSection(INBOX_ID, 'Doing');
    if (!doing) throw new Error('no section');
    list.setSectionAutomations(INBOX_ID, doing.id, [
      { on: 'enter', do: [{ addLabel: 'Focus' }, { removeLabel: 'focus' }, { addLabel: 'other' }] },
    ]);
    // No task uses the label: the rule still follows the rename.
    list.editLabel('focus', 'deep-work', null);
    expect(section(INBOX_ID, doing.id)?.automations?.[0]?.do).toEqual([
      { addLabel: 'deep-work' },
      { removeLabel: 'deep-work' },
      { addLabel: 'other' },
    ]);
    list.undo();
    expect(section(INBOX_ID, doing.id)?.automations?.[0]?.do[0]).toEqual({ addLabel: 'Focus' });
  });
});

describe('running section automations (PRD §6.1)', () => {
  const TODAY = '2026-10-09'; // a Friday
  let doing: string;
  let done: string;

  beforeEach(() => {
    let n = 0;
    list = new TaskList(emptyData(), {
      newId: () => `id${++n}`,
      now: () => new Date(2026, 9, 9, 12).getTime(),
      weekStart: 1,
    });
    doing = list.addSection(INBOX_ID, 'Doing')?.id ?? '';
    done = list.addSection(INBOX_ID, 'Done')?.id ?? '';
  });

  const rules = (sectionId: string, ...r: SectionAutomation[]) =>
    list.setSectionAutomations(INBOX_ID, sectionId, r);
  const task = (id: string) => list.getTask(id);

  it('a task made in a section runs its enter rules, in the same undo step', () => {
    rules(doing, { on: 'enter', do: [{ due: 'today' }, { priority: 1 }, { addLabel: 'focus' }] });
    const t = list.addTask({ title: 'Write', sectionId: doing });
    expect(task(t.id)).toMatchObject({ due: TODAY, priority: 1, labels: ['focus'] });
    expect(list.automated.map((r) => r.action)).toEqual([
      { due: 'today' },
      { priority: 1 },
      { addLabel: 'focus' },
    ]);
    list.undo();
    expect(task(t.id)).toBeUndefined();
  });

  it('moving a task into a section runs its enter rules; moving within it or editing does not', () => {
    rules(done, { on: 'enter', do: [{ complete: true }, { removeLabel: 'FOCUS' }] });
    const t = list.addTask({ title: 'Ship', sectionId: doing, labels: ['focus'] });
    list.updateTasks(t.id, { sectionId: done });
    expect(task(t.id)).toMatchObject({ completed: true, labels: [] });
    list.undo();
    expect(task(t.id)).toMatchObject({ sectionId: doing, completed: false, labels: ['focus'] });
    list.updateTasks(t.id, { title: 'Ship it' });
    expect(list.automated).toEqual([]);
  });

  it('only actions that change something are reported', () => {
    rules(doing, { on: 'enter', do: [{ priority: 4 }, { addLabel: 'x' }, { removeLabel: 'nope' }] });
    list.addTask({ title: 'A', sectionId: doing });
    expect(list.automated.map((r) => r.action)).toEqual([{ addLabel: 'x' }]);
  });

  it('dates count from today: tomorrow, in N days, next week, none', () => {
    const cases: [SectionAutomation['do'][number], string | null][] = [
      [{ due: 'tomorrow' }, '2026-10-10'],
      [{ due: '+10' }, '2026-10-19'],
      [{ due: 'nextWeek' }, '2026-10-12'],
      [{ due: null }, null],
    ];
    for (const [action, want] of cases) {
      rules(doing, { on: 'enter', do: [action] });
      const t = list.addTask({ title: 'A', sectionId: doing, due: '2026-01-01' });
      expect(task(t.id)?.due).toBe(want);
    }
  });

  it('completing a task in a section runs its complete rules, and a move chains into the next section', () => {
    rules(doing, { on: 'complete', do: [{ moveTo: { projectId: INBOX_ID, sectionId: done } }] });
    rules(done, { on: 'enter', do: [{ addLabel: 'shipped' }] });
    const t = list.addTask({ title: 'Ship', sectionId: doing });
    list.completeTasks(t.id, TODAY);
    expect(task(t.id)).toMatchObject({ completed: true, sectionId: done, labels: ['shipped'] });
    expect(list.automated.map((r) => r.sectionId)).toEqual([doing, done]);
    list.undo();
    expect(task(t.id)).toMatchObject({ completed: false, sectionId: doing, labels: [] });
  });

  it('a repeating task that moves to its next date is not completed, so complete rules do not run', () => {
    rules(doing, { on: 'complete', do: [{ addLabel: 'x' }] });
    const t = list.addTask({ title: 'Water', sectionId: doing, due: TODAY, recurrence: 'daily' });
    list.completeTasks(t.id, TODAY);
    expect(task(t.id)?.labels).toEqual([]);
  });

  it("a complete action sets off the section's complete rules", () => {
    rules(done, { on: 'enter', do: [{ complete: true }] }, { on: 'complete', do: [{ priority: 2 }] });
    const t = list.addTask({ title: 'A', sectionId: done });
    expect(task(t.id)).toMatchObject({ completed: true, priority: 2 });
  });

  it('rules that move a task back and forth stop after each section has run once', () => {
    rules(doing, {
      on: 'enter',
      do: [{ moveTo: { projectId: INBOX_ID, sectionId: done } }, { addLabel: 'a' }],
    });
    rules(done, {
      on: 'enter',
      do: [{ moveTo: { projectId: INBOX_ID, sectionId: doing } }, { addLabel: 'b' }],
    });
    const t = list.addTask({ title: 'Loop', sectionId: doing });
    expect(task(t.id)).toMatchObject({ sectionId: doing, labels: ['a', 'b'] });
  });

  it("a move to another project brings the subtasks, and runs that section's rules", () => {
    const work = list.addProject('Work');
    const later = list.addSection(work.id, 'Later')?.id ?? '';
    rules(doing, { on: 'enter', do: [{ moveTo: { projectId: work.id, sectionId: later } }] });
    list.setSectionAutomations(work.id, later, [{ on: 'enter', do: [{ priority: 3 }] }]);
    const parent = list.addTask({ title: 'P' });
    const sub = list.addTask({ title: 'S', parentId: parent.id });
    list.updateTasks(parent.id, { sectionId: doing });
    expect(task(parent.id)).toMatchObject({ projectId: work.id, sectionId: later, priority: 3 });
    expect(task(sub.id)).toMatchObject({
      projectId: work.id,
      sectionId: later,
      parentId: parent.id,
      priority: 4,
    });
    checkInvariants(list.data);
  });

  it('subtasks do not set off rules', () => {
    rules(doing, { on: 'enter', do: [{ addLabel: 'x' }] }, { on: 'complete', do: [{ addLabel: 'y' }] });
    const parent = list.addTask({ title: 'P', sectionId: doing });
    const sub = list.addTask({ title: 'S', parentId: parent.id });
    list.completeTasks(sub.id, TODAY);
    expect(task(sub.id)?.labels).toEqual([]);
  });

  it('Apply runs enter rules on the tasks already in the section, as one undo step', () => {
    const a = list.addTask({ title: 'A', sectionId: done });
    const b = list.addTask({ title: 'B', sectionId: done });
    const other = list.addTask({ title: 'C', sectionId: doing });
    rules(done, { on: 'enter', do: [{ complete: true }] });
    list.applyEnterRules(INBOX_ID, done);
    expect([a, b, other].map((t) => task(t.id)?.completed)).toEqual([true, true, false]);
    list.undo();
    expect([a, b].map((t) => task(t.id)?.completed)).toEqual([false, false]);
  });
});

describe('saying what automations did (PRD §6.1)', () => {
  it('names each action once, with how many tasks it changed', () => {
    const doing = list.addSection(INBOX_ID, 'Doing')?.id ?? '';
    const work = list.addProject('Work');
    const later = list.addSection(work.id, 'Later')?.id ?? '';
    const run = (taskId: string, action: SectionAutomation['do'][number]) => ({
      taskId,
      projectId: INBOX_ID,
      sectionId: doing,
      action,
    });
    expect(
      describeAutomations(list, [
        run('a', { complete: true }),
        run('b', { complete: true }),
        run('a', { addLabel: 'x' }),
        run('a', { removeLabel: 'y' }),
        run('a', { due: '+1' }),
        run('a', { due: null }),
        run('a', { priority: 2 }),
        run('a', { moveTo: { projectId: INBOX_ID, sectionId: doing } }),
        run('a', { moveTo: { projectId: work.id, sectionId: later } }),
        run('a', { moveTo: { projectId: work.id, sectionId: null } }),
        run('a', { complete: false }),
      ]),
    ).toBe(
      'completed 2 tasks, added @x, removed @y, made it due in 1 day, removed its date, set it to priority 2, ' +
        'moved it to Doing, moved it to Work › Later, moved it to Work, reopened it',
    );
    expect(describeAutomations(list, [])).toBe('');
  });
});

describe('a rule as one line (PRD §6.1)', () => {
  it('reads as a sentence, naming moves within the project by section alone', () => {
    const doing = list.addSection(INBOX_ID, 'Doing')?.id ?? '';
    const work = list.addProject('Work');
    const later = list.addSection(work.id, 'Later')?.id ?? '';
    expect(
      describeRule(list, INBOX_ID, {
        on: 'enter',
        do: [
          { complete: true },
          { due: 'nextWeek' },
          { due: '+3' },
          { priority: 1 },
          { addLabel: 'x' },
          { moveTo: { projectId: INBOX_ID, sectionId: doing } },
        ],
      }),
    ).toBe(
      'When a task enters: complete it, make it due next week, make it due in 3 days, set priority 1, add @x, ' +
        'move it to Doing',
    );
    expect(
      describeRule(list, INBOX_ID, {
        on: 'complete',
        do: [
          { complete: false },
          { due: null },
          { removeLabel: 'y' },
          { moveTo: { projectId: work.id, sectionId: later } },
          { moveTo: { projectId: work.id, sectionId: null } },
        ],
      }),
    ).toBe(
      'When a task is completed: reopen it, remove its date, remove @y, move it to Work › Later, move it to Work',
    );
  });
});
