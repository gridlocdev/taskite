import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { plural } from '@taskite/core';
import { Icon, type CommandCatalog } from '@taskite/ui';
import { TASK_MENU } from './commands.ts';
import type { AppController } from './controller.ts';
import { menuArrows } from './TaskView.tsx';

const ICONS: Record<string, string> = {
  'task.complete': 'check',
  'task.edit': 'edit',
  'task.due': 'calendar',
  'task.priority1': 'flag',
  'task.priority2': 'flag',
  'task.priority3': 'flag',
  'task.priority4': 'flag',
  'task.move': 'move',
  'task.restore': 'restore',
  'task.delete': 'trash',
  'task.purge': 'trash',
};

/** The right-click menu on tasks: catalog commands, so titles and keys match everywhere else. */
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
      y: menu.y + h > innerHeight - 4 ? Math.max(4, menu.y - h) : menu.y,
    });
  }, [menu]);

  if (!menu) return null;
  const ids = app.targetIds();
  const allDone = ids.length > 0 && ids.every((id) => app.list.getTask(id)?.completed);
  const shown = TASK_MENU.filter((id) => id === '|' || catalog.isEnabled(catalog.get(id)!));
  // No separator first, last or twice in a row.
  const items = shown.filter(
    (id, i) => id !== '|' || (i > 0 && i < shown.length - 1 && shown[i - 1] !== '|'),
  );
  return (
    <div
      ref={ref}
      class="tk-menu tk-context-menu"
      role="menu"
      aria-label="Task actions"
      style={{
        left: `${(at ?? menu).x}px`,
        top: `${(at ?? menu).y}px`,
        visibility: at ? 'visible' : 'hidden',
      }}
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
              close();
              catalog.run(id);
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
