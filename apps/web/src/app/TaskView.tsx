import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { PROJECT_COLORS, RECURRENCE_LABELS, formatDue, resolveDraft, type Section } from '@taskite/core';
import { Icon, isComposingKey, type CommandCatalog } from '@taskite/ui';
import { addStop, type AppController } from './controller.ts';
import { openMenu } from './ContextMenu.tsx';
import { SectionHeading } from './SectionHeading.tsx';
import { DRAG_TYPE, TaskRow } from './TaskRow.tsx';

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

  // Keyboard focus follows the cursor while it's in the list or nowhere (↓ right after the page opens), and
  // comes back after a dialog closes.
  const lastTick = useRef(focusTick);
  // Before paint, so a key pressed right after ↓ goes to the row or button the cursor moved to.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const asked = lastTick.current !== focusTick;
    lastTick.current = focusTick;
    const active = document.activeElement;
    const row = cursor ? list.querySelector<HTMLElement>(`[data-id="${CSS.escape(cursor)}"]`) : null;
    const nowhere = active === null || active === document.body;
    if (!asked && !list.contains(active) && !(nowhere && row)) return;
    // An add-task row that opened in the same update keeps the keyboard (Go to Section… into an empty one).
    if (active?.closest('.tk-composer')) return;
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
          {project && (
            <>
              <span class="tk-crumb">Projects</span>
              <span class="tk-crumb-sep" aria-hidden="true">
                /
              </span>
              <span class="tk-dot" style={{ background: PROJECT_COLORS[project.color] }} />
            </>
          )}
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
          // A board's columns are Tab stops of their own (see SectionView), so the board itself isn't one.
          tabIndex={cursor || (content.board && app.ids.value.length) ? -1 : 0}
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
              board={content.board === true}
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
  board,
}: {
  readonly app: AppController;
  readonly catalog: CommandCatalog;
  readonly section: Section;
  readonly showContext: boolean;
  readonly board: boolean;
}) {
  // Tab reaches every board column: the cursor's row in its column, the first row in the others. A list is
  // one Tab stop, the cursor's row.
  const cursor = app.cursor.value;
  const tabStop =
    board && !section.rows.some((r) => r.task.id === cursor) ? (section.rows[0]?.task.id ?? null) : cursor;
  const slot = section.addSlot;
  const composerHere = slot !== null && app.composer.value === slot;
  const [into, setInto] = useState(false);
  const drop = sectionDrop(app, section);
  const view = app.shown.value;
  const target =
    section.sectionId && view.type === 'project'
      ? ({ kind: 'section', projectId: view.id, id: section.sectionId } as const)
      : undefined;
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
        <SectionHeading
          app={app}
          catalog={catalog}
          section={section}
          heading={section.heading}
          target={target}
        />
      )}
      {section.rows.map((row) => (
        <TaskRow
          key={row.task.id}
          app={app}
          row={row}
          showContext={showContext}
          tabStop={row.task.id === tabStop}
          card={board}
        />
      ))}
      {composerHere ? (
        <Composer app={app} slot={slot} />
      ) : (
        slot !== null && (
          <button
            type="button"
            class={`tk-add-row${app.cursor.value === addStop(slot) ? ' tk-chosen' : ''}`}
            data-id={addStop(slot)}
            onClick={() => (app.composer.value = slot)}
            // Tab onto the button puts the cursor there; a click opens the add-task row itself.
            onFocus={(e) => {
              if ((e.currentTarget as HTMLElement).matches(':focus-visible')) app.cursorToAdd(slot);
            }}
            onKeyDown={(e) => {
              // A character starts the task (Space still presses the button; ⌘ and Ctrl keys stay shortcuts).
              if (isComposingKey(e) || e.key.length !== 1 || e.key === ' ') return;
              if (e.metaKey || e.ctrlKey || e.altKey) return;
              e.preventDefault();
              app.typeIntoSlot(slot, e.key);
            }}
          >
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

/** The add-task row (PRD §4.1): Quick Add text with a live preview of what it will become. */
function Composer({ app, slot }: { readonly app: AppController; readonly slot: string }) {
  const [text, setText] = useState(() => app.takeSeed());
  const input = useRef<HTMLInputElement>(null);
  // Before paint, so keys typed fast on the Add task button land here and not on the page.
  useLayoutEffect(() => {
    const field = input.current;
    if (!field) return;
    field.focus();
    // Typed on the Add task button: carry on after what's there.
    field.setSelectionRange(field.value.length, field.value.length);
  }, [slot]);
  const draft = text.trim() ? resolveDraft(text, app.shown.value, slot, app.today.value) : null;
  const project = draft?.projectName
    ? (app.list.findProjectByName(draft.projectName)?.name ?? `${draft.projectName} (new)`)
    : null;
  const chips = !!draft && (!!draft.due || draft.priority < 4 || !!project || draft.labels.length > 0);
  const submit = () => {
    if (!text.trim()) app.closeComposer();
    else if (app.addTask(text, slot)) setText('');
  };
  return (
    <div class="tk-composer">
      <div class="tk-composer-line">
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
              submit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              app.closeComposer();
            }
          }}
          onBlur={(e) => {
            // Switching to another window or tab keeps the row open.
            if (!document.hasFocus()) return;
            const next = e.relatedTarget as HTMLElement | null;
            if (!text.trim() && !next?.closest('.tk-composer')) app.composer.value = null;
          }}
        />
        {/* Phones: the add-task panel's own add button, at the right by the thumb (PRD §5.5). */}
        <button
          type="button"
          class="tk-composer-add"
          aria-label="Add"
          // Keeps the keyboard up: the field doesn't lose focus to the button.
          onPointerDown={(e) => e.preventDefault()}
          onClick={submit}
        >
          <Icon name="check" />
        </button>
      </div>
      {/* Bare: nothing to show yet, so a phone gives the row no room (its key hints are hidden there). */}
      <div class={`tk-composer-foot${chips ? '' : ' tk-bare'}`}>
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
