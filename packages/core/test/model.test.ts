import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { INBOX_ID, TaskList, copyFileName, normalize, parseDataFile, serialize } from '../src/index.ts';

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

  it('keeps fields it does not know through a load, an edit and a save', () => {
    const text = JSON.stringify({
      version: 1,
      future: { a: 1 },
      projects: [{ id: 'inbox', name: 'Inbox', color: 'gray', emoji: '📥' }],
      tasks: [{ id: 't', title: 'Milk', projectId: 'inbox', estimate: 15 }],
      settings: { theme: 'dark', density: 'compact' },
    });
    const parsed = parseDataFile(text);
    if (!parsed.ok) throw new Error('did not parse');
    const list = new TaskList(parsed.data);
    list.updateTasks(['t'], { title: 'Oat milk' });
    const saved = JSON.parse(serialize(list.data));
    expect(saved.future).toEqual({ a: 1 });
    expect(saved.projects[0].emoji).toBe('📥');
    expect(saved.tasks[0]).toMatchObject({ title: 'Oat milk', estimate: 15 });
    expect(saved.settings).toMatchObject({ theme: 'dark', density: 'compact' });
  });

  it('refuses a file from a newer Taskite instead of reading half of it', () => {
    expect(parseDataFile('{"version": 2, "tasks": []}')).toEqual({ ok: false, reason: 'newer', version: 2 });
  });

  it('reads a file that starts with a byte-order mark', () => {
    const parsed = parseDataFile('\uFEFF{"version": 1, "tasks": [{"id": "a", "title": "A"}]}');
    expect(parsed.ok && parsed.data.tasks.map((t) => t.title)).toEqual(['A']);
  });

  it('treats JSON that is not an object as unreadable, so it is kept as a copy', () => {
    for (const text of ['[]', 'null', '5', '"tasks"', '[{"id": "a"}]'])
      expect(parseDataFile(text), text).toEqual({ ok: false, reason: 'corrupt' });
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

describe('copy names', () => {
  it('dates copies and numbers clashes', () => {
    const now = new Date(2026, 10, 15, 9, 5, 7);
    expect(copyFileName('copy', now)).toBe('tasks.copy-2026-11-15-090507.json');
    expect(copyFileName('copy', now, 2)).toBe('tasks.copy-2026-11-15-090507-2.json');
    expect(copyFileName('corrupt', now)).toBe(`tasks.corrupt-${now.getTime()}.json`);
  });

  it('keeps label colours it knows, by lower-case label, and leaves the field out when there are none', () => {
    const data = normalize({ labelColors: { Home: 'green', Work: 'plaid', x: 3 } });
    expect(data.labelColors).toEqual({ home: 'green' });
    expect('labelColors' in normalize({ labelColors: { a: 'nope' } })).toBe(false);
    expect('labelColors' in normalize({})).toBe(false);
  });
});
