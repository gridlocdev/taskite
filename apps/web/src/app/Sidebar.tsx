import { useEffect, useRef, useState } from 'preact/hooks';
import { INBOX_ID, PROJECT_COLORS, sameView, sidebarCounts, type SavedView } from '@taskite/core';
import { Icon, type CommandCatalog } from '@taskite/ui';
import { openMenu } from './ContextMenu.tsx';
import type { AppController, ContextMenuState } from './controller.ts';
import { DRAG_TYPE } from './TaskView.tsx';

type DropKind = 'project' | 'today' | 'trash' | 'label';

export function Sidebar({ app, catalog }: { readonly app: AppController; readonly catalog: CommandCatalog }) {
  void app.rev.value;
  const counts = sidebarCounts(app.list, app.today.value);
  const current = app.search.value.trim() ? null : app.shown.value;
  const search = useRef<HTMLInputElement>(null);
  const focusSearch = app.focusSearch.value;
  useEffect(() => {
    if (focusSearch) search.current?.select();
  }, [focusSearch]);
  const labels = app.list.getLabels();
  const projects = app.list.data.projects.filter((p) => p.id !== INBOX_ID);

  const item = (
    view: SavedView,
    name: string,
    icon: string | null,
    count: number | null,
    drop: DropKind | null,
    color?: string,
  ) => (
    <NavItem
      key={JSON.stringify(view)}
      app={app}
      catalog={catalog}
      view={view}
      name={name}
      icon={icon}
      color={color}
      count={count}
      drop={drop}
      active={!!current && sameView(current, view)}
    />
  );

  return (
    <nav class="tk-sidebar" aria-label="Views">
      <div class="tk-sidebar-top">
        <span class="tk-app-name">Taskite</span>
        <button
          type="button"
          class="tk-icon-button"
          title={`Command menu (${catalog.keys(catalog.get('help.commands')!).join('')})`}
          aria-label="Command menu"
          onClick={() => catalog.run('help.commands')}
        >
          <Icon name="command" />
        </button>
        <button
          type="button"
          class="tk-icon-button"
          title={`Settings (${catalog.keys(catalog.get('app.settings')!).join('')})`}
          aria-label="Settings"
          onClick={() => catalog.run('app.settings')}
        >
          <Icon name="settings" />
        </button>
      </div>
      <div class="tk-search">
        <Icon name="search" />
        <input
          ref={search}
          id="tk-search"
          type="search"
          placeholder="Search"
          aria-label="Search tasks"
          value={app.search.value}
          onInput={(e) => app.setSearch((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              if (app.search.value) app.setSearch('');
              else app.focusList.value++;
            } else if ((e.key === 'ArrowDown' || e.key === 'Enter') && app.ids.value.length) {
              e.preventDefault();
              app.step(1);
              app.focusList.value++;
            }
          }}
        />
      </div>
      <div class="tk-sidebar-scroll">
        <button type="button" class="tk-nav tk-nav-add" onClick={() => catalog.run('task.new')}>
          <span class="tk-add-plus">
            <Icon name="plus" />
          </span>
          <span class="tk-nav-name">Add task</span>
        </button>
        <ul class="tk-nav-list">
          {item({ type: 'project', id: INBOX_ID }, 'Inbox', 'inbox', counts.inbox, 'project')}
          {item({ type: 'today' }, 'Today', 'today', counts.today, 'today')}
          {item({ type: 'upcoming' }, 'Upcoming', 'calendar', null, null)}
          {item({ type: 'completed' }, 'Completed', 'done', null, null)}
          {item({ type: 'trash' }, 'Trash', 'trash', counts.trash || null, 'trash')}
        </ul>
        <div class="tk-sidebar-heading" onContextMenu={(e) => openMenu(app, catalog, e, 'projects')}>
          <span>Projects</span>
          <button
            type="button"
            class="tk-icon-button"
            title="New project"
            aria-label="New project"
            onClick={() => catalog.run('project.new')}
          >
            <Icon name="plus" />
          </button>
        </div>
        <ul class="tk-nav-list">
          {projects.map((p) =>
            item(
              { type: 'project', id: p.id },
              p.name,
              null,
              counts.projects.get(p.id) ?? null,
              'project',
              PROJECT_COLORS[p.color],
            ),
          )}
        </ul>
        {labels.length > 0 && (
          <>
            <div class="tk-sidebar-heading">
              <span>Labels</span>
            </div>
            <ul class="tk-nav-list">
              {labels.map((l) =>
                item({ type: 'label', name: l }, l, 'tag', counts.labels.get(l) || null, 'label'),
              )}
            </ul>
          </>
        )}
      </div>
    </nav>
  );
}

/** The right-click menu of a sidebar item, if it has one (PRD §8). */
function navMenu(view: SavedView): Pick<ContextMenuState, 'kind' | 'target'> | null {
  switch (view.type) {
    case 'project':
      return { kind: 'project', target: { kind: 'project', id: view.id } };
    case 'label':
      return { kind: 'label', target: { kind: 'label', name: view.name } };
    case 'completed':
      return { kind: 'completed' };
    case 'trash':
      return { kind: 'trash' };
    default:
      return null;
  }
}

function NavItem(props: {
  readonly app: AppController;
  readonly catalog: CommandCatalog;
  readonly view: SavedView;
  readonly name: string;
  readonly icon: string | null;
  readonly color: string | undefined;
  readonly count: number | null;
  readonly drop: DropKind | null;
  readonly active: boolean;
}) {
  const { app, view } = props;
  const [over, setOver] = useState(false);
  const onDrop = (ids: string[]) => {
    if (view.type === 'project') app.moveTo(ids, view.id);
    else if (view.type === 'today') app.scheduleToday(ids);
    else if (view.type === 'trash') void app.trash(ids);
    else if (view.type === 'label') app.addLabel(ids, view.name);
  };
  return (
    <li>
      <button
        type="button"
        class={`tk-nav${props.active ? ' tk-active' : ''}${over ? ' tk-drop-target' : ''}`}
        aria-current={props.active ? 'page' : undefined}
        onClick={() => app.go(view)}
        onContextMenu={(e) => {
          const menu = navMenu(view);
          if (menu) openMenu(app, props.catalog, e, menu.kind, menu.target);
        }}
        onKeyDown={(e) => {
          const menu = navMenu(view);
          if (!menu || !(e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) return;
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          openMenu(app, props.catalog, e, menu.kind, menu.target, { x: r.left + 24, y: r.bottom });
        }}
        onDragOver={(e) => {
          if (!props.drop || !e.dataTransfer?.types.includes(DRAG_TYPE)) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          setOver(false);
          const data = e.dataTransfer?.getData(DRAG_TYPE);
          if (!props.drop || !data) return;
          e.preventDefault();
          onDrop(JSON.parse(data) as string[]);
        }}
      >
        {props.icon ? (
          <Icon name={props.icon} />
        ) : (
          <span class="tk-dot" style={{ background: props.color }} />
        )}
        <span class="tk-nav-name">{props.name}</span>
        {props.count !== null && props.count > 0 && <span class="tk-count">{props.count}</span>}
      </button>
    </li>
  );
}
