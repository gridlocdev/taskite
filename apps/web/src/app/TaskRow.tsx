import { useState } from 'preact/hooks';
import {
  PROJECT_COLORS,
  RECURRENCE_LABELS,
  dueTone,
  formatDue,
  plural,
  trashAge,
  type Row,
} from '@taskite/core';
import { Icon } from '@taskite/ui';
import type { AppController } from './controller.ts';
import { setFaintDragImage } from './dragImage.ts';
import { dropOrder } from './forms.ts';
import { NameField } from './NameField.tsx';
import { touchScreen, useTouch } from './touch.ts';

/** The drag payload type: the dragged task ids as JSON. */
export const DRAG_TYPE = 'application/x-taskite-tasks';

/** A coloured label's text colour (PRD §4.7); none for a plain label. */
function labelStyle(app: AppController, label: string) {
  const color = app.list.labelColor(label);
  return color ? { color: PROJECT_COLORS[color] } : undefined;
}

/** Which half of the row the pointer is over during a drag. */
function dropSide(e: DragEvent): 'before' | 'after' {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  return e.clientY > r.top + r.height / 2 ? 'after' : 'before';
}

/** A task in a list, or a card on a board (PRD §5.2), with its mouse, keyboard and touch handling. */
export function TaskRow({
  app,
  row,
  showContext,
  tabStop,
  card,
}: {
  readonly app: AppController;
  readonly row: Row;
  readonly showContext: boolean;
  readonly tabStop: boolean;
  /** A board card: its priority shows as a chip too. */
  readonly card: boolean;
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
  const attached = task.attachments?.length ?? 0;
  const renaming = app.renaming.value?.id === task.id;
  // Touch (PRD §5.5): a list row slides right to complete and left to trash; a long press opens its menu.
  const touch = useTouch({
    onLongPress: (at) => {
      if (!app.selected.value.has(task.id)) app.click(task.id);
      app.menu.value = { ...at, kind: 'task' };
    },
    ...(card || inTrash || renaming
      ? {}
      : {
          onSwipe: {
            right: () => void app.toggleComplete([task.id]),
            left: () => void app.trash([task.id]),
          },
        }),
  });
  const slid = touch.dx;

  const classes = ['tk-row'];
  if (isSubtask) classes.push('tk-subtask');
  if (chosen) classes.push('tk-chosen');
  if (isCursor) classes.push('tk-cursor');
  if (done) classes.push('tk-done');
  if (completing) classes.push('tk-completing');
  if (leaving) classes.push('tk-leaving');
  if (drop) classes.push(`tk-drop-${drop}`);
  if (slid) classes.push('tk-sliding');

  return (
    <div
      class={classes.join(' ')}
      role="option"
      aria-selected={chosen}
      data-id={task.id}
      tabIndex={tabStop ? 0 : -1}
      // Tab into another board column puts the cursor there. A click does that itself (and ⌘-click mustn't
      // choose the row first), so only keyboard focus counts.
      onFocus={(e) => {
        if (!isCursor && (e.currentTarget as HTMLElement).matches(':focus-visible')) app.click(task.id);
      }}
      // Only top-level tasks are dragged; subtasks follow their parent (PRD §4.5). A finger slides rows instead.
      draggable={!inTrash && !task.parentId && !renaming && !touchScreen.value}
      style={slid ? { transform: `translateX(${slid}px)` } : undefined}
      {...touch.handlers}
      onClick={(e) => {
        if (touch.swallowClick()) return;
        if ((e.target as HTMLElement).closest('.tk-check, .tk-name-field, .tk-row-more')) return;
        app.click(task.id, { toggle: e.metaKey || e.ctrlKey, range: e.shiftKey });
        // A tap opens the task (PRD §5.5): a finger has no double-click.
        if (touch.wasTouch() && !inTrash) app.edit(task.id);
      }}
      onDblClick={(e) => {
        if (!(e.target as HTMLElement).closest('.tk-check, .tk-name-field, .tk-row-more') && !inTrash)
          app.edit(task.id);
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
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          setFaintDragImage(e, e.currentTarget as HTMLElement, tops.length);
        }
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
      {slid !== 0 && (
        <span
          class={`tk-swipe-hint ${slid > 0 ? 'tk-swipe-done' : 'tk-swipe-trash'}${touch.armed ? ' tk-armed' : ''}`}
          style={
            slid > 0
              ? { left: `${-slid}px`, width: `${slid}px` }
              : { right: `${slid}px`, width: `${-slid}px` }
          }
          aria-hidden="true"
        >
          <Icon name={slid > 0 ? 'check' : 'trash'} />
        </span>
      )}
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
        {renaming ? <NameField app={app} title={task.title} /> : <div class="tk-row-title">{task.title}</div>}
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
          {card && task.priority < 4 && (
            <span class={`tk-priority tk-p${task.priority}`} title={`Priority ${task.priority}`}>
              <Icon name="flag" />P{task.priority}
            </span>
          )}
          {subs.length > 0 && (
            <span title="Subtasks done">
              <Icon name="subtasks" />
              {subs.filter((s) => s.completed).length}/{subs.length}
            </span>
          )}
          {attached > 0 && (
            <span class="tk-attached" title={plural(attached, 'attachment')}>
              <Icon name="paperclip" />
              {attached}
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
      {isCursor && !renaming && (
        // The row's actions in sight, on the cursor row only: the same menu as a right-click (PRD §5.2). Not a Tab
        // stop, like the check circle: the list stays one Tab stop, and Shift+F10 opens the menu from the keyboard.
        <button
          type="button"
          class="tk-icon-button tk-row-more"
          aria-label={`${task.title} actions`}
          title="Task actions"
          aria-haspopup="menu"
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            if (!app.selected.value.has(task.id)) app.click(task.id);
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            app.menu.value = { x: r.left, y: r.bottom + 4, kind: 'task' };
          }}
        >
          <Icon name="dots" />
        </button>
      )}
    </div>
  );
}
