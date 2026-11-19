import { useRef } from 'preact/hooks';
import { INBOX_ID, sameView, sidebarCounts, type SavedView } from '@taskite/core';
import { Icon, type CommandCatalog } from '@taskite/ui';
import type { AppController } from './controller.ts';
import { statusQuiet } from './StatusBar.tsx';

const TABS: readonly { readonly name: string; readonly icon: string; readonly view: SavedView }[] = [
  { name: 'Today', icon: 'today', view: { type: 'today' } },
  { name: 'Upcoming', icon: 'calendar', view: { type: 'upcoming' } },
  { name: 'Inbox', icon: 'inbox', view: { type: 'project', id: INBOX_ID } },
];

/**
 * The phone's bottom tab bar (PRD §5.5): Today, Upcoming, Inbox and Browse, which holds every other view and
 * search. The stylesheet shows it only at phone width.
 */
export function TabBar({ app }: { readonly app: AppController }) {
  void app.rev.value;
  const counts = sidebarCounts(app.list, app.today.value);
  const browsing = app.browsing.value || app.search.value.trim() !== '';
  const view = app.view.value;
  const on = TABS.find((t) => !browsing && sameView(t.view, view));
  const count = (tab: (typeof TABS)[number]) =>
    tab.view.type === 'today' ? counts.today : tab.view.type === 'project' ? counts.inbox : 0;
  return (
    <nav class="tk-tabbar" aria-label="Tabs">
      {TABS.map((tab) => (
        <button
          key={tab.name}
          type="button"
          class={`tk-tab${tab === on ? ' tk-active' : ''}`}
          aria-current={tab === on ? 'page' : undefined}
          onClick={() => app.go(tab.view)}
        >
          <span class="tk-tab-icon">
            <Icon name={tab.icon} />
            {count(tab) > 0 && <span class="tk-tab-count">{count(tab)}</span>}
          </span>
          {tab.name}
        </button>
      ))}
      <button
        type="button"
        class={`tk-tab${on ? '' : ' tk-active'}`}
        aria-current={on ? undefined : 'page'}
        onClick={() => app.browse()}
      >
        <span class="tk-tab-icon">
          <Icon name="browse" />
        </span>
        Browse
      </button>
    </nav>
  );
}

/**
 * The phone's floating Add button (PRD §5.5). iOS raises the keyboard only for a field focused in the tap
 * itself, and the add-task row appears a moment later, so the tap focuses a stand-in field first and the row
 * takes the keyboard over from it.
 */
export function AddButton({
  app,
  catalog,
}: {
  readonly app: AppController;
  readonly catalog: CommandCatalog;
}) {
  const proxy = useRef<HTMLInputElement>(null);
  return (
    <>
      {/* Stays in the page while the row opens, so the keyboard has somewhere to be. */}
      <input ref={proxy} class="tk-focus-proxy" aria-hidden="true" tabIndex={-1} />
      {app.composer.value === null && (
        <button
          type="button"
          // Lifted above the status bar while it shows a notice, so the button doesn't cover its action.
          class={`tk-fab${statusQuiet(app) ? '' : ' tk-lifted'}`}
          aria-label="Add task"
          onClick={() => {
            proxy.current?.focus({ preventScroll: true });
            catalog.run('task.new');
          }}
        >
          <Icon name="plus" />
        </button>
      )}
    </>
  );
}
