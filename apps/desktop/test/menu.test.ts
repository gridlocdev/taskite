import { describe, expect, it } from 'vitest';
import { editMenuTemplate, toTemplate, withStandardMenus } from '../src/menu.ts';

const page = [
  { label: 'File', submenu: [{ label: 'New Task', command: 'task.new', accelerator: 'CmdOrCtrl+N' }] },
  {
    label: 'View',
    submenu: [{ label: 'Theme: Dark', command: 'view.theme.dark', type: 'checkbox' as const, checked: true }],
  },
  { label: 'Help', submenu: [{ label: 'About Taskite', command: 'help.about', enabled: false }] },
];

describe('menu', () => {
  it('turns the page menus into a template whose items send their command', () => {
    const sent: string[] = [];
    const [file, view, help] = toTemplate(page, (id) => sent.push(id));
    const newTask = (file?.submenu as Electron.MenuItemConstructorOptions[])[0]!;
    expect(newTask).toMatchObject({ label: 'New Task', accelerator: 'CmdOrCtrl+N', enabled: true });
    newTask.click?.({} as never, undefined, {} as never);
    expect(sent).toEqual(['task.new']);
    expect((view?.submenu as unknown[])[0]).toMatchObject({ type: 'checkbox', checked: true });
    expect((help?.submenu as unknown[])[0]).toMatchObject({ enabled: false });
  });

  it('adds the app menu and Window menu on macOS', () => {
    const menus = withStandardMenus(
      toTemplate(page, () => undefined),
      'darwin',
    );
    expect(menus.map((m) => m.role ?? m.label)).toEqual(['appMenu', 'File', 'View', 'windowMenu', 'Help']);
    const file = menus[1]?.submenu as unknown[];
    expect(file).toHaveLength(1);
  });

  it('puts Quit in File and a plain Window menu elsewhere', () => {
    const menus = withStandardMenus(
      toTemplate(page, () => undefined),
      'win32',
    );
    expect(menus.map((m) => m.role ?? m.label)).toEqual(['File', 'View', 'Window', 'Help']);
    expect((menus[0]?.submenu as { role?: string }[]).at(-1)).toEqual({ role: 'quit' });
  });

  it('adds zoom and full screen to View, and developer tools only in development', () => {
    const roles = (dev: boolean) =>
      (
        withStandardMenus(
          toTemplate(page, () => undefined),
          'darwin',
          dev,
        )[2]?.submenu as { role?: string }[]
      )
        .map((i) => i.role)
        .filter(Boolean);
    expect(roles(false)).toEqual(['resetZoom', 'zoomIn', 'zoomOut', 'togglefullscreen']);
    expect(roles(true)).toContain('toggleDevTools');
  });
});

describe('editMenuTemplate', () => {
  const flags = { canCut: true, canCopy: true, canPaste: true, canSelectAll: true };
  const base = {
    isEditable: true,
    selectionText: '',
    misspelledWord: '',
    dictionarySuggestions: [],
    editFlags: flags,
  };
  const noop = { replace: () => undefined, learn: () => undefined };

  it('gives a text field the edit roles', () => {
    const roles = editMenuTemplate(base, noop)!.map((i) => i.role ?? i.type);
    expect(roles).toEqual(['cut', 'copy', 'paste', 'separator', 'selectAll']);
  });

  it('puts spelling suggestions first and replaces the word with the chosen one', () => {
    const fixed: string[] = [];
    const t = editMenuTemplate(
      { ...base, misspelledWord: 'mlik', dictionarySuggestions: ['milk', 'mink'] },
      { replace: (w) => fixed.push(w), learn: () => undefined },
    )!;
    expect(t.slice(0, 3).map((i) => i.label)).toEqual(['milk', 'mink', 'Learn Spelling']);
    t[0]!.click?.({} as never, undefined, {} as never);
    expect(fixed).toEqual(['milk']);
  });

  it('offers Copy for selected page text and nothing elsewhere', () => {
    expect(editMenuTemplate({ ...base, isEditable: false, selectionText: 'Buy milk' }, noop)).toEqual([
      { role: 'copy', enabled: true },
    ]);
    expect(editMenuTemplate({ ...base, isEditable: false }, noop)).toBeNull();
  });
});
