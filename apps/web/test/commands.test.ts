import { describe, expect, it } from 'vitest';
import { TASK_MENU, dynamicEntries } from '../src/app/commands.ts';
import { nativeMenu } from '../src/app/nativeMenu.ts';
import { shortcutGroups } from '../src/app/shortcuts.ts';
import { makeApp } from './helpers.ts';

const key = (k: string, more: Partial<KeyboardEvent> = {}) =>
  ({ key: k, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...more }) as KeyboardEvent;

describe('commands', () => {
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
    expect(catalog.forEvent(key('q'), 'text', 0, true)).toBeNull();
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
    expect(newTask?.keys).toEqual([['Q'], ['N'], ['⌘N']]);
  });
});
