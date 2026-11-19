import { useRef } from 'preact/hooks';
import { INBOX_ID, sameView, sidebarCounts, type SavedView } from '@taskite/core';
import { Icon, type CommandCatalog } from '@taskite/ui';
import type { AppController } from './controller.ts';
import { showMenu } from './ContextMenu.tsx';
import { statusQuiet } from './StatusBar.tsx';
import { useTouch } from './touch.ts';

const TABS: readonly { readonly name: string; readonly icon: string; readonly view: SavedView }[] = [
  { name: 'Today', icon: 'today', view: { type: 'today' } },
  { name: 'Upcoming', icon: 'calendar', view: { type: 'upcoming' } },
  { name: 'Inbox', icon: 'inbox', view: { type: 'project', id: INBOX_ID } },
];

/**
 * The phone's bottom tab bar (PRD §5.5): Today, Upcoming, Inbox and Browse, which holds every other view and
 * search. A long press on the tab that's showing opens its view's menu, the same as the ⋯ at the top. The
 * stylesheet shows it only at phone width.
 */
export function TabBar({ app, catalog }: { readonly app: AppController; readonly catalog: CommandCatalog }) {
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
        <Tab
          key={tab.name}
          name={tab.name}
          icon={tab.icon}
          count={count(tab)}
          active={tab === on}
          onTap={() => app.go(tab.view)}
          onLongPress={tab === on ? (at) => showMenu(app, catalog, 'list', undefined, at) : undefined}
        />
      ))}
      <Tab name="Browse" icon="browse" count={0} active={!on} onTap={() => app.browse()} />
    </nav>
  );
}

function Tab(props: {
  readonly name: string;
  readonly icon: string;
  readonly count: number;
  readonly active: boolean;
  readonly onTap: () => void;
  readonly onLongPress?: ((at: { readonly x: number; readonly y: number }) => void) | undefined;
}) {
  const touch = useTouch(props.onLongPress ? { onLongPress: props.onLongPress } : {});
  return (
    <button
      type="button"
      class={`tk-tab${props.active ? ' tk-active' : ''}`}
      aria-current={props.active ? 'page' : undefined}
      {...touch.handlers}
      onContextMenu={(e) => e.preventDefault()}
      onClick={() => {
        if (!touch.swallowClick()) props.onTap();
      }}
    >
      <span class="tk-tab-icon">
        <Icon name={props.icon} />
        {props.count > 0 && <span class="tk-tab-count">{props.count}</span>}
      </span>
      {props.name}
    </button>
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
