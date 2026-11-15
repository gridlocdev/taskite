import { useEffect, useRef, useState } from 'preact/hooks';
import {
  PROJECT_COLORS,
  RECURRENCE_LABELS,
  dueTone,
  formatDue,
  resolveDraft,
  trashAge,
  type Row,
  type Section,
} from '@taskite/core';
import { Icon, isComposingKey, type CommandCatalog } from '@taskite/ui';
import type { AppController } from './controller.ts';
import { openMenu } from './ContextMenu.tsx';
import { dropOrder } from './forms.ts';

/** A coloured label's text colour (PRD §4.7); none for a plain label. */
function labelStyle(app: AppController, label: string) {
  const color = app.list.labelColor(label);
  return color ? { color: PROJECT_COLORS[color] } : undefined;
}

/** The drag payload type: the dragged task ids as JSON. */
export const DRAG_TYPE = 'application/x-taskite-tasks';

export function TaskView({
  app,
  catalog,
}: {
  readonly app: AppController;
  readonly catalog: CommandCatalog;
}) {
  const content = app.content.value;
  const listRef = useRef<HTMLDivElement>(null);
  const focusTick = app.focusList.value;
  const cursor = app.cursor.value;

  // Keyboard focus follows the cursor while it's in the list, and comes back after a dialog closes.
  const lastTick = useRef(focusTick);
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const asked = lastTick.current !== focusTick;
    lastTick.current = focusTick;
    if (!asked && !list.contains(document.activeElement)) return;
    const row = cursor ? list.querySelector<HTMLElement>(`[data-id="${CSS.escape(cursor)}"]`) : null;
    (row ?? list).focus({ preventScroll: true });
    row?.scrollIntoView({ block: 'nearest' });
  }, [cursor, focusTick]);

  const title = app.title();
  const project = app.currentProject();
  const shownProject = app.shownProject();
  const viewMenu = [
    'section.add',
    'project.board',
    'project.list',
    'task.clearCompleted',
    'trash.empty',
    'project.edit',
    'project.delete',
    'label.edit',
    'label.remove',
  ]
    .map((id) => catalog.get(id))
    .filter((c) => c && catalog.isEnabled(c));

  return (
    <main
      class="tk-main"
      onContextMenu={(e) => {
        // The empty part of the view; text fields keep their own menu.
        if ((e.target as HTMLElement).closest('input, textarea, button, [role=menu]')) return;
        openMenu(app, catalog, e, 'list');
      }}
    >
      <div class="tk-main-inner">
        <header class="tk-view-header">
          {project && <span class="tk-dot" style={{ background: PROJECT_COLORS[project.color] }} />}
          <h1 id="tk-view-title">{title}</h1>
          {viewMenu.length > 0 && <ViewMenu catalog={catalog} ids={viewMenu.map((c) => c!.id)} />}
        </header>
        {content.note && <p class="tk-note">{content.note}</p>}
        <div
          ref={listRef}
          class={content.board ? 'tk-list tk-board' : 'tk-list'}
          role="listbox"
          aria-labelledby="tk-view-title"
          aria-multiselectable="true"
          tabIndex={cursor ? -1 : 0}
          onKeyDown={(e) => {
            if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
              e.preventDefault();
              const row = (e.target as HTMLElement).closest<HTMLElement>('[data-id]');
              const r = (row ?? listRef.current)!.getBoundingClientRect();
              const at = { x: r.left + 24, y: r.top + Math.min(r.height, 32) };
              app.menu.value = { ...at, kind: app.hasTargets() ? 'task' : 'list' };
            }
          }}
        >
          {content.sections.map((s) => (
            <SectionView
              key={s.key}
              app={app}
              catalog={catalog}
              section={s}
              showContext={content.showContext}
            />
          ))}
          {shownProject && (
            <button
              type="button"
              class="tk-add-section"
              onClick={() => app.open({ kind: 'section', projectId: shownProject.id, id: null })}
            >
              <Icon name="plus" />
              Add section
            </button>
          )}
          {content.sections.length === 0 && app.composer.value === 'end' && <Composer app={app} slot="end" />}
          {content.empty && app.composer.value === null && (
            <div class="tk-empty">
              <p class="tk-empty-title">{content.empty.title}</p>
              <p>{content.empty.hint}</p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function ViewMenu({ catalog, ids }: { readonly catalog: CommandCatalog; readonly ids: readonly string[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    addEventListener('pointerdown', away, true);
    ref.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus();
    return () => removeEventListener('pointerdown', away, true);
  }, [open]);
  return (
    <div class="tk-view-menu" ref={ref}>
      <button
        type="button"
        class="tk-icon-button"
        aria-label="More actions"
        title="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon name="dots" />
      </button>
      {open && (
        <div
          class="tk-menu tk-menu-dropdown"
          role="menu"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setOpen(false);
              (ref.current?.firstElementChild as HTMLElement | null)?.focus();
            } else menuArrows(e);
          }}
        >
          {ids.map((id) => {
            const c = catalog.get(id)!;
            return (
              <button
                key={id}
                type="button"
                role="menuitem"
                class={`tk-menu-item${c.danger ? ' tk-danger' : ''}`}
                onClick={() => {
                  setOpen(false);
                  catalog.run(id);
                }}
              >
                <span class="tk-menu-title">{c.title}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** ↑ ↓ Home End move between a menu's items. */
export function menuArrows(e: KeyboardEvent): void {
  const menu = e.currentTarget as HTMLElement;
  const items = [...menu.querySelectorAll<HTMLElement>('[role^=menuitem]:not([disabled])')];
  const at = items.indexOf(document.activeElement as HTMLElement);
  let next: number | null = null;
  if (e.key === 'ArrowDown') next = (at + 1) % items.length;
  else if (e.key === 'ArrowUp') next = (at - 1 + items.length) % items.length;
  else if (e.key === 'Home') next = 0;
  else if (e.key === 'End') next = items.length - 1;
  if (next === null) return;
  e.preventDefault();
  e.stopPropagation();
  items[next]?.focus();
}

/** Where a project section's rows can be dropped: the section's key, or none outside project views. */
/** Which half of the row the pointer is over during a drag. */
function dropSide(e: DragEvent): 'before' | 'after' {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  return e.clientY > r.top + r.height / 2 ? 'after' : 'before';
}

function sectionDrop(app: AppController, section: Section): { sectionId: string | undefined } | null {
  if (app.shown.value.type !== 'project') return null;
  if (section.key === 'tasks') return { sectionId: undefined };
  return section.sectionId ? { sectionId: section.sectionId } : null;
}

function SectionView({
  app,
  catalog,
  section,
  showContext,
}: {
  readonly app: AppController;
  readonly catalog: CommandCatalog;
  readonly section: Section;
  readonly showContext: boolean;
}) {
  const slot = section.addSlot;
  const composerHere = slot !== null && app.composer.value === slot;
  const [into, setInto] = useState(false);
  const drop = sectionDrop(app, section);
  const view = app.shown.value;
  const target =
    section.sectionId && view.type === 'project'
      ? ({ kind: 'section', projectId: view.id, id: section.sectionId } as const)
      : undefined;
  const sectionMenu = (e: MouseEvent, at?: { x: number; y: number }) =>
    target && openMenu(app, catalog, e, 'section', target, at);
  return (
    <section
      class={`tk-section${into ? ' tk-drop-into' : ''}`}
      aria-label={section.heading ?? undefined}
      onDragOver={(e) => {
        if (!drop || !e.dataTransfer?.types.includes(DRAG_TYPE)) return;
        e.preventDefault();
        setInto(!(e.target as HTMLElement).closest('.tk-row'));
      }}
      onDragLeave={(e) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) setInto(false);
      }}
      onDrop={(e) => {
        setInto(false);
        const data = e.dataTransfer?.getData(DRAG_TYPE);
        if (!drop || !data) return;
        e.preventDefault();
        // Dropped on the heading or empty space: to the end of this section.
        const dragged = JSON.parse(data) as string[];
        const ids = app.ids.value;
        const order = [
          ...ids.filter((id) => !dragged.includes(id)),
          ...ids.filter((id) => dragged.includes(id)),
        ];
        app.dropInto(dragged, drop.sectionId, order);
      }}
    >
      {section.heading && (
        <h2
          class={`tk-section-heading${section.tone === 'overdue' ? ' tk-overdue' : ''}`}
          onContextMenu={(e) => {
            if (!target) return;
            e.stopPropagation();
            sectionMenu(e);
          }}
        >
          <span class="tk-section-name">{section.heading}</span>
          {section.count !== null && <span class="tk-count">{section.count}</span>}
          {target && (
            <button
              type="button"
              class="tk-icon-button tk-section-more"
              aria-label={`${section.heading} section actions`}
              title="Section actions"
              aria-haspopup="menu"
              onClick={(e) => {
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                sectionMenu(e, { x: r.left, y: r.bottom + 4 });
              }}
            >
              <Icon name="dots" />
            </button>
          )}
        </h2>
      )}
      {section.rows.map((row) => (
        <TaskRow key={row.task.id} app={app} row={row} showContext={showContext} />
      ))}
      {composerHere ? (
        <Composer app={app} slot={slot} />
      ) : (
        slot !== null && (
          <button type="button" class="tk-add-row" onClick={() => (app.composer.value = slot)}>
            <span class="tk-add-plus">
              <Icon name="plus" />
            </span>
            Add task
          </button>
        )
      )}
    </section>
  );
}

function TaskRow({
  app,
  row,
  showContext,
}: {
  readonly app: AppController;
  readonly row: Row;
  readonly showContext: boolean;
}) {
  const { task, isSubtask } = row;
  const list = app.list;
  const view = app.shown.value;
  const today = app.today.value;
  const chosen = app.selected.value.has(task.id);
  const isCursor = app.cursor.value === task.id;
  const completing = app.completing.value.has(task.id);
  const leaving = app.leaving.value.has(task.id);
  const [drop, setDrop] = useState<'before' | 'after' | null>(null);
  const canReorder = view.type === 'project';
  const done = task.completed || completing;
  const subs = list.getSubtasks(task.id);
  const parent = task.parentId ? list.getTask(task.parentId) : undefined;
  const project = list.getProject(task.projectId);
  const inTrash = task.deletedAt !== null;

  const classes = ['tk-row'];
  if (isSubtask) classes.push('tk-subtask');
  if (chosen) classes.push('tk-chosen');
  if (done) classes.push('tk-done');
  if (completing) classes.push('tk-completing');
  if (leaving) classes.push('tk-leaving');
  if (drop) classes.push(`tk-drop-${drop}`);

  return (
    <div
      class={classes.join(' ')}
      role="option"
      aria-selected={chosen}
      data-id={task.id}
      tabIndex={isCursor ? 0 : -1}
      // Only top-level tasks are dragged; subtasks follow their parent (PRD §4.5).
      draggable={!inTrash && !task.parentId}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('.tk-check')) return;
        app.click(task.id, { toggle: e.metaKey || e.ctrlKey, range: e.shiftKey });
      }}
      onDblClick={(e) => {
        if (!(e.target as HTMLElement).closest('.tk-check') && !inTrash) app.edit(task.id);
      }}
      onContextMenu={(e) => {
        // A task always has something to offer (Complete, or Restore in the Trash).
        e.preventDefault();
        e.stopPropagation();
        if (!app.selected.value.has(task.id)) app.click(task.id);
        app.menu.value = { x: e.clientX, y: e.clientY, kind: 'task' };
      }}
      onDragStart={(e) => {
        if (!app.selected.value.has(task.id)) app.click(task.id);
        const tops = app.targetIds().filter((id) => !list.getTask(id)?.parentId);
        e.dataTransfer?.setData(DRAG_TYPE, JSON.stringify(tops));
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(e) => {
        if (!canReorder || !e.dataTransfer?.types.includes(DRAG_TYPE)) return;
        e.preventDefault();
        setDrop(dropSide(e));
      }}
      onDragLeave={(e) => {
        // Moving onto the row's own title or check fires dragleave too; only leaving the row clears the line.
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) setDrop(null);
      }}
      onDrop={(e) => {
        // The side comes from where the drop is, not the last dragover, which may have been cleared.
        const after = dropSide(e) === 'after';
        setDrop(null);
        const data = e.dataTransfer?.getData(DRAG_TYPE);
        if (!canReorder || !data) return;
        e.preventDefault();
        e.stopPropagation();
        const dragged = JSON.parse(data) as string[];
        const order = dropOrder(app.ids.value, dragged, task.id, after);
        const moved = dragged.some((id) => {
          const t = list.getTask(id);
          return t && !t.parentId && t.sectionId !== task.sectionId;
        });
        if (moved) app.dropInto(dragged, task.sectionId, order);
        else if (order) app.reorder(order);
      }}
    >
      {inTrash ? (
        <span class="tk-check tk-check-trash" aria-hidden="true">
          <Icon name="trash" />
        </span>
      ) : (
        <button
          type="button"
          class={`tk-check tk-p${task.priority}`}
          role="checkbox"
          aria-checked={done}
          aria-label={done ? `Mark "${task.title}" not done` : `Complete "${task.title}"`}
          tabIndex={-1}
          onClick={() => void app.toggleComplete([task.id])}
        >
          <Icon name="check" />
        </button>
      )}
      <div class="tk-row-body">
        <div class="tk-row-title">{task.title}</div>
        {task.description && <div class="tk-row-desc">{task.description.split('\n')[0]}</div>}
        <div class="tk-row-meta">
          {inTrash && <span>{trashAge(task.deletedAt ?? 0, Date.now())}</span>}
          {task.due && !inTrash && (
            <span class={`tk-due tk-due-${dueTone(task.due, today) ?? 'later'}`}>
              <Icon name="calendar" />
              {formatDue(task.due, today)}
              {task.recurrence && (
                <span title={RECURRENCE_LABELS[task.recurrence]} class="tk-repeat">
                  <Icon name="repeat" />
                </span>
              )}
            </span>
          )}
          {subs.length > 0 && (
            <span title="Subtasks done">
              <Icon name="subtasks" />
              {subs.filter((s) => s.completed).length}/{subs.length}
            </span>
          )}
          {task.labels.map((l) => (
            <span key={l} class="tk-label" style={labelStyle(app, l)}>
              <Icon name="tag" />
              {l}
            </span>
          ))}
          {showContext && parent && (
            <span class="tk-context">
              <Icon name="parent" />
              {parent.title}
            </span>
          )}
          {showContext && project && (
            <span class="tk-context tk-row-project">
              {project.name}
              <span class="tk-dot" style={{ background: PROJECT_COLORS[project.color] }} />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/** The add-task row (PRD §4.1): Quick Add text with a live preview of what it will become. */
function Composer({ app, slot }: { readonly app: AppController; readonly slot: string }) {
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), [slot]);
  const draft = text.trim() ? resolveDraft(text, app.shown.value, slot, app.today.value) : null;
  const project = draft?.projectName
    ? (app.list.findProjectByName(draft.projectName)?.name ?? `${draft.projectName} (new)`)
    : null;
  return (
    <div class="tk-composer">
      <input
        ref={input}
        id="tk-composer"
        value={text}
        aria-label="New task"
        placeholder="Task name — try “tomorrow p1 #Work @phone”"
        spellcheck={true}
        onInput={(e) => setText((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => {
          // Enter and Esc while an input method is composing pick or cancel its candidate.
          if (isComposingKey(e)) return;
          if (e.key === 'Enter') {
            e.preventDefault();
            if (!text.trim()) app.closeComposer();
            else if (app.addTask(text, slot)) setText('');
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            app.closeComposer();
          }
        }}
        onBlur={(e) => {
          const next = e.relatedTarget as HTMLElement | null;
          if (!text.trim() && !next?.closest('.tk-composer')) app.composer.value = null;
        }}
      />
      <div class="tk-composer-foot">
        <div class="tk-chips" aria-live="polite">
          {draft?.due && (
            <span class="tk-chip">
              <Icon name="calendar" />
              {formatDue(draft.due, app.today.value)}
              {draft.recurrence && ` · ${RECURRENCE_LABELS[draft.recurrence]}`}
            </span>
          )}
          {draft && draft.priority < 4 && (
            <span class={`tk-chip tk-p${draft.priority}`}>
              <Icon name="flag" />P{draft.priority}
            </span>
          )}
          {project && (
            <span class="tk-chip">
              <Icon name="hash" />
              {project}
            </span>
          )}
          {draft?.labels.map((l) => (
            <span key={l} class="tk-chip">
              <Icon name="tag" />
              {l}
            </span>
          ))}
        </div>
        <span class="tk-hint">
          <kbd>↵</kbd> add <kbd>esc</kbd> close
        </span>
      </div>
    </div>
  );
}
