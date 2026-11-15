import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { INBOX_ID, TaskList, normalize, parseDataFile, serialize } from '../src/index.ts';

const v1 = readFileSync(new URL('./fixtures/v1-tasks.json', import.meta.url), 'utf8');

describe('the data file', () => {
  it('reads a file 1.x wrote and writes it back byte for byte', () => {
    const parsed = parseDataFile(v1);
    if (!parsed.ok) throw new Error('fixture did not parse');
    expect(serialize(parsed.data)).toBe(v1);
  });

  it('still writes the same bytes after an edit and its undo', () => {
    const parsed = parseDataFile(v1);
    if (!parsed.ok) throw new Error('fixture did not parse');
    const list = new TaskList(parsed.data);
    list.addTask({ title: 'Temp' });
    list.undo();
    expect(serialize(list.data)).toBe(v1);
  });

  it('reports text that is not JSON instead of throwing', () => {
    expect(parseDataFile('{ nope')).toEqual({ ok: false, reason: 'corrupt' });
  });

  it('normalize repairs incomplete data', () => {
    const data = normalize(
      { tasks: [{ id: 'a', title: 'x', projectId: 'missing', priority: 9, due: 'soon' }] },
      5,
    );
    expect(data.projects.map((p) => p.id)).toEqual([INBOX_ID]);
    const [task] = data.tasks;
    expect(task).toMatchObject({
      projectId: INBOX_ID,
      priority: 4,
      labels: [],
      due: null,
      createdAt: 5,
      order: 0,
    });
    expect(data.settings.theme).toBe('auto');
  });

  it('normalize drops bad tasks, projects and colours', () => {
    const data = normalize({
      projects: [{ id: 'p', name: 'P', color: 'chartreuse' }, { id: 'q' }],
      tasks: [{ id: 'a' }, { title: 'no id' }, null],
    });
    expect(data.projects.map((p) => [p.id, p.color])).toEqual([
      [INBOX_ID, 'gray'],
      ['p', 'gray'],
    ]);
    expect(data.tasks).toEqual([]);
  });

  it('the last view is kept, and a bad one is dropped', () => {
    const view = (lastView: unknown) => normalize({ settings: { lastView } }).settings.lastView;
    expect(view({ type: 'label', name: 'x' })).toEqual({ type: 'label', name: 'x' });
    expect(view({ type: 'nope' })).toBeNull();
    expect(view({ type: 'project' })).toBeNull();
  });
});
