/**
 * Every command in the app (PRD §8). The keyboard, ⌘K, the right-click menu, the menu bar, the Keyboard
 * Shortcuts window and docs/controls.md all come from this list.
 */
import { INBOX_ID, plural, type Priority } from '@taskite/core';
import { CommandCatalog, type CommandSpec, type MenuEntry } from '@taskite/ui';
import type { AppController } from './controller.ts';

/** The right-click menu on tasks: command ids in order, `|` between groups. */
export const TASK_MENU: readonly string[] = [
  'task.complete',
  'task.edit',
  'task.due',
  '|',
  'task.priority1',
  'task.priority2',
  'task.priority3',
  'task.priority4',
  '|',
  'task.move',
  '|',
  'task.restore',
  'task.delete',
  'task.purge',
];

const PRIORITY_NAMES: Record<Priority, string> = { 1: 'urgent', 2: 'high', 3: 'medium', 4: 'normal' };

export function buildCommands(app: AppController): CommandCatalog {
  const inTrash = () => app.shown.value.type === 'trash';
  const tasksChosen = () => app.hasTargets() && !inTrash();
  const trashChosen = () => app.hasTargets() && inTrash();

  const priority = (p: Priority): CommandSpec => ({
    id: `task.priority${p}`,
    title: `Priority ${p} (${PRIORITY_NAMES[p]})`,
    description: `Sets the chosen tasks to priority ${p}.`,
    group: 'Task',
    shortcuts: [String(p)],
    keywords: `p${p} flag`,
    enabled: tasksChosen,
    context: true,
    keysOnly: true,
    run: () => app.setPriority(app.targetIds(), p),
  });

  const go = (
    id: string,
    title: string,
    key: string,
    view: Parameters<AppController['go']>[0],
  ): CommandSpec => ({
    id,
    title,
    description: `Shows ${title.replace(/^Go to /, '')}.`,
    group: 'Go',
    shortcuts: [key],
    keysOnly: true,
    run: () => app.go(view),
  });

  const specs: CommandSpec[] = [
    // File
    {
      id: 'task.new',
      title: 'New Task',
      description: 'Opens the add-task row in this view (the Inbox from Completed, Trash or a search).',
      group: 'File',
      shortcuts: ['q', 'n', 'mod+n'],
      keywords: 'add create quick',
      global: true,
      run: () => app.newTask(),
    },
    {
      id: 'project.new',
      title: 'New Project…',
      description: 'Makes a project to group tasks.',
      group: 'File',
      keywords: 'add create list',
      run: () => app.open({ kind: 'project', id: null }),
    },
    {
      id: 'app.settings',
      title: 'Settings…',
      description: 'Opens Settings: the theme and where your tasks are kept.',
      group: 'File',
      shortcuts: ['mod+,'],
      keywords: 'preferences theme dark light',
      run: () => app.open({ kind: 'settings' }),
    },

    // Edit
    {
      id: 'edit.undo',
      title: 'Undo',
      description: 'Takes back the last change to your tasks.',
      group: 'Edit',
      shortcuts: ['mod+z'],
      enabled: () => {
        void app.rev.value;
        return app.list.canUndo;
      },
      run: () => app.undo(),
    },
    {
      id: 'edit.redo',
      title: 'Redo',
      description: 'Makes the change Undo took back.',
      group: 'Edit',
      shortcuts: ['mod+shift+z', 'mod+y'],
      enabled: () => {
        void app.rev.value;
        return app.list.canRedo;
      },
      run: () => app.redo(),
    },

    // Task
    {
      id: 'task.complete',
      title: 'Complete',
      description: 'Checks off the chosen tasks, or un-checks them when they are all done.',
      group: 'Task',
      shortcuts: ['space'],
      keywords: 'done finish check reopen undone',
      enabled: tasksChosen,
      context: true,
      keysOnly: true,
      run: () => app.toggleComplete(),
    },
    {
      id: 'task.edit',
      title: 'Edit Task…',
      description: 'Opens the chosen task: name, notes, date, repeat, priority, project, labels, subtasks.',
      group: 'Task',
      shortcuts: ['enter'],
      keywords: 'open details description subtasks labels',
      enabled: () => !!app.single() && !inTrash(),
      context: true,
      keysOnly: true,
      run: () => app.edit(),
    },
    {
      id: 'task.due',
      title: 'Due Date…',
      description: 'Sets or clears the due date of the chosen tasks.',
      group: 'Task',
      shortcuts: ['d'],
      keywords: 'schedule date deadline',
      enabled: tasksChosen,
      context: true,
      keysOnly: true,
      run: () => app.open({ kind: 'due', ids: app.targetIds() }),
    },
    priority(1),
    priority(2),
    priority(3),
    priority(4),
    {
      id: 'task.move',
      title: 'Move to Project…',
      description: 'Moves the chosen tasks to another project.',
      group: 'Task',
      shortcuts: ['m'],
      enabled: tasksChosen,
      context: true,
      keysOnly: true,
      run: () => app.open({ kind: 'move', ids: app.targetIds() }),
    },
    {
      id: 'task.delete',
      title: 'Move to Trash',
      description: 'Moves the chosen tasks to the Trash, where they stay 30 days.',
      group: 'Task',
      shortcuts: ['backspace', 'delete'],
      keywords: 'delete remove',
      enabled: tasksChosen,
      context: true,
      danger: true,
      keysOnly: true,
      run: () => app.trash(),
    },
    {
      id: 'task.restore',
      title: 'Restore',
      description: 'Takes the chosen tasks out of the Trash.',
      group: 'Task',
      shortcuts: ['r'],
      keywords: 'undelete trash',
      enabled: trashChosen,
      context: true,
      keysOnly: true,
      run: () => app.restore(),
    },
    {
      id: 'task.purge',
      title: 'Delete for Good…',
      description: 'Deletes the chosen tasks in the Trash for good.',
      group: 'Task',
      shortcuts: ['backspace', 'delete'],
      keywords: 'purge remove trash',
      enabled: trashChosen,
      context: true,
      danger: true,
      keysOnly: true,
      run: () => app.purge(),
    },
    {
      id: 'task.clearCompleted',
      title: 'Move Completed Tasks to Trash',
      description: 'Moves every checked-off task to the Trash.',
      group: 'Task',
      keywords: 'clear done',
      enabled: () => {
        void app.rev.value;
        return app.list.liveTasks().some((t) => t.completed);
      },
      run: () => app.clearCompleted(),
    },
    {
      id: 'trash.empty',
      title: 'Empty Trash…',
      description: 'Deletes everything in the Trash for good.',
      group: 'Task',
      danger: true,
      enabled: () => {
        void app.rev.value;
        return app.list.trashList().length > 0;
      },
      run: () => app.emptyTrash(),
    },
    {
      id: 'project.edit',
      title: 'Edit Project…',
      description: "Renames or recolours the project you're looking at.",
      group: 'Task',
      keywords: 'rename colour color',
      enabled: () => !!app.currentProject(),
      run: () => app.open({ kind: 'project', id: app.currentProject()?.id ?? null }),
    },
    {
      id: 'project.delete',
      title: 'Delete Project…',
      description: "Deletes the project you're looking at and moves its tasks to the Trash.",
      group: 'Task',
      danger: true,
      enabled: () => !!app.currentProject(),
      run: () => {
        const p = app.currentProject();
        if (p) app.deleteProject(p.id);
      },
    },
    {
      id: 'label.remove',
      title: 'Remove Label from All Tasks…',
      description: "Takes the label you're looking at off every task.",
      group: 'Task',
      danger: true,
      enabled: () => !!app.currentLabel(),
      run: () => {
        const l = app.currentLabel();
        if (l) app.removeLabel(l);
      },
    },

    // Select
    {
      id: 'select.next',
      title: 'Next Task',
      description: 'Moves to the next task.',
      group: 'Select',
      shortcuts: ['down', 'j'],
      keysOnly: true,
      hidden: true,
      run: () => app.step(1),
    },
    {
      id: 'select.prev',
      title: 'Previous Task',
      description: 'Moves to the previous task.',
      group: 'Select',
      shortcuts: ['up', 'k'],
      keysOnly: true,
      hidden: true,
      run: () => app.step(-1),
    },
    {
      id: 'select.extendDown',
      title: 'Choose Next Too',
      description: 'Adds the next task to the ones chosen.',
      group: 'Select',
      shortcuts: ['shift+down', 'shift+j'],
      keysOnly: true,
      hidden: true,
      run: () => app.step(1, true),
    },
    {
      id: 'select.extendUp',
      title: 'Choose Previous Too',
      description: 'Adds the previous task to the ones chosen.',
      group: 'Select',
      shortcuts: ['shift+up', 'shift+k'],
      keysOnly: true,
      hidden: true,
      run: () => app.step(-1, true),
    },
    {
      id: 'select.all',
      title: 'Choose All',
      description: 'Chooses every task in the view.',
      group: 'Select',
      shortcuts: ['mod+a'],
      keywords: 'select all',
      run: () => app.selectAll(),
    },
    {
      id: 'select.clear',
      title: 'Choose None',
      description: 'Unchooses every task.',
      group: 'Select',
      shortcuts: ['esc'],
      keysOnly: true,
      hidden: true,
      run: () => app.clearSelection(),
    },

    // Go
    go('go.inbox', 'Go to Inbox', 'g i', { type: 'project', id: INBOX_ID }),
    go('go.today', 'Go to Today', 'g t', { type: 'today' }),
    go('go.upcoming', 'Go to Upcoming', 'g u', { type: 'upcoming' }),
    go('go.completed', 'Go to Completed', 'g c', { type: 'completed' }),
    go('go.trash', 'Go to Trash', 'g x', { type: 'trash' }),
    {
      id: 'go.search',
      title: 'Search',
      description: 'Moves to the search box.',
      group: 'Go',
      shortcuts: ['/', 'mod+f'],
      keywords: 'find',
      global: true,
      run: () => {
        app.focusSearch.value++;
      },
    },

    // View
    ...(['auto', 'light', 'dark'] as const).map((theme): CommandSpec => ({
      id: `view.theme.${theme}`,
      title: theme === 'auto' ? 'Theme: System' : `Theme: ${theme === 'light' ? 'Light' : 'Dark'}`,
      description:
        theme === 'auto'
          ? 'Follows the light or dark setting of your computer.'
          : `Always uses the ${theme} look.`,
      group: 'View',
      keywords: 'appearance dark light mode',
      checked: () => app.theme.value === theme,
      run: () => app.setTheme(theme),
    })),

    // Help
    {
      id: 'help.commands',
      title: 'Command Menu',
      description: 'Searches every command, project and label.',
      group: 'Help',
      shortcuts: ['mod+k', 'mod+p'],
      keywords: 'palette run',
      global: true,
      hidden: true,
      run: () => app.toggle('commands'),
    },
    {
      id: 'help.shortcuts',
      title: 'Keyboard Shortcuts',
      description: 'Lists every key Taskite knows.',
      group: 'Help',
      shortcuts: ['mod+/', '?'],
      keywords: 'keys help',
      global: true,
      run: () => app.toggle('shortcuts'),
    },
    {
      id: 'help.docs',
      title: 'Taskite Help',
      description: 'Opens the guide to Taskite on the web.',
      group: 'Help',
      keywords: 'documentation manual guide',
      run: () => {
        window.open('https://github.com/gridlocdev/taskite/blob/main/docs/README.md', '_blank', 'noopener');
      },
    },
    {
      id: 'help.about',
      title: 'About Taskite',
      description: 'Shows the version and where your tasks are kept.',
      group: 'Help',
      keywords: 'version',
      run: () => app.open({ kind: 'about' }),
    },
  ];

  const catalog = new CommandCatalog(specs);
  // A dialog or a save conflict holds every command except the ones that toggle their own window.
  catalog.gate = (c) => !app.blocked() || c.id === 'help.commands' || c.id === 'help.shortcuts';
  return catalog;
}

/** A command-menu entry made on the fly: Go to a project or label, Move to a project. */
export interface DynamicEntry extends MenuEntry {
  readonly run: () => void;
}

/** What ⌘K offers besides commands (PRD §8). */
export function dynamicEntries(app: AppController): DynamicEntry[] {
  void app.rev.value;
  const list = app.list;
  const entries: DynamicEntry[] = [];
  for (const p of list.data.projects)
    entries.push({
      id: `go.project:${p.id}`,
      title: `Go to ${p.name}`,
      group: 'Go',
      keywords: 'project',
      run: () => app.go({ type: 'project', id: p.id }),
    });
  for (const name of list.getLabels())
    entries.push({
      id: `go.label:${name}`,
      title: `Go to @${name}`,
      group: 'Go',
      keywords: 'label tag',
      run: () => app.go({ type: 'label', name }),
    });
  const ids = app.shown.value.type === 'trash' ? [] : app.targetIds();
  if (ids.length)
    for (const p of list.data.projects)
      entries.push({
        id: `move.project:${p.id}`,
        title: `Move to ${p.name}`,
        group: 'Task',
        keywords: ids.length > 1 ? plural(ids.length, 'task') : 'task',
        run: () => app.moveTo(ids, p.id),
      });
  return entries;
}
