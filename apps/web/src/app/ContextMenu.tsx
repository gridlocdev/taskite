import { batch } from '@preact/signals';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { plural } from '@taskite/core';
import { Icon, type CommandCatalog } from '@taskite/ui';
import { MENUS } from './commands.ts';
import type { AppController, ContextMenuState } from './controller.ts';
import { menuArrows } from './TaskView.tsx';
import { phone, touchScreen } from './touch.ts';

const ICONS: Record<string, string> = {
  'task.complete': 'check',
  'task.edit': 'edit',
  'task.due': 'calendar',
  'task.priority1': 'flag',
  'task.priority2': 'flag',
  'task.priority3': 'flag',
  'task.priority4': 'flag',
  'task.move': 'move',
  'task.moveUp': 'arrow-up',
  'task.moveDown': 'arrow-down',
  'task.prevSection': 'arrow-left',
  'task.nextSection': 'arrow-right',
  'section.add': 'plus',
  'section.addTask': 'plus',
  'section.rename': 'edit',
  'section.moveEarlier': 'arrow-up',
  'section.moveLater': 'arrow-down',
  'section.delete': 'trash',
  'project.board': 'board',
  'project.list': 'list',
  'task.new': 'plus',
  'task.newIn': 'plus',
  'project.new': 'plus',
  'project.edit': 'edit',
  'project.delete': 'trash',
  'select.all': 'check',
  'task.clearCompleted': 'done',
  'trash.empty': 'trash',
  'label.edit': 'edit',
  'label.remove': 'tag',
  'task.restore': 'restore',
  'task.delete': 'trash',
  'task.purge': 'trash',
};

/** A menu's enabled items, with no separator first, last or twice in a row. */
export function menuItems(app: AppController, catalog: CommandCatalog, state: ContextMenuState): string[] {
  // Enabled is read with this menu open, since sidebar menus' commands act on the menu's target.
  return batch(() => {
    const held = app.menu.peek();
    app.menu.value = state;
    const shown = MENUS[state.kind].filter((id) => id === '|' || catalog.isEnabled(catalog.get(id)!));
    app.menu.value = held;
    return shown.filter(
      (id, i) =>
        id !== '|' || (i > 0 && shown[i - 1] !== '|' && shown.slice(i + 1).some((next) => next !== '|')),
    );
  });
}

/**
 * Opens a right-click menu at the pointer (or at `at`, for the context-menu key). With nothing to offer it leaves the event alone, so a text field
 * or the browser still gets its own menu.
 */
export function openMenu(
  app: AppController,
  catalog: CommandCatalog,
  e: MouseEvent | KeyboardEvent,
  kind: ContextMenuState['kind'],
  target?: ContextMenuState['target'],
  at?: { readonly x: number; readonly y: number },
): void {
  const where = at ?? ('clientX' in e ? { x: e.clientX, y: e.clientY } : { x: 0, y: 0 });
  if (!showMenu(app, catalog, kind, target, where)) return;
  e.preventDefault();
  e.stopPropagation();
}

/** Opens a menu at a point (a long press, PRD §5.5), if it has anything to offer. Says whether it did. */
export function showMenu(
  app: AppController,
  catalog: CommandCatalog,
  kind: ContextMenuState['kind'],
  target: ContextMenuState['target'] | undefined,
  at: { readonly x: number; readonly y: number },
): boolean {
  const state: ContextMenuState = { ...at, kind, ...(target ? { target } : {}) };
  if (!menuItems(app, catalog, state).some((id) => id !== '|')) return false;
  app.menu.value = state;
  return true;
}

/** The right-click menus: catalog commands, so titles and keys match everywhere else (PRD §8). */
export function ContextMenu({
  app,
  catalog,
}: {
  readonly app: AppController;
  readonly catalog: CommandCatalog;
}) {
  const menu = app.menu.value;
  const ref = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const close = () => {
    app.menu.value = null;
    app.focusList.value++;
  };

  useEffect(() => {
    if (!menu) return;
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    addEventListener('pointerdown', away, true);
    addEventListener('blur', close);
    // A finger has no keyboard to drive the menu, and a focus ring on the first item would look chosen.
    if (!touchScreen.peek())
      ref.current?.querySelector<HTMLElement>('[role^=menuitem]:not([disabled])')?.focus();
    return () => {
      removeEventListener('pointerdown', away, true);
      removeEventListener('blur', close);
    };
  }, [menu]);

  // Keep it on screen: flip up or left when it would run off the window.
  useLayoutEffect(() => {
    if (!menu) return setAt(null);
    const w = ref.current?.offsetWidth ?? 240;
    const h = ref.current?.offsetHeight ?? 360;
    setAt({
      x: menu.x + w > innerWidth - 4 ? Math.max(4, menu.x - w) : menu.x,
      // Below the pointer, else above it, else as low as it fits (it is never taller than the window).
      y:
        menu.y + h <= innerHeight - 4
          ? menu.y
          : menu.y - h >= 4
            ? menu.y - h
            : Math.max(4, innerHeight - 4 - h),
    });
  }, [menu]);

  if (!menu) return null;
  // On a phone the menu is a sheet along the bottom of the screen, in reach of a thumb (PRD §5.5).
  const sheet = phone.value;
  const onTasks = menu.kind === 'task';
  const ids = onTasks ? app.targetIds() : [];
  const allDone = ids.length > 0 && ids.every((id) => app.list.getTask(id)?.completed);
  const items = menuItems(app, catalog, menu);
  return (
    <div
      ref={ref}
      class={`tk-menu tk-context-menu${sheet ? ' tk-sheet' : ''}`}
      role="menu"
      aria-label={onTasks ? 'Task actions' : 'Actions'}
      style={
        sheet
          ? undefined
          : {
              left: `${(at ?? menu).x}px`,
              top: `${(at ?? menu).y}px`,
              visibility: at ? 'visible' : 'hidden',
            }
      }
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          close();
        } else menuArrows(e);
      }}
    >
      {ids.length > 1 && <div class="tk-menu-header">{plural(ids.length, 'task')} chosen</div>}
      {items.map((id, i) => {
        if (id === '|') return <div key={`sep${i}`} class="tk-menu-sep" role="separator" />;
        const c = catalog.get(id)!;
        const title = id === 'task.complete' && allDone ? 'Mark Not Done' : c.title;
        const p = /^task\.priority(\d)$/.exec(id)?.[1];
        return (
          <button
            key={id}
            type="button"
            role="menuitem"
            class={`tk-menu-item${c.danger ? ' tk-danger' : ''}${p ? ` tk-p${p}` : ''}`}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => {
              // Run first: a sidebar menu's command reads its target from the open menu.
              catalog.run(id);
              app.menu.value = null;
              if (!app.dialog.value && app.composer.value === null) app.focusList.value++;
            }}
          >
            <Icon name={ICONS[id] ?? 'square'} />
            <span class="tk-menu-title">{title}</span>
            <span class="tk-menu-key">{catalog.keys(c).join(' ')}</span>
          </button>
        );
      })}
    </div>
  );
}
