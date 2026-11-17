import { beforeEach, describe, expect, it } from 'vitest';
import {
  INBOX_ID,
  MAX_ACTIONS,
  MAX_RULES,
  TaskList,
  cleanAutomations,
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
