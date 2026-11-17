import { describe, expect, it } from 'vitest';
import { INBOX_ID } from '@taskite/core';
import { filterEntries } from '@taskite/ui';
import { MENUS, TASK_MENU, closestTo, dynamicEntries } from '../src/app/commands.ts';
import { nativeMenu } from '../src/app/nativeMenu.ts';
import { shortcutGroups } from '../src/app/shortcuts.ts';
import { makeApp } from './helpers.ts';

const key = (k: string, more: Partial<KeyboardEvent> = {}) =>
  ({ key: k, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...more }) as KeyboardEvent;

describe('commands', () => {
  it('the command menu finds commands by run-together names and by their keywords', async () => {
    const { catalog } = await makeApp();
    const entries = catalog.all
      .filter((c) => !c.hidden)
      .map((c) => ({
        id: c.id,
        title: c.title,
        group: c.group,
        keywords: `${c.keywords ?? ''} ${c.description}`,
      }));
    const first = (q: string) => filterEntries(entries, q)[0]?.id;
    expect(first('newtask')).toBe('task.new');
    expect(first('new task')).toBe('task.new');
    expect(first('movetotrash')).toBe('task.delete');
    expect(first('preferences')).toBe('app.settings');
    expect(first('deadline')).toBe('task.due');
    expect(first('hotkeys')).toBe('help.shortcuts');
    expect(filterEntries(entries, 'reorder').map((e) => e.id)).toEqual(['task.moveUp', 'task.moveDown']);
    for (const c of catalog.all)
      for (const word of (c.keywords ?? '').toLowerCase().split(/\s+/).filter(Boolean))
        expect(c.title.toLowerCase().split(/[^a-z0-9]+/), `${c.id} repeats "${word}"`).not.toContain(word);
  });

  it('every command says what it does', async () => {
    const { catalog } = await makeApp();
    for (const c of catalog.all) expect(c.description, c.id).toMatch(/^[A-Z].*\.$/);
  });

  it('the task menu only names real commands', async () => {
    const { catalog } = await makeApp();
    for (const id of TASK_MENU) if (id !== '|') expect(catalog.get(id), id).toBeDefined();
  });

  it('Delete trashes outside the Trash and deletes for good inside it', async () => {
    const { app, catalog } = await makeApp();
    app.addTask('A', 'end');
    app.step(1);
    expect(catalog.forEvent(key('Backspace'), 'list', 0, true)).toMatchObject({
      command: { id: 'task.delete' },
    });
    await app.trash();
    app.go({ type: 'trash' });
    app.step(1);
    expect(catalog.forEvent(key('Backspace'), 'list', 0, true)).toMatchObject({
      command: { id: 'task.purge' },
    });
  });

  it('G then I goes to the Inbox, and letters do nothing in a text field', async () => {
    const { app, catalog } = await makeApp();
    app.go({ type: 'today' });
    expect(catalog.forEvent(key('g'), 'list', 0, true)).toEqual({ kind: 'wait' });
    const r = catalog.forEvent(key('i'), 'list', 10, true);
    expect(r).toMatchObject({ command: { id: 'go.inbox' } });
    expect(catalog.forEvent(key('n'), 'text', 0, true)).toBeNull();
    expect(catalog.forEvent(key('n', { metaKey: true }), 'text', 0, true)).toMatchObject({
      command: { id: 'task.new' },
    });
  });

  it('a dialog holds commands except the toggles', async () => {
    const { app, catalog } = await makeApp();
    app.open({ kind: 'settings' });
    expect(catalog.run('task.new')).toBe(false);
    expect(catalog.run('help.shortcuts')).toBe(true);
    expect(app.dialog.value?.kind).toBe('shortcuts');
    expect(catalog.run('help.shortcuts')).toBe(true);
    expect(app.dialog.value).toBeNull();
  });

  it('offers Go to and Move to entries', async () => {
    const { app } = await makeApp();
    app.list.addProject('Work');
    app.addTask('A @phone', 'end');
    app.step(1);
    const titles = dynamicEntries(app).map((e) => e.title);
    expect(titles).toEqual(
      expect.arrayContaining(['Go to Work', 'Go to @phone', 'Move to Work', 'Go to Inbox']),
    );
  });

  it('builds the menu bar with ⌘ chords as accelerators and plain keys in the title', async () => {
    const { catalog } = await makeApp();
    const menu = nativeMenu(catalog);
    expect(menu.map((m) => ('label' in m ? m.label : ''))).toEqual([
      'File',
      'Edit',
      'Task',
      'Select',
      'Go',
      'View',
      'Help',
    ]);
    const items = menu.flatMap((m) => ('submenu' in m ? (m.submenu ?? []) : []));
    expect(items).toContainEqual(
      expect.objectContaining({ command: 'task.new', accelerator: 'CmdOrCtrl+N' }),
    );
    expect(items).toContainEqual(expect.objectContaining({ command: 'task.due', label: 'Due Date…\tD' }));
    expect(items).toContainEqual(expect.objectContaining({ command: 'go.inbox', label: 'Go to Inbox\tG I' }));
    expect(items).toContainEqual(
      expect.objectContaining({ command: 'view.theme.auto', type: 'checkbox', checked: true }),
    );
  });

  it('lists shortcuts by group with every way to press them', async () => {
    const { catalog } = await makeApp();
    const groups = shortcutGroups(catalog, true);
    expect(groups.map((g) => g.title)).toEqual([
      'Adding',
      'Undo',
      'Tasks',
      'Choosing tasks',
      'Going places',
      'Help',
    ]);
    const newTask = groups[0]!.lines.find((l) => l.title === 'New Task');
    expect(newTask?.keys).toEqual([['⌘N'], ['N']]);
  });

  it('⌘N adds a task and Shift+⌘N makes a project, even while typing', async () => {
    const { catalog } = await makeApp();
    expect(catalog.forEvent(key('n', { metaKey: true }), 'text', 0, true)).toMatchObject({
      command: { id: 'task.new' },
    });
    expect(catalog.forEvent(key('N', { metaKey: true, shiftKey: true }), 'text', 0, true)).toMatchObject({
      command: { id: 'project.new' },
    });
    expect(catalog.forEvent(key('q'), 'list', 0, true)).toBeNull();
  });

  it('Show Completed Tasks keeps checked-off rows in view, is remembered, and is off in Completed', async () => {
    const { app, catalog, session } = await makeApp();
    const a = app.list.addTask({ title: 'A' });
    app.list.addTask({ title: 'B' });
    await app.toggleComplete([a.id]);
    expect(app.ids.value).not.toContain(a.id);

    const toggle = catalog.get('view.showCompleted')!;
    expect(catalog.isEnabled(toggle)).toBe(true);
    catalog.run('view.showCompleted');
    expect(app.showCompleted.value).toBe(true);
    expect(session.list.data.settings.showCompleted).toBe(true);
    expect(app.ids.value.at(-1)).toBe(a.id);

    const b = app.list.activeTasks()[0]!;
    app.cursor.value = b.id;
    await app.toggleComplete([b.id]);
    expect(app.ids.value).toContain(b.id);
    expect(app.cursor.value).toBe(b.id);

    app.go({ type: 'completed' });
    expect(catalog.isEnabled(toggle)).toBe(false);
    app.go({ type: 'today' });
    expect(catalog.isEnabled(toggle)).toBe(true);
    // Checked off today, so Today lists them.
    expect(app.ids.value).toEqual([a.id, b.id]);
  });

  it('New Task on a board with only sections opens in the first column', async () => {
    const { app, catalog } = await makeApp();
    app.go({ type: 'project', id: INBOX_ID });
    app.list.addSection(INBOX_ID, 'To do');
    app.setBoard(true);
    const first = app.content.value.sections[0]!;
    expect(first.addSlot).toMatch(/^section:/);
    catalog.run('task.new');
    expect(app.composer.value).toBe(first.addSlot);
  });

  it('New Task adds beside the task with the cursor: its board column, or its day in Upcoming', async () => {
    const { app, catalog } = await makeApp();
    app.go({ type: 'project', id: INBOX_ID });
    const todo = app.list.addSection(INBOX_ID, 'To do')!;
    const doing = app.list.addSection(INBOX_ID, 'Doing')!;
    const t = app.list.addTask({ title: 'T', sectionId: doing.id });
    app.setBoard(true);
    app.cursor.value = t.id;
    catalog.run('task.new');
    expect(app.composer.value).toBe(`section:${doing.id}`);
    app.closeComposer();
    app.cursor.value = null;
    catalog.run('task.new');
    expect(app.composer.value).toBe(`section:${todo.id}`);

    app.closeComposer();
    app.go({ type: 'upcoming' });
    const later = app.list.addTask({ title: 'U', due: '2026-03-12' });
    app.cursor.value = later.id;
    catalog.run('task.new');
    expect(app.composer.value).toBe('day:2026-03-12');
  });

  it('Shift+Option+Down and Up go to the first task of the next and previous section in a list', async () => {
    const { app, catalog } = await makeApp();
    app.go({ type: 'project', id: INBOX_ID });
    const a = app.list.addTask({ title: 'Loose' });
    const one = app.list.addSection(INBOX_ID, 'One')!;
    app.list.addSection(INBOX_ID, 'Empty');
    const three = app.list.addSection(INBOX_ID, 'Three')!;
    const b1 = app.list.addTask({ title: 'B1', sectionId: one.id });
    app.list.addTask({ title: 'B2', sectionId: one.id });
    const c1 = app.list.addTask({ title: 'C1', sectionId: three.id });
    const down = key('ArrowDown', { shiftKey: true, altKey: true });
    const up = key('ArrowUp', { shiftKey: true, altKey: true });
    const press = (e: KeyboardEvent) => {
      const r = catalog.forEvent(e, 'list', 0, true);
      if (r?.kind === 'run') catalog.run(r.command.id);
      return r?.kind === 'run' ? r.command.id : null;
    };
    expect(press(down)).toBe('select.nextSection');
    expect(app.cursor.value).toBe(a.id);
    press(down);
    expect(app.cursor.value).toBe(b1.id);
    expect(app.selectedIds()).toEqual([b1.id]);
    // The empty section is skipped.
    press(down);
    expect(app.cursor.value).toBe(c1.id);
    expect(press(down)).toBeNull();
    press(up);
    expect(app.cursor.value).toBe(b1.id);
    // A list's sections aren't columns.
    expect(press(key('ArrowRight'))).toBeNull();
    expect(press(key('ArrowRight', { shiftKey: true, altKey: true }))).toBeNull();
  });

  it('on a board, Left and Right keep the place in the column and Shift+Option goes to the top', async () => {
    const { app, catalog } = await makeApp();
    app.go({ type: 'project', id: INBOX_ID });
    const one = app.list.addSection(INBOX_ID, 'One')!;
    app.list.addSection(INBOX_ID, 'Empty');
    const three = app.list.addSection(INBOX_ID, 'Three')!;
    const [a1, a2, a3] = ['A1', 'A2', 'A3'].map((title) => app.list.addTask({ title, sectionId: one.id }));
    const [b1, b2] = ['B1', 'B2'].map((title) => app.list.addTask({ title, sectionId: three.id }));
    app.setBoard(true);
    const press = (e: KeyboardEvent) => {
      const r = catalog.forEvent(e, 'list', 0, true);
      if (r?.kind === 'run') catalog.run(r.command.id);
      return r?.kind === 'run' ? r.command.id : null;
    };
    app.click(a2!.id);
    // Without a screen to measure, the same place in the next column that has tasks.
    expect(press(key('ArrowRight'))).toBe('select.columnRight');
    expect(app.cursor.value).toBe(b2!.id);
    expect(press(key('ArrowRight'))).toBeNull();
    press(key('ArrowLeft'));
    expect(app.cursor.value).toBe(a2!.id);
    app.click(a3!.id);
    press(key('ArrowRight'));
    expect(app.cursor.value).toBe(b2!.id);
    app.click(a3!.id);
    expect(press(key('ArrowRight', { shiftKey: true, altKey: true }))).toBe('select.nextColumn');
    expect(app.cursor.value).toBe(b1!.id);
    press(key('ArrowLeft', { shiftKey: true, altKey: true }));
    expect(app.cursor.value).toBe(a1!.id);
    expect(press(key('ArrowDown', { shiftKey: true, altKey: true }))).toBeNull();
  });

  it('closestTo picks the row level with the one the cursor leaves', () => {
    const rows = [
      { id: 'a', y: 10 },
      { id: 'b', y: 50 },
      { id: 'c', y: undefined },
      { id: 'd', y: 90 },
    ];
    expect(closestTo(55, rows)).toBe('b');
    expect(closestTo(500, rows)).toBe('d');
    expect(closestTo(30, rows)).toBe('a');
    expect(closestTo(0, [])).toBeUndefined();
  });

  it('Go to Section goes to a named section, or opens the add-task row in an empty one', async () => {
    const { app, catalog } = await makeApp();
    app.go({ type: 'project', id: INBOX_ID });
    app.list.addTask({ title: 'Loose' });
    const one = app.list.addSection(INBOX_ID, 'One')!;
    const empty = app.list.addSection(INBOX_ID, 'Empty')!;
    const t = app.list.addTask({ title: 'T', sectionId: one.id });
    expect(app.namedSections().map((s) => s.heading)).toEqual(['One', 'Empty']);
    catalog.run('go.section');
    expect(app.dialog.value).toEqual({ kind: 'sections' });
    app.close();
    const entry = (title: string) => dynamicEntries(app).find((e) => e.title === title)!;
    entry('Go to Section: One').run();
    expect(app.cursor.value).toBe(t.id);
    entry('Go to Section: Empty').run();
    expect(app.composer.value).toBe(`section:${empty.id}`);
    expect(app.cursor.value).toBeNull();
    // Today with nothing overdue has no headings to go to.
    app.go({ type: 'today' });
    expect(catalog.isEnabled(catalog.get('go.section')!)).toBe(false);
  });

  it('every menu only names real commands', async () => {
    const { catalog } = await makeApp();
    for (const [kind, ids] of Object.entries(MENUS))
      for (const id of ids) if (id !== '|') expect(catalog.get(id), `${kind}: ${id}`).toBeDefined();
  });

  it('Option+Up and Option+Down move the chosen tasks in a project, and undo puts them back', async () => {
    const { app, catalog } = await makeApp();
    app.go({ type: 'project', id: 'inbox' });
    for (const t of ['A', 'B', 'C']) app.addTask(t, 'end');
    const titles = () => app.ids.value.map((id) => app.list.getTask(id)!.title);
    app.step(1);
    app.step(1);
    app.step(1);
    expect(catalog.forEvent(key('ArrowUp', { altKey: true }), 'list', 0, true)).toMatchObject({
      command: { id: 'task.moveUp' },
    });
    catalog.run('task.moveUp');
    expect(titles()).toEqual(['A', 'C', 'B']);
    catalog.run('task.moveDown');
    expect(titles()).toEqual(['A', 'B', 'C']);
    app.undo();
    expect(titles()).toEqual(['A', 'C', 'B']);
    // Option+arrows belong to a text field.
    expect(catalog.forEvent(key('ArrowUp', { altKey: true }), 'text', 0, true)).toBeNull();
    // Only where the order is yours.
    app.go({ type: 'today' });
    expect(catalog.isEnabled(catalog.get('task.moveUp')!)).toBe(false);
  });

  it("a sidebar project's menu acts on that project, not the one on screen", async () => {
    const { app, catalog } = await makeApp();
    const work = app.list.addProject('Work');
    app.go({ type: 'today' });
    expect(catalog.isEnabled(catalog.get('project.edit')!)).toBe(false);
    app.menu.value = { x: 0, y: 0, kind: 'project', target: { kind: 'project', id: work.id } };
    expect(catalog.isEnabled(catalog.get('project.edit')!)).toBe(true);
    catalog.run('project.edit');
    expect(app.dialog.value).toEqual({ kind: 'project', id: work.id });
    app.close();
    app.menu.value = { x: 0, y: 0, kind: 'project', target: { kind: 'project', id: work.id } };
    catalog.run('task.newIn');
    expect(app.shown.value).toEqual({ type: 'project', id: work.id });
    expect(app.composer.value).toBe('end');
  });
});
