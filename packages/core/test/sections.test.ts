import { beforeEach, describe, expect, it } from 'vitest';
import {
  INBOX_ID,
  TaskList,
  addDraft,
  emptyData,
  normalize,
  resolveDraft,
  viewContent,
} from '../src/index.ts';

const TODAY = '2026-10-09';
let list: TaskList;

beforeEach(() => {
  let n = 0;
  list = new TaskList(emptyData(), { newId: () => `id${++n}`, now: () => 5 });
});

const shape = (id: string) =>
  viewContent(list, { type: 'project', id }, TODAY).sections.map((s) => [
    s.heading,
    s.rows.map((r) => r.task.title),
  ]);

describe('project sections', () => {
  it('lists unsectioned tasks first, then each section in order', () => {
    const doing = list.addSection(INBOX_ID, ' Doing ');
    const done = list.addSection(INBOX_ID, 'Later');
    if (!doing || !done) throw new Error('no section');
    expect(doing.name).toBe('Doing');
    list.addTask({ title: 'Loose' });
    const a = list.addTask({ title: 'A', sectionId: doing.id });
    list.addTask({ title: 'A1', parentId: a.id });
    list.addTask({ title: 'B', sectionId: done.id });
    expect(shape(INBOX_ID)).toEqual([
      [null, ['Loose']],
      ['Doing', ['A', 'A1']],
      ['Later', ['B']],
    ]);
    expect(list.getTask('id5')?.sectionId).toBe(doing.id); // the subtask follows its parent
  });

  it('adds in between, renames and moves sections', () => {
    const a = list.addSection(INBOX_ID, 'A');
    list.addSection(INBOX_ID, 'C');
    list.addSection(INBOX_ID, 'B', a?.id);
    expect(list.getProject(INBOX_ID)?.sections?.map((s) => s.name)).toEqual(['A', 'B', 'C']);
    list.renameSection(INBOX_ID, a?.id ?? '', 'First');
    list.moveSection(INBOX_ID, a?.id ?? '', 1);
    list.moveSection(INBOX_ID, a?.id ?? '', 1);
    list.moveSection(INBOX_ID, a?.id ?? '', 1); // already last
    expect(list.getProject(INBOX_ID)?.sections?.map((s) => s.name)).toEqual(['B', 'C', 'First']);
  });

  it('deleting a section trashes its tasks; restored, they come back unsectioned', () => {
    const s = list.addSection(INBOX_ID, 'Gone');
    const t = list.addTask({ title: 'T', sectionId: s?.id });
    list.deleteSection(INBOX_ID, s?.id ?? '');
    expect(list.getProject(INBOX_ID)?.sections).toBeUndefined();
    expect(list.getTask(t.id)?.deletedAt).toBe(5);
    list.restoreTasks(t.id);
    expect(list.getTask(t.id)?.sectionId).toBeUndefined();
    list.undo();
    list.undo();
    expect(list.getTask(t.id)?.sectionId).toBe(s?.id);
  });

  it('moving to another project or out of a section drops the section', () => {
    const s = list.addSection(INBOX_ID, 'S');
    const other = list.addProject('Other');
    const t = list.addTask({ title: 'T', sectionId: s?.id });
    const sub = list.addTask({ title: 'Sub', parentId: t.id });
    list.updateTasks(t.id, { title: 'T2' });
    expect(list.getTask(t.id)?.sectionId).toBe(s?.id);
    list.updateTasks(t.id, { projectId: other.id });
    expect(list.getTask(t.id)?.sectionId).toBeUndefined();
    expect(list.getTask(sub.id)).toMatchObject({ projectId: other.id });
    expect(list.getTask(sub.id)?.sectionId).toBeUndefined();
    list.updateTasks(t.id, { projectId: INBOX_ID, sectionId: s?.id });
    expect(list.getTask(sub.id)?.sectionId).toBe(s?.id);
    list.updateTasks(t.id, { sectionId: undefined });
    expect(Object.keys(list.getTask(t.id) ?? {})).not.toContain('sectionId');
  });

  it('a board hides the empty unsectioned column', () => {
    const s = list.addSection(INBOX_ID, 'To do');
    list.setProjectView(INBOX_ID, 'board');
    expect(list.getProject(INBOX_ID)?.view).toBe('board');
    const content = viewContent(list, { type: 'project', id: INBOX_ID }, TODAY);
    expect(content.board).toBe(true);
    expect(content.empty).toBeNull();
    expect(content.sections.map((x) => x.key)).toEqual([`section:${s?.id}`]);
    list.addTask({ title: 'Loose' });
    expect(shape(INBOX_ID)[0]).toEqual(['No section', ['Loose']]);
    list.setProjectView(INBOX_ID, 'list');
    expect(list.getProject(INBOX_ID)).not.toHaveProperty('view');
  });

  it('Add task under a section adds into it', () => {
    const s = list.addSection(INBOX_ID, 'S');
    const draft = resolveDraft('Write it', { type: 'project', id: INBOX_ID }, `section:${s?.id}`, TODAY);
    const { task } = addDraft(list, draft);
    expect(task?.sectionId).toBe(s?.id);
    // "#Other" sends it to a project without that section.
    const other = resolveDraft(
      'Elsewhere #Other',
      { type: 'project', id: INBOX_ID },
      `section:${s?.id}`,
      TODAY,
    );
    expect(addDraft(list, other).task?.sectionId).toBeUndefined();
  });

  it('the file keeps sections and drops section ids that point nowhere', () => {
    const data = normalize({
      projects: [
        {
          id: INBOX_ID,
          name: 'Inbox',
          color: 'gray',
          sections: [{ id: 's1', name: 'S' }, { id: 2 }],
          view: 'board',
        },
        { id: 'p', name: 'P', color: 'red', view: 'grid', sections: [] },
      ],
      tasks: [
        { id: 'a', title: 'A', projectId: INBOX_ID, sectionId: 's1' },
        { id: 'b', title: 'B', projectId: INBOX_ID, sectionId: 'nope' },
        { id: 'c', title: 'C', projectId: 'p', sectionId: 's1' },
      ],
    });
    expect(data.projects[0]).toMatchObject({ sections: [{ id: 's1', name: 'S' }], view: 'board' });
    expect(data.projects[1]).not.toHaveProperty('view');
    expect(data.projects[1]).not.toHaveProperty('sections');
    expect(data.tasks.map((t) => t.sectionId)).toEqual(['s1', undefined, undefined]);
    expect(data.tasks[1]).not.toHaveProperty('sectionId');
  });
});
