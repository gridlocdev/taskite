/** The desktop menu bar, made from the command catalog (PRD §8). */
import { effect } from '@preact/signals';
import {
  COMMAND_GROUPS,
  toAccelerator,
  type Command,
  type CommandCatalog,
  type NativeMenuItem,
  type Shortcut,
} from '@taskite/ui';
import type { AppController } from './controller.ts';

/** Separators go before these ids. */
const BREAKS = new Set([
  'app.settings',
  'task.due',
  'task.priority1',
  'task.move',
  'task.delete',
  'task.clearCompleted',
  'project.edit',
  'help.docs',
]);

/** Cut, Copy and Paste are Electron roles, so text fields get real clipboard events. They follow Redo. */
const CLIPBOARD_AFTER = 'edit.redo';
const CLIPBOARD: readonly NativeMenuItem[] = [
  { type: 'separator' },
  { role: 'cut' },
  { role: 'copy' },
  { role: 'paste' },
];

/** Commands the menu bar leaves out: the browser-only ones and the ones Electron's own roles cover. */
const LEFT_OUT = new Set(['help.docs']);

/**
 * Only ⌘/Ctrl chords become accelerators. A plain key (Space, D, 1) as an accelerator would be taken from
 * every text field, so the page's own key handling keeps those; the menu still shows them in the title.
 */
function accelerator(s: Shortcut | undefined): string | undefined {
  return s && (s.mod || s.ctrl) ? toAccelerator(s) : undefined;
}

function item(catalog: CommandCatalog, c: Command): NativeMenuItem {
  const chord = c.sequences.find((s) => s.length === 1 && accelerator(s[0]));
  const accel = chord ? accelerator(chord[0]) : undefined;
  const keys = accel ? '' : catalog.keys(c, true).join(' ');
  return {
    label: keys ? `${c.title}\t${keys}` : c.title,
    command: c.id,
    enabled: catalog.isEnabled(c),
    ...(accel ? { accelerator: accel } : {}),
    ...(c.checked ? { type: 'checkbox' as const, checked: c.checked() } : {}),
  };
}

/** The menu bar: one menu per command group, in catalog order, with each command's current state. */
export function nativeMenu(catalog: CommandCatalog): NativeMenuItem[] {
  return COMMAND_GROUPS.map((group) => {
    const items: NativeMenuItem[] = [];
    for (const c of catalog.all) {
      if (c.group !== group || c.hidden || LEFT_OUT.has(c.id)) continue;
      if (BREAKS.has(c.id) && items.length > 0) items.push({ type: 'separator' });
      items.push(item(catalog, c));
      if (c.id === CLIPBOARD_AFTER) items.push(...CLIPBOARD);
    }
    return { label: group, submenu: items };
  }).filter((m) => 'submenu' in m && m.submenu && m.submenu.length > 0);
}

/** Sends the menu, skipping one identical to the last (Electron rebuilds the whole bar for each). */
export function menuSender(send: (menu: readonly NativeMenuItem[]) => void): {
  send(menu: readonly NativeMenuItem[]): boolean;
  forget(): void;
} {
  let last = '';
  return {
    send(menu) {
      const key = JSON.stringify(menu);
      if (key === last) return false;
      last = key;
      send(menu);
      return true;
    },
    forget() {
      last = '';
    },
  };
}

/** Calls `changed` (on the next tick, at most every `settleMs`) when anything a menu item reads may have moved. */
export function watchMenuInputs(app: AppController, changed: () => void, settleMs = 100): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = effect(() => {
    void app.rev.value;
    void app.shown.value;
    void app.selected.value;
    void app.cursor.value;
    void app.dialog.value;
    clearTimeout(timer);
    timer = setTimeout(changed, settleMs);
  });
  return () => {
    clearTimeout(timer);
    stop();
  };
}
