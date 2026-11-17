/**
 * Every command in the app (PRD §8). The keyboard, ⌘K, the right-click menu, the menu bar, the Keyboard
 * Shortcuts window and docs/controls.md all come from this list.
 */
import { INBOX_ID, plural, type Priority } from '@taskite/core';
import { CommandCatalog, type CommandSpec, type MenuEntry } from '@taskite/ui';
import type { AppController, MenuKind } from './controller.ts';

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
  'task.moveUp',
  'task.moveDown',
  'task.prevSection',
  'task.nextSection',
  '|',
  'task.restore',
  'task.delete',
  'task.purge',
];

/**
 * Every right-click menu (PRD §8): command ids in order, `|` between groups. A menu shows only its enabled
 * commands, and doesn't open when none are.
 */
export const MENUS: Readonly<Record<MenuKind, readonly string[]>> = {
  task: TASK_MENU,
  // The empty part of the list: the same actions as the view's ⋯ button, plus adding and choosing.
  list: [
    'task.new',
    'select.all',
    '|',
    'section.add',
    'project.board',
    'project.list',
    '|',
    'project.edit',
    'task.clearCompleted',
    'trash.empty',
    '|',
    'project.delete',
    'label.edit',
    'label.remove',
  ],
  project: ['task.newIn', '|', 'project.edit', '|', 'project.delete'],
  label: ['label.edit', '|', 'label.remove'],
  section: [
    'section.addTask',
    'section.add',
    '|',
    'section.rename',
    'section.automations',
    'section.moveEarlier',
    'section.moveLater',
    '|',
    'section.delete',
  ],
  completed: ['task.clearCompleted'],
  trash: ['trash.empty'],
  projects: ['project.new'],
};

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
    keywords: `p${p} flag importance urgency`,
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
    keywords?: string,
  ): CommandSpec => ({
    id,
    title,
    ...(keywords ? { keywords } : {}),
    description: `Shows ${title.replace(/^Go to /, '')}.`,
    group: 'Go',
    shortcuts: [key],
    keysOnly: true,
    run: () => {
      app.go(view);
      // The keyboard goes with it, as Go to Section… does: not left on the sidebar or a row that's gone.
      app.focusList.value++;
    },
  });

  const specs: CommandSpec[] = [
    // File
    {
      id: 'task.new',
      title: 'New Task',
      keywords: 'add create quick capture todo item',
      description: 'Opens the add-task row in this view (the Inbox from Completed, Trash or a search).',
      group: 'File',
      shortcuts: ['mod+n', 'n'],
      global: true,
      run: () => app.newTask(),
    },
    {
      id: 'task.newIn',
      title: 'Add Task Here',
      keywords: 'new create quick todo item',
      description: 'Opens the project you right-clicked with its add-task row ready.',
      group: 'File',
      hidden: true,
      enabled: () => app.menu.value?.target?.kind === 'project',
      run: () => {
        const target = app.menu.value?.target;
        if (target?.kind !== 'project') return;
        app.go({ type: 'project', id: target.id });
        app.newTask();
      },
    },
    {
      id: 'project.new',
      title: 'New Project…',
      keywords: 'add create list folder area',
      description: 'Makes a project to group tasks.',
      group: 'File',
      shortcuts: ['mod+shift+n'],
      global: true,
      run: () => app.open({ kind: 'project', id: null }),
    },
    {
      id: 'app.settings',
      title: 'Settings…',
      keywords: 'preferences options config prefs theme dark light appearance',
      description: 'Opens Settings: the theme and where your tasks are kept.',
      group: 'File',
      shortcuts: ['mod+,'],
      run: () => app.open({ kind: 'settings' }),
    },

    // Edit
    {
      id: 'edit.undo',
      title: 'Undo',
      keywords: 'revert back oops',
      description: 'Takes back the last change to your tasks.',
      group: 'Edit',
      shortcuts: ['mod+z'],
      enabled: () => {
        void app.rev.value;
        return app.canUndo();
      },
      run: () => app.undo(),
    },
    {
      id: 'edit.redo',
      title: 'Redo',
      keywords: 'again repeat forward',
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
      keywords: 'done finish check tick close mark reopen undone incomplete uncheck',
      description: 'Checks off the chosen tasks, or un-checks them when they are all done.',
      group: 'Task',
      shortcuts: ['space'],
      enabled: tasksChosen,
      context: true,
      keysOnly: true,
      run: () => app.toggleComplete(),
    },
    {
      id: 'task.edit',
      title: 'Edit Task…',
      keywords: 'open details change modify rename description notes subtasks labels tags repeat recurring',
      description: 'Opens the chosen task: name, notes, date, repeat, priority, project, labels, subtasks.',
      group: 'Task',
      shortcuts: ['enter'],
      enabled: () => !!app.single() && !inTrash(),
      context: true,
      keysOnly: true,
      run: () => app.edit(),
    },
    {
      id: 'task.due',
      title: 'Due Date…',
      keywords: 'schedule deadline when today tomorrow reminder',
      description: 'Sets or clears the due date of the chosen tasks.',
      group: 'Task',
      shortcuts: ['d'],
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
      keywords: 'send file list folder assign',
      description: 'Moves the chosen tasks to another project.',
      group: 'Task',
      shortcuts: ['m'],
      enabled: tasksChosen,
      context: true,
      keysOnly: true,
      run: () => app.open({ kind: 'move', ids: app.targetIds() }),
    },
    {
      id: 'task.moveUp',
      title: 'Move Up',
      keywords: 'reorder sort arrange order shift raise earlier',
      description: 'Moves the chosen tasks one place up in the project.',
      group: 'Task',
      shortcuts: ['alt+up'],
      enabled: () => app.canMove(),
      context: true,
      run: () => app.moveChosen(-1),
    },
    {
      id: 'task.moveDown',
      title: 'Move Down',
      keywords: 'reorder sort arrange order shift lower later',
      description: 'Moves the chosen tasks one place down in the project.',
      group: 'Task',
      shortcuts: ['alt+down'],
      enabled: () => app.canMove(),
      context: true,
      run: () => app.moveChosen(1),
    },
    {
      id: 'task.prevSection',
      title: 'Move to Previous Section',
      keywords: 'column board left back',
      description: 'Moves the chosen tasks to the end of the section before theirs.',
      group: 'Task',
      shortcuts: ['alt+left'],
      enabled: () => app.canMoveSection(),
      context: true,
      run: () => app.moveChosenSection(-1),
    },
    {
      id: 'task.nextSection',
      title: 'Move to Next Section',
      keywords: 'column board right forward',
      description: 'Moves the chosen tasks to the end of the section after theirs.',
      group: 'Task',
      shortcuts: ['alt+right'],
      enabled: () => app.canMoveSection(),
      context: true,
      run: () => app.moveChosenSection(1),
    },
    {
      id: 'task.delete',
      title: 'Move to Trash',
      keywords: 'delete remove erase bin discard',
      description: 'Moves the chosen tasks to the Trash, where they stay 30 days.',
      group: 'Task',
      shortcuts: ['backspace', 'delete'],
      enabled: tasksChosen,
      context: true,
      danger: true,
      keysOnly: true,
      run: () => app.trash(),
    },
    {
      id: 'task.restore',
      title: 'Restore',
      keywords: 'undelete recover bring back untrash',
      description: 'Takes the chosen tasks out of the Trash.',
      group: 'Task',
      shortcuts: ['r'],
      enabled: trashChosen,
      context: true,
      keysOnly: true,
      run: () => app.restore(),
    },
    {
      id: 'task.purge',
      title: 'Delete for Good…',
      keywords: 'purge erase permanently forever destroy',
      description: 'Deletes the chosen tasks in the Trash for good.',
      group: 'Task',
      shortcuts: ['backspace', 'delete'],
      enabled: trashChosen,
      context: true,
      danger: true,
      keysOnly: true,
      run: () => app.purge(),
    },
    {
      id: 'task.clearCompleted',
      title: 'Move Completed Tasks to Trash',
      keywords: 'clear clean tidy archive done finished',
      description: 'Moves every checked-off task to the Trash.',
      group: 'Task',
      enabled: () => {
        void app.rev.value;
        return app.list.liveTasks().some((t) => t.completed);
      },
      run: () => app.clearCompleted(),
    },
    {
      id: 'trash.empty',
      title: 'Empty Trash…',
      keywords: 'purge clear bin erase permanently',
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
      keywords: 'rename change colour color',
      description: "Renames or recolours the project you're looking at (or right-clicked).",
      group: 'Task',
      enabled: () => !!app.projectTarget(),
      run: () => app.open({ kind: 'project', id: app.projectTarget()?.id ?? null }),
    },
    {
      id: 'project.delete',
      title: 'Delete Project…',
      keywords: 'remove erase trash list',
      description:
        "Deletes the project you're looking at (or right-clicked) and moves its tasks to the Trash.",
      group: 'Task',
      danger: true,
      enabled: () => !!app.projectTarget(),
      run: () => {
        const p = app.projectTarget();
        if (p) app.deleteProject(p.id);
      },
    },
    {
      id: 'section.add',
      title: 'Add Section…',
      keywords: 'new group heading column divider',
      description: 'Adds a named section to the project on screen (after the one right-clicked).',
      group: 'Task',
      enabled: () => !!app.shownProject(),
      run: () => {
        const p = app.shownProject();
        if (p)
          app.open({ kind: 'section', projectId: p.id, id: null, after: app.sectionTarget()?.section.id });
      },
    },
    {
      id: 'section.addTask',
      title: 'Add Task Here',
      keywords: 'new create section',
      description: 'Opens the add-task row at the end of the section right-clicked.',
      group: 'Task',
      enabled: () => !!app.sectionTarget(),
      run: () => {
        const t = app.sectionTarget();
        if (t) app.composer.value = `section:${t.section.id}`;
      },
    },
    {
      id: 'section.rename',
      title: 'Rename Section…',
      keywords: 'edit name change',
      description: 'Renames the section right-clicked.',
      group: 'Task',
      enabled: () => !!app.sectionTarget(),
      run: () => {
        const t = app.sectionTarget();
        if (t) app.open({ kind: 'section', projectId: t.projectId, id: t.section.id });
      },
    },
    {
      id: 'section.automations',
      title: 'Section Automations…',
      keywords: 'rules automate when then trigger workflow',
      description:
        'Edits the rules that change a task when it enters the section, or is completed there (the section right-clicked, else the one the cursor is in).',
      group: 'Task',
      enabled: () => !!app.automationTarget(),
      run: () => {
        const t = app.automationTarget();
        if (t) app.open({ kind: 'automations', projectId: t.projectId, sectionId: t.section.id });
      },
    },
    ...([-1, 1] as const).map((by): CommandSpec => ({
      id: by < 0 ? 'section.moveEarlier' : 'section.moveLater',
      title: by < 0 ? 'Move Section Earlier' : 'Move Section Later',
      keywords: 'arrange reposition column left right up down',
      description: `Moves the section right-clicked one place ${by < 0 ? 'earlier' : 'later'}.`,
      group: 'Task',
      enabled: () => {
        const t = app.sectionTarget();
        if (!t) return false;
        const all = app.list.getProject(t.projectId)?.sections ?? [];
        const at = all.findIndex((x) => x.id === t.section.id) + by;
        return at >= 0 && at < all.length;
      },
      run: () => {
        const t = app.sectionTarget();
        if (t) app.list.moveSection(t.projectId, t.section.id, by);
      },
    })),
    {
      id: 'section.delete',
      title: 'Delete Section…',
      keywords: 'remove erase trash',
      description: 'Deletes the section right-clicked and moves its tasks to the Trash.',
      group: 'Task',
      danger: true,
      enabled: () => !!app.sectionTarget(),
      run: () => {
        const t = app.sectionTarget();
        if (t) app.deleteSection(t.projectId, t.section.id);
      },
    },
    {
      id: 'project.board',
      title: 'View as Board',
      keywords: 'kanban columns sections layout',
      description: 'Shows the project on screen as a board, one column per section.',
      group: 'View',
      enabled: () => {
        void app.rev.value;
        const p = app.shownProject();
        return !!p && p.view !== 'board';
      },
      run: () => app.setBoard(true),
    },
    {
      id: 'project.list',
      title: 'View as List',
      keywords: 'rows layout sections',
      description: 'Shows the project on screen as a list again.',
      group: 'View',
      enabled: () => {
        void app.rev.value;
        return app.shownProject()?.view === 'board';
      },
      run: () => app.setBoard(false),
    },
    {
      id: 'label.edit',
      title: 'Edit Label…',
      keywords: 'rename change colour color tag',
      description: "Renames or recolours the label you're looking at (or right-clicked).",
      group: 'Task',
      enabled: () => !!app.labelTarget(),
      run: () => {
        const l = app.labelTarget();
        if (l) app.open({ kind: 'label', name: l });
      },
    },
    {
      id: 'label.remove',
      title: 'Remove Label from All Tasks…',
      keywords: 'delete clear erase tag untag',
      description: "Takes the label you're looking at (or right-clicked) off every task.",
      group: 'Task',
      danger: true,
      enabled: () => !!app.labelTarget(),
      run: () => {
        const l = app.labelTarget();
        if (l) app.removeLabel(l);
      },
    },

    // Select
    {
      id: 'select.next',
      title: 'Next Task',
      keywords: 'down below cursor',
      description: 'Moves to the next task, or the Add task button after a section.',
      group: 'Select',
      shortcuts: ['down', 'j'],
      keysOnly: true,
      hidden: true,
      run: () => app.step(1),
    },
    {
      id: 'select.prev',
      title: 'Previous Task',
      keywords: 'up above cursor prev',
      description: 'Moves to the previous task, or the Add task button after a section.',
      group: 'Select',
      shortcuts: ['up', 'k'],
      keysOnly: true,
      hidden: true,
      run: () => app.step(-1),
    },
    {
      id: 'select.nextSection',
      title: 'Next Section',
      keywords: 'jump skip heading group down',
      description:
        'Moves to the first task of the next section in a list, or its Add task button when it is empty.',
      group: 'Select',
      shortcuts: ['shift+alt+down'],
      keysOnly: true,
      enabled: () => app.canJumpSection(1, false),
      run: () => app.jumpSection(1),
    },
    {
      id: 'select.prevSection',
      title: 'Previous Section',
      keywords: 'jump skip heading group up',
      description:
        'Moves to the first task of the previous section in a list, or its Add task button when it is empty.',
      group: 'Select',
      shortcuts: ['shift+alt+up'],
      keysOnly: true,
      enabled: () => app.canJumpSection(-1, false),
      run: () => app.jumpSection(-1),
    },
    {
      id: 'select.nextColumn',
      title: 'Next Column',
      keywords: 'jump board kanban section right',
      description:
        'Moves to the first task of the next column on a board, or its Add task button when it is empty.',
      group: 'Select',
      shortcuts: ['shift+alt+right'],
      keysOnly: true,
      enabled: () => app.canJumpSection(1, true),
      run: () => app.jumpSection(1),
    },
    {
      id: 'select.prevColumn',
      title: 'Previous Column',
      keywords: 'jump board kanban section left',
      description:
        'Moves to the first task of the previous column on a board, or its Add task button when it is empty.',
      group: 'Select',
      shortcuts: ['shift+alt+left'],
      keysOnly: true,
      enabled: () => app.canJumpSection(-1, true),
      run: () => app.jumpSection(-1),
    },
    {
      id: 'select.columnRight',
      title: 'Task to the Right',
      keywords: 'board kanban column section beside',
      description: 'Moves to the task or Add task button level with this one in the next column on a board.',
      group: 'Select',
      shortcuts: ['right'],
      keysOnly: true,
      enabled: () => app.canJumpSection(1, true),
      run: () => app.jumpSection(1, (ids) => nearestRow(app.cursor.value, ids)),
    },
    {
      id: 'select.columnLeft',
      title: 'Task to the Left',
      keywords: 'board kanban column section beside',
      description:
        'Moves to the task or Add task button level with this one in the previous column on a board.',
      group: 'Select',
      shortcuts: ['left'],
      keysOnly: true,
      enabled: () => app.canJumpSection(-1, true),
      run: () => app.jumpSection(-1, (ids) => nearestRow(app.cursor.value, ids)),
    },
    {
      id: 'select.extendDown',
      title: 'Choose Next Too',
      keywords: 'select extend shift down range multiple',
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
      keywords: 'select extend shift up range multiple',
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
      keywords: 'select every everything',
      description: 'Chooses every task in the view.',
      group: 'Select',
      shortcuts: ['mod+a'],
      run: () => app.selectAll(),
    },
    {
      id: 'select.clear',
      title: 'Choose None',
      keywords: 'deselect unselect clear selection',
      description: 'Unchooses every task.',
      group: 'Select',
      shortcuts: ['esc'],
      keysOnly: true,
      hidden: true,
      run: () => app.clearSelection(),
    },

    // Go
    go('go.inbox', 'Go to Inbox', 'g i', { type: 'project', id: INBOX_ID }, 'open show view unsorted'),
    go('go.today', 'Go to Today', 'g t', { type: 'today' }, 'open show view due overdue now'),
    go(
      'go.upcoming',
      'Go to Upcoming',
      'g u',
      { type: 'upcoming' },
      'open show view week future soon calendar scheduled',
    ),
    go(
      'go.completed',
      'Go to Completed',
      'g c',
      { type: 'completed' },
      'open show view done finished history logbook',
    ),
    go('go.trash', 'Go to Trash', 'g x', { type: 'trash' }, 'open show view deleted bin'),
    {
      id: 'go.section',
      title: 'Go to Section…',
      keywords: 'jump heading column group board find',
      description: 'Moves to a section of this view by name.',
      group: 'Go',
      shortcuts: ['g s'],
      keysOnly: true,
      enabled: () => app.namedSections().length > 0,
      run: () => app.open({ kind: 'sections' }),
    },
    {
      id: 'go.search',
      title: 'Search',
      keywords: 'find filter look lookup query',
      description: 'Moves to the search box.',
      group: 'Go',
      shortcuts: ['/', 'mod+f'],
      global: true,
      run: () => {
        app.focusSearch.value++;
      },
    },

    // View
    {
      id: 'view.showCompleted',
      title: 'Show Completed Tasks',
      keywords: 'done finished checked hide reveal toggle',
      description:
        'Lists checked-off tasks in every view, after the open ones. Choose it again to hide them.',
      group: 'View',
      enabled: () => app.canShowCompleted(),
      checked: () => app.showCompleted.value,
      run: () => app.toggleShowCompleted(),
    },
    ...(['auto', 'light', 'dark'] as const).map((theme): CommandSpec => ({
      id: `view.theme.${theme}`,
      title: theme === 'auto' ? 'Theme: System' : `Theme: ${theme === 'light' ? 'Light' : 'Dark'}`,
      description:
        theme === 'auto'
          ? 'Follows the light or dark setting of your computer.'
          : `Always uses the ${theme} look.`,
      group: 'View',
      keywords: 'appearance colour color scheme mode',
      checked: () => app.theme.value === theme,
      run: () => app.setTheme(theme),
    })),

    // Help
    {
      id: 'help.commands',
      title: 'Command Menu',
      keywords: 'palette run actions commands',
      description: 'Searches every command, project and label.',
      group: 'Help',
      shortcuts: ['mod+k', 'mod+p'],
      global: true,
      hidden: true,
      run: () => app.toggle('commands'),
    },
    {
      id: 'help.shortcuts',
      title: 'Keyboard Shortcuts',
      keywords: 'keys hotkeys bindings cheat sheet help',
      description: 'Lists every key Taskite knows.',
      group: 'Help',
      shortcuts: ['mod+/', '?'],
      global: true,
      run: () => app.toggle('shortcuts'),
    },
    {
      id: 'help.docs',
      title: 'Taskite Help',
      keywords: 'documentation docs manual guide',
      description: 'Opens the guide to Taskite on the web.',
      group: 'Help',
      run: () => {
        window.open('https://github.com/gridlocdev/taskite/blob/main/docs/README.md', '_blank', 'noopener');
      },
    },
    {
      id: 'help.about',
      title: 'About Taskite',
      keywords: 'version info licence license credits',
      description: 'Shows the version and where your tasks are kept.',
      group: 'Help',
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
      keywords: 'project open show view list',
      run: () => app.go({ type: 'project', id: p.id }),
    });
  for (const name of list.getLabels())
    entries.push({
      id: `go.label:${name}`,
      title: `Go to @${name}`,
      group: 'Go',
      keywords: 'label tag open show view filter',
      run: () => app.go({ type: 'label', name }),
    });
  for (const s of app.namedSections())
    entries.push({
      id: `go.section:${s.key}`,
      title: `Go to Section: ${s.heading}`,
      group: 'Go',
      keywords: 'jump heading column group board',
      run: () => app.goToSection(s.key),
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

/** Of `ids`, the row whose middle is level with the middle of the `from` row on screen. */
function nearestRow(from: string | null, ids: readonly string[]): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const middle = (id: string) => {
    const box = document.querySelector(`[data-id="${CSS.escape(id)}"]`)?.getBoundingClientRect();
    return box ? box.top + box.height / 2 : undefined;
  };
  const y = from === null ? undefined : middle(from);
  if (y === undefined) return undefined;
  return closestTo(
    y,
    ids.map((id) => ({ id, y: middle(id) })),
  );
}

/** The id whose `y` is closest to `y` (the first on a tie), ignoring ones with no `y`. */
export function closestTo(
  y: number,
  rows: readonly { readonly id: string; readonly y: number | undefined }[],
): string | undefined {
  let best: string | undefined;
  let gap = Infinity;
  for (const r of rows)
    if (r.y !== undefined && Math.abs(r.y - y) < gap) {
      best = r.id;
      gap = Math.abs(r.y - y);
    }
  return best;
}
