import { useEffect } from 'preact/hooks';
import { every, type CommandCatalog, type KeyFocus } from '@taskite/ui';
import { ContextMenu } from './ContextMenu.tsx';
import type { AppController } from './controller.ts';
import { Dialogs } from './Dialogs.tsx';
import { keyboardUp } from './keyboard.ts';
import { Sidebar } from './Sidebar.tsx';
import { onCopy } from './clipboard.ts';
import { StatusBar } from './StatusBar.tsx';
import { AddButton, TabBar } from './TabBar.tsx';
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
    const copy = (e: ClipboardEvent) => onCopy(app, e);
    addEventListener('copy', copy);
    // Midnight: Today, Upcoming and the due dates move on.
    const stopClock = every(30_000, () => app.tick());
    const wake = () => app.tick();
    addEventListener('focus', wake);
    return () => {
      removeEventListener('keydown', onKey);
      removeEventListener('copy', copy);
      removeEventListener('focus', wake);
      stopClock();
    };
  }, [app, catalog]);

  // On a phone (PRD §5.5) these pick what fills the screen: the Browse tab, or search results under the search box.
  const classes = ['tk-app'];
  if (app.browsing.value) classes.push('tk-browsing');
  if (app.search.value.trim()) classes.push('tk-searching');
  if (keyboardUp.value) classes.push('tk-keyboard');
  return (
    <div class={classes.join(' ')}>
      <div class="tk-body">
        <Sidebar app={app} catalog={catalog} />
        <TaskView app={app} catalog={catalog} />
      </div>
      <AddButton app={app} catalog={catalog} />
      <StatusBar app={app} />
      <TabBar app={app} catalog={catalog} />
      <ContextMenu app={app} catalog={catalog} />
      <Dialogs app={app} catalog={catalog} />
    </div>
  );
}
