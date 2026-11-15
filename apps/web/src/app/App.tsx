import { useEffect } from 'preact/hooks';
import type { CommandCatalog, KeyFocus } from '@taskite/ui';
import { ContextMenu } from './ContextMenu.tsx';
import type { AppController } from './controller.ts';
import { Dialogs } from './Dialogs.tsx';
import { Sidebar } from './Sidebar.tsx';
import { StatusBar } from './StatusBar.tsx';
import { TaskView } from './TaskView.tsx';

/** Where keyboard focus is, for deciding which keys are commands (PRD §8). */
export function keyFocus(el: Element | null): KeyFocus {
  if (!el || el === el.ownerDocument?.body) return 'list';
  if (el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return 'text';
  if (el.closest('[role=option]')) return 'list';
  // Add task, Add section and a section's ⋯ sit in the list but are buttons: Enter and Space press them.
  if (el.closest('button, a, [role=button]')) return 'control';
  if (el.closest('.tk-list')) return 'list';
  return 'control';
}

export function App({ app, catalog }: { readonly app: AppController; readonly catalog: CommandCatalog }) {
  const theme = app.theme.value;
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'auto') delete root.dataset.theme;
    else root.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const result = catalog.forEvent(e, keyFocus(document.activeElement));
      if (!result) return;
      if (result.kind === 'wait') {
        e.preventDefault();
        return;
      }
      // With a dialog open, only the keys that toggle their own window count.
      if (app.blocked() && !catalog.gate?.(result.command)) return;
      e.preventDefault();
      catalog.run(result.command.id);
    };
    addEventListener('keydown', onKey);
    // Midnight: Today, Upcoming and the due dates move on.
    const clock = setInterval(() => app.tick(), 30_000);
    const wake = () => app.tick();
    addEventListener('focus', wake);
    return () => {
      removeEventListener('keydown', onKey);
      removeEventListener('focus', wake);
      clearInterval(clock);
    };
  }, [app, catalog]);

  return (
    <div class="tk-app">
      <div class="tk-body">
        <Sidebar app={app} catalog={catalog} />
        <TaskView app={app} catalog={catalog} />
      </div>
      <StatusBar app={app} />
      <ContextMenu app={app} catalog={catalog} />
      <Dialogs app={app} catalog={catalog} />
    </div>
  );
}
