/** What the Keyboard Shortcuts window lists (PRD §8): every command with a key, plus keys that aren't commands. */
import { COMMAND_GROUPS, type CommandCatalog, type CommandGroup } from '@taskite/ui';

export interface ShortcutLine {
  readonly title: string;
  /** Each way to press it; a way is one or more keys pressed in turn (`G` then `I`). */
  readonly keys: readonly (readonly string[])[];
}

export interface ShortcutGroup {
  readonly title: string;
  readonly lines: readonly ShortcutLine[];
}

const GROUP_TITLES: Record<CommandGroup, string> = {
  File: 'Adding',
  Edit: 'Undo',
  Task: 'Tasks',
  Select: 'Choosing tasks',
  Go: 'Going places',
  View: 'View',
  Help: 'Help',
};

/** Keys handled outside the catalog: in the add-task row, in dialogs, by the mouse, and Escape everywhere. */
function extras(mod: string): Partial<Record<CommandGroup, ShortcutLine[]>> {
  return {
    File: [
      { title: 'Add the task and start the next', keys: [['Enter']] },
      { title: 'Stop adding (on an empty row)', keys: [['Enter'], ['Esc']] },
    ],
    Task: [
      { title: 'Task actions menu', keys: [['Shift', 'F10']] },
      { title: 'Save and close the task editor', keys: [[mod === '⌘' ? '⌘Enter' : 'Ctrl+Enter']] },
      { title: 'Save the name (renaming in the row)', keys: [['Enter']] },
      { title: 'Put the name back (renaming in the row)', keys: [['Esc']] },
    ],
    Select: [
      { title: 'Choose another task too', keys: [[`${mod}-click`]] },
      { title: 'Choose a range of tasks', keys: [['Shift-click']] },
    ],
    Help: [
      {
        title: 'Next / previous command in the command menu',
        keys: [['Down'], ['Up'], ['Tab'], ['Shift+Tab']],
      },
      { title: 'Close a window, stop adding, or clear the search', keys: [['Esc']] },
    ],
  };
}

export function shortcutGroups(catalog: CommandCatalog, mac: boolean): ShortcutGroup[] {
  const more = extras(mac ? '⌘' : 'Ctrl');
  return COMMAND_GROUPS.map((group) => {
    const lines: ShortcutLine[] = catalog.all
      .filter((c) => c.group === group && c.sequences.length > 0)
      .map((c) => ({
        title: c.title.replace(/…$/, ''),
        keys: c.sequences.map((_, i) => catalog.keys({ ...c, sequences: [c.sequences[i]!] }, mac)),
      }));
    return { title: GROUP_TITLES[group], lines: [...lines, ...(more[group] ?? [])] };
  }).filter((g) => g.lines.length > 0);
}
