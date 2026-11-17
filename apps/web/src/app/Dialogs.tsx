import { useEffect, useRef, useState } from 'preact/hooks';
import {
  MAX_PROJECT_NAME,
  PROJECT_COLORS,
  PROJECT_COLOR_NAMES,
  RECURRENCES,
  RECURRENCE_LABELS,
  formatSize,
  plural,
  type Attachment,
  type Priority,
  type ProjectColor,
  type Recurrence,
  type TaskPatch,
  type Theme,
} from '@taskite/core';
import {
  Dialog,
  Icon,
  ListPopup,
  after,
  filterEntries,
  isComposingKey,
  isSubmitKey,
  isMac,
  type CommandCatalog,
} from '@taskite/ui';
import { AutomationsDialog } from './Automations.tsx';
import { Calendar } from './Calendar.tsx';
import { CommandMenu } from './CommandMenu.tsx';
import type { AppController } from './controller.ts';
import { duePreview, editorPatch, parseDueText, type EditorFields } from './forms.ts';
import { shortcutGroups } from './shortcuts.ts';

/** Whichever dialog is open, plus the save conflict and recovery dialogs, which come from the session. */
export function Dialogs({ app, catalog }: { readonly app: AppController; readonly catalog: CommandCatalog }) {
  const conflict = app.session.conflict.value;
  if (conflict) return <ConflictDialog app={app} changed={conflict.changed} />;
  if (app.session.recoverable.value !== null) return <RecoveryDialog app={app} />;
  const d = app.dialog.value;
  if (!d) return null;
  switch (d.kind) {
    case 'task':
      return <TaskEditor key={d.id} app={app} id={d.id} />;
    case 'due':
      return <DueDialog app={app} ids={d.ids} />;
    case 'project':
      return <ProjectDialog app={app} id={d.id} />;
    case 'label':
      return <LabelDialog app={app} name={d.name} />;
    case 'section':
      return <SectionDialog app={app} projectId={d.projectId} id={d.id} after={d.after} />;
    case 'confirm':
      return (
        <Dialog
          title={d.title}
          onClose={() => app.close()}
          actions={
            <>
              <button type="button" class="tk-button" data-autofocus onClick={() => app.close()}>
                Cancel
              </button>
              <button
                type="button"
                class="tk-button tk-button-danger"
                onClick={() => {
                  app.close();
                  d.run();
                }}
              >
                {d.confirm}
              </button>
            </>
          }
        >
          <p>{d.message}</p>
        </Dialog>
      );
    case 'move':
      return <MoveDialog app={app} ids={d.ids} />;
    case 'automations':
      return <AutomationsDialog app={app} projectId={d.projectId} sectionId={d.sectionId} />;
    case 'sections':
      return <GoToSectionDialog app={app} />;
    case 'commands':
      return <CommandMenu app={app} catalog={catalog} initial={d.query} />;
    case 'settings':
      return <SettingsDialog app={app} />;
    case 'about':
      return (
        <Dialog
          title="About Taskite"
          onClose={() => app.close()}
          actions={
            <button type="button" class="tk-button tk-button-primary" onClick={() => app.close()}>
              Close
            </button>
          }
        >
          <p class="tk-about-name">Taskite {app.version}</p>
          <p>A to-do list for the desktop, the browser, a home server and the command line.</p>
          <p class="tk-muted">Your tasks are kept in {app.location}.</p>
        </Dialog>
      );
    case 'shortcuts':
      return <ShortcutsDialog app={app} catalog={catalog} />;
  }
}

function Actions(props: { readonly app: AppController; readonly save: string }) {
  return (
    <>
      <button type="button" class="tk-button" onClick={() => props.app.close()}>
        Cancel
      </button>
      <button type="submit" class="tk-button tk-button-primary">
        {props.save}
      </button>
    </>
  );
}

/** Fields the editor hides until a task uses them, or until they're added from the row of buttons under it. */
type Extra = 'due' | 'recurrence' | 'priority' | 'labels' | 'subtasks';

const EXTRAS: Readonly<Record<Extra, { readonly name: string; readonly icon: string }>> = {
  due: { name: 'Due date', icon: 'calendar' },
  recurrence: { name: 'Repeat', icon: 'repeat' },
  priority: { name: 'Priority', icon: 'flag' },
  labels: { name: 'Labels', icon: 'tag' },
  subtasks: { name: 'Subtasks', icon: 'subtasks' },
};

/**
 * The fields the task doesn't show yet, one button each: a click shows the field and puts the keyboard in it.
 * Attachments comes last and stays, since a task can take more files.
 */
function AddFields(props: {
  readonly extras: readonly Extra[];
  readonly onPick: (e: Extra) => void;
  readonly onAttach: () => void;
}) {
  return (
    <div class="tk-add-fields" role="group" aria-label="Add to the task">
      {props.extras.map((x) => (
        <button
          key={x}
          type="button"
          class="tk-button tk-button-quiet tk-button-small"
          data-add={x}
          onClick={() => props.onPick(x)}
        >
          <Icon name={EXTRAS[x].icon} />
          {EXTRAS[x].name}
        </button>
      ))}
      <button
        type="button"
        class="tk-button tk-button-quiet tk-button-small"
        data-add="attachments"
        onClick={props.onAttach}
      >
        <Icon name="paperclip" />
        Attachments
      </button>
    </div>
  );
}

/** Saves an attachment's bytes under its name, which opens it or downloads it, as the browser does (PRD §4.8). */
async function openAttachment(app: AppController, attachment: Attachment): Promise<void> {
  const bytes = await app.readAttachment(attachment);
  if (!bytes) return;
  const blob = new Blob([bytes.slice()], { type: attachment.type || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = attachment.name;
  link.click();
  after(60_000, () => URL.revokeObjectURL(url));
}

/** A task's attachments in the editor: a click opens one, × takes it off the task. */
function Attachments(props: {
  readonly app: AppController;
  readonly taskId: string;
  readonly attachments: readonly Attachment[];
  readonly onEmptied: () => void;
}) {
  const { app, taskId, attachments } = props;
  if (!attachments.length) return null;
  return (
    <ul class="tk-attachments" aria-label="Attachments">
      {attachments.map((a) => (
        <li key={a.id}>
          <button
            type="button"
            class="tk-attachment"
            title={`Open ${a.name}`}
            onClick={() => void openAttachment(app, a)}
          >
            <Icon name="paperclip" />
            <span class="tk-attachment-name">{a.name}</span>
            <span class="tk-muted">{formatSize(a.size)}</span>
          </button>
          <button
            type="button"
            class="tk-icon-button tk-small"
            aria-label={`Remove ${a.name}`}
            title={`Remove ${a.name}`}
            onClick={() => {
              app.removeAttachment(taskId, a);
              if (attachments.length === 1) props.onEmptied();
            }}
          >
            <Icon name="x" />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The files a drag carries, if it carries any. */
const carriesFiles = (e: DragEvent): boolean => e.dataTransfer?.types.includes('Files') ?? false;

/**
 * The files a paste carries: a screenshot, or files copied in Finder or Explorer. Rich text copied from a
 * document or a page can carry a picture of itself too; that pastes as text, not as an attachment.
 */
function pastedFiles(data: DataTransfer | null): File[] {
  if (!data || data.types.includes('text/html')) return [];
  return [...data.files];
}

/** The × beside a field added from the buttons: takes away what it holds, and its button comes back. */
function RemoveField(props: { readonly extra: Extra; readonly onRemove: (e: Extra) => void }) {
  const name = EXTRAS[props.extra].name.toLowerCase();
  return (
    <button
      type="button"
      class="tk-icon-button tk-small tk-remove-field"
      aria-label={`Remove ${name}`}
      title={`Remove ${name}`}
      onClick={() => props.onRemove(props.extra)}
    >
      <Icon name="x" />
    </button>
  );
}

/**
 * The task editor (PRD §4.4). Changes apply as they're made, each one undo step: pickers at once, text
 * when its field loses focus or the editor closes. Done, ⌘Enter, Enter in a one-line field, or Esc closes it.
 * Due date, repeat, priority, labels and subtasks show only when the task has them, or once added from their
 * buttons; taking a value away hides its field again and brings its button back.
 */
function TaskEditor({ app, id }: { readonly app: AppController; readonly id: string }) {
  const task = app.list.getTask(id);
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [due, setDue] = useState(task?.due ?? '');
  const [labels, setLabels] = useState(task?.labels.join(', ') ?? '');
  const [subtask, setSubtask] = useState('');
  /** Fields added from their buttons that have had no value yet. */
  const [added, setAdded] = useState<readonly Extra[]>([]);
  /** Fields that have had a value while the editor is open: taking it away hides them again. */
  const filled = useRef(new Set<Extra>());
  /** Where the keyboard goes after the next render: a field just added, or the button of one just taken away. */
  const [focusOn, setFocusOn] = useState<string | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  /** Files are being dragged over the editor. */
  const [dropping, setDropping] = useState(false);
  useEffect(() => {
    if (!focusOn) return;
    body.current?.querySelector<HTMLElement>(focusOn)?.focus();
    setFocusOn(null);
  }, [focusOn]);
  // The text as it was when the editor opened or last saved; only fields typed since then are saved.
  const fields = { title, description, due, labels };
  const start = useRef<EditorFields>(fields);
  const latest = useRef(fields);
  latest.current = fields;
  const saveText = () => {
    const now = latest.current;
    if (!now.title.trim()) setTitle(start.current.title);
    app.saveTask(id, editorPatch(start.current, now));
    start.current = { ...now, title: now.title.trim() ? now.title : start.current.title };
  };
  const saveRef = useRef(saveText);
  saveRef.current = saveText;
  useEffect(() => {
    app.setDraft({
      flush: () => saveRef.current(),
      dirty: () => Object.keys(editorPatch(start.current, latest.current)).length > 0,
    });
    return () => {
      saveRef.current();
      app.setDraft(null);
    };
  }, [app]);
  const rev = app.rev.value;
  // A change from elsewhere shows in the fields nobody has typed in.
  useEffect(() => {
    const t = app.list.getTask(id);
    if (!t) return;
    const fresh: EditorFields = {
      title: t.title,
      description: t.description,
      due: t.due ?? '',
      labels: t.labels.join(', '),
    };
    const was = start.current;
    const now = latest.current;
    if (now.title === was.title) setTitle(fresh.title);
    if (now.description === was.description) setDescription(fresh.description);
    if (now.due === was.due) setDue(fresh.due);
    if (now.labels === was.labels) setLabels(fresh.labels);
    start.current = {
      title: now.title === was.title ? fresh.title : was.title,
      description: now.description === was.description ? fresh.description : was.description,
      due: now.due === was.due ? fresh.due : was.due,
      labels: now.labels === was.labels ? fresh.labels : was.labels,
    };
  }, [rev]);
  // The task went away (deleted elsewhere, or a conflict choice): close instead of showing nothing.
  const gone = !task || task.deletedAt !== null;
  useEffect(() => {
    if (gone) {
      app.close();
      app.say('That task is no longer there.');
    }
  }, [gone]);
  if (!task || gone) return null;
  const subtasks = app.list.getSubtasks(task.id);
  const has: Readonly<Record<Extra, boolean>> = {
    due: task.due !== null,
    recurrence: task.recurrence !== null,
    priority: task.priority !== 4,
    labels: task.labels.length > 0,
    subtasks: subtasks.length > 0,
  };
  for (const x of Object.keys(has) as Extra[]) if (has[x]) filled.current.add(x);
  const shows = (x: Extra) => has[x] || (added.includes(x) && !filled.current.has(x));
  const extras = (Object.keys(EXTRAS) as Extra[]).filter(
    (x) => !shows(x) && !(x === 'subtasks' && task.parentId),
  );
  const save = (patch: TaskPatch) => app.saveTask(task.id, patch);
  const addField = (x: Extra) => {
    filled.current.delete(x);
    setAdded([...added, x]);
    setFocusOn(`[data-field="${x}"]`);
  };
  /** A field's value was taken away: its button gets the keyboard. */
  const emptied = (x: Extra) => setFocusOn(`[data-add="${x}"]`);
  const removeField = (x: Extra) => {
    setAdded(added.filter((a) => a !== x));
    filled.current.add(x);
    if (x === 'due' || x === 'labels') {
      // Through the text fields, so a value typed and not yet saved goes too.
      latest.current = { ...latest.current, [x]: '' };
      if (x === 'due') setDue('');
      else setLabels('');
      saveText();
    } else if (x === 'recurrence') save({ recurrence: null });
    else if (x === 'priority') save({ priority: 4 });
    emptied(x);
  };
  const remove = (x: Extra) => <RemoveField extra={x} onRemove={removeField} />;
  const done = () => {
    saveText();
    app.close();
  };
  return (
    <Dialog
      title={task.parentId ? 'Subtask' : 'Task'}
      class="tk-dialog-wide"
      onClose={done}
      onSubmit={done}
      actions={
        <>
          <button
            type="button"
            class="tk-button tk-button-quiet tk-danger tk-push-left"
            onClick={() => {
              app.close();
              void app.trash([task.id]);
            }}
          >
            <Icon name="trash" />
            Move to Trash
          </button>
          <button type="submit" class="tk-button tk-button-primary">
            Done
          </button>
        </>
      }
    >
      <div
        ref={body}
        class={dropping ? 'tk-editor tk-dropping' : 'tk-editor'}
        onDragOver={(e) => {
          if (!carriesFiles(e)) return;
          e.preventDefault();
          setDropping(true);
        }}
        onDragLeave={(e) => {
          if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) setDropping(false);
        }}
        onPaste={(e) => {
          const files = pastedFiles(e.clipboardData);
          if (!files.length) return;
          e.preventDefault();
          void app.attachFiles(task.id, files);
        }}
        onDrop={(e) => {
          setDropping(false);
          if (!carriesFiles(e)) return;
          e.preventDefault();
          void app.attachFiles(task.id, [...(e.dataTransfer?.files ?? [])]);
        }}
      >
        <input
          class="tk-editor-title"
          aria-label="Task name"
          required
          value={title}
          onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
          onBlur={saveText}
        />
        <textarea
          class="tk-editor-notes"
          aria-label="Description"
          rows={2}
          placeholder="Description"
          value={description}
          onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)}
          onBlur={saveText}
        />
        <div class="tk-field-row">
          {!task.parentId && (
            <label class="tk-field">
              <span>Project</span>
              <select
                value={task.projectId}
                onChange={(e) => save({ projectId: (e.target as HTMLSelectElement).value })}
              >
                {app.list.data.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {shows('due') && (
            <div class="tk-extra">
              <label class="tk-field">
                <span>Due date</span>
                <input
                  type="date"
                  data-field="due"
                  value={due}
                  onInput={(e) => setDue((e.target as HTMLInputElement).value)}
                  onBlur={saveText}
                />
              </label>
              {remove('due')}
            </div>
          )}
          {shows('recurrence') && (
            <div class="tk-extra">
              <label class="tk-field">
                <span>Repeat</span>
                <select
                  data-field="recurrence"
                  value={task.recurrence ?? ''}
                  onChange={(e) => {
                    const value = (e.target as HTMLSelectElement).value as Recurrence | '';
                    save({ recurrence: value || null });
                    // Repeating gives an undated task today's date.
                    setDue(app.list.getTask(task.id)?.due ?? '');
                    if (!value) emptied('recurrence');
                  }}
                >
                  <option value="">Doesn't repeat</option>
                  {RECURRENCES.map((r) => (
                    <option key={r} value={r}>
                      {RECURRENCE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </label>
              {remove('recurrence')}
            </div>
          )}
          {shows('priority') && (
            <div class="tk-extra">
              <label class="tk-field">
                <span>Priority</span>
                <select
                  data-field="priority"
                  value={String(task.priority)}
                  onChange={(e) => {
                    const priority = Number((e.target as HTMLSelectElement).value) as Priority;
                    save({ priority });
                    if (priority === 4) emptied('priority');
                  }}
                >
                  <option value="1">Priority 1 (urgent)</option>
                  <option value="2">Priority 2 (high)</option>
                  <option value="3">Priority 3 (medium)</option>
                  <option value="4">Priority 4 (normal)</option>
                </select>
              </label>
              {remove('priority')}
            </div>
          )}
        </div>
        {shows('labels') && (
          <div class="tk-extra">
            <label class="tk-field">
              <span>Labels</span>
              <input
                data-field="labels"
                placeholder="e.g. errands, phone"
                value={labels}
                onInput={(e) => setLabels((e.target as HTMLInputElement).value)}
                onBlur={saveText}
              />
              <small class="tk-muted">Separate labels with commas.</small>
            </label>
            {remove('labels')}
          </div>
        )}
        {shows('subtasks') && !task.parentId && (
          <fieldset class="tk-subtasks tk-extra">
            <legend>Subtasks</legend>
            {subtasks.length === 0 && remove('subtasks')}
            <ul>
              {subtasks.map((s) => (
                <li key={s.id} class={s.completed ? 'tk-done' : undefined}>
                  <label>
                    <input
                      type="checkbox"
                      checked={s.completed}
                      onChange={() =>
                        s.completed ? app.list.reopenTasks(s.id) : app.list.completeTasks(s.id)
                      }
                    />
                    <span>{s.title}</span>
                  </label>
                  <button
                    type="button"
                    class="tk-icon-button tk-small"
                    aria-label={`Move "${s.title}" to the Trash`}
                    onClick={() => {
                      app.list.deleteTasks(s.id);
                      if (subtasks.length === 1) emptied('subtasks');
                    }}
                  >
                    <Icon name="x" />
                  </button>
                </li>
              ))}
            </ul>
            <input
              data-field="subtasks"
              placeholder="Add a subtask and press Enter"
              aria-label="New subtask"
              value={subtask}
              onInput={(e) => setSubtask((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !isComposingKey(e) && !isSubmitKey(e)) {
                  e.preventDefault();
                  app.addSubtask(task.id, subtask);
                  setSubtask('');
                }
              }}
            />
          </fieldset>
        )}
        <Attachments
          app={app}
          taskId={task.id}
          attachments={task.attachments ?? []}
          onEmptied={() => setFocusOn('[data-add="attachments"]')}
        />
        <AddFields extras={extras} onPick={addField} onAttach={() => picker.current?.click()} />
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          aria-label="Files to attach"
          onChange={(e) => {
            const input = e.target as HTMLInputElement;
            const files = [...(input.files ?? [])];
            input.value = '';
            void app.attachFiles(task.id, files);
          }}
        />
      </div>
    </Dialog>
  );
}

/** The due date dialog (PRD §9.2): typed dates, a preview, and quick picks. */
function DueDialog({ app, ids }: { readonly app: AppController; readonly ids: readonly string[] }) {
  const today = app.today.value;
  const dues = new Set(ids.map((id) => app.list.getTask(id)?.due ?? null));
  const [only] = dues;
  const [text, setText] = useState(dues.size === 1 && only ? only : '');
  const parsed = parseDueText(text, today);
  const apply = (value: string) => {
    const { due, ok } = parseDueText(value, today);
    if (!ok) return;
    app.close();
    app.setDue(ids, due);
  };
  return (
    <Dialog
      title={ids.length === 1 ? 'Due date' : `Due date for ${plural(ids.length, 'task')}`}
      onClose={() => app.close()}
      onSubmit={() => apply(text)}
      actions={<Actions app={app} save="Set Date" />}
    >
      <label class="tk-field">
        <span>Date</span>
        <input
          value={text}
          placeholder="tomorrow, fri, jan 5, next week…"
          onInput={(e) => setText((e.target as HTMLInputElement).value)}
          onFocus={(e) => (e.target as HTMLInputElement).select()}
        />
      </label>
      <p class={parsed.ok ? 'tk-muted' : 'tk-error-text'} aria-live="polite">
        {duePreview(text, today)}
      </p>
      <div class="tk-quick">
        {['Today', 'Tomorrow', 'Next week', 'No date'].map((q) => (
          <button key={q} type="button" class="tk-button tk-button-small" onClick={() => apply(q)}>
            {q}
          </button>
        ))}
      </div>
      <Calendar
        today={today}
        selected={parsed.ok ? parsed.due : null}
        onPick={(iso) => {
          app.close();
          app.setDue(ids, iso);
        }}
      />
    </Dialog>
  );
}

/** New or edit project (PRD §9.3): a name and a colour. */
function ProjectDialog({ app, id }: { readonly app: AppController; readonly id: string | null }) {
  const project = id ? app.list.getProject(id) : undefined;
  const [name, setName] = useState(project?.name ?? '');
  const [color, setColor] = useState<ProjectColor>(project?.color ?? 'blue');
  return (
    <Dialog
      title={project ? 'Edit project' : 'New project'}
      onClose={() => app.close()}
      onSubmit={() => {
        if (!name.trim()) return;
        app.close();
        app.saveProject(id, name, color);
      }}
      actions={<Actions app={app} save={project ? 'Save' : 'Add Project'} />}
    >
      <label class="tk-field">
        <span>Name</span>
        <input
          required
          maxLength={80}
          value={name}
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
        />
      </label>
      <fieldset class="tk-swatches">
        <legend>Colour</legend>
        {PROJECT_COLOR_NAMES.map((c) => (
          <label key={c} class="tk-swatch" title={c}>
            <input
              type="radio"
              name="color"
              value={c}
              checked={c === color}
              aria-label={c}
              onChange={() => setColor(c)}
            />
            <span style={{ background: PROJECT_COLORS[c] }} />
          </label>
        ))}
      </fieldset>
    </Dialog>
  );
}

/** Edit label (PRD §9.3): a name and a colour, or none for the plain label colour. */
function LabelDialog({ app, name: label }: { readonly app: AppController; readonly name: string }) {
  const [name, setName] = useState(label);
  const [color, setColor] = useState<ProjectColor | null>(app.list.labelColor(label));
  return (
    <Dialog
      title="Edit label"
      onClose={() => app.close()}
      onSubmit={() => {
        if (!name.trim().replace(/^@/, '')) return;
        app.close();
        app.editLabel(label, name, color);
      }}
      actions={<Actions app={app} save="Save" />}
    >
      <label class="tk-field">
        <span>Name</span>
        <input required value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
      </label>
      <fieldset class="tk-swatches">
        <legend>Colour</legend>
        <label class="tk-swatch tk-swatch-none" title="none">
          <input
            type="radio"
            name="color"
            value=""
            checked={color === null}
            aria-label="none"
            onChange={() => setColor(null)}
          />
          <span />
        </label>
        {PROJECT_COLOR_NAMES.map((c) => (
          <label key={c} class="tk-swatch" title={c}>
            <input
              type="radio"
              name="color"
              value={c}
              checked={c === color}
              aria-label={c}
              onChange={() => setColor(c)}
            />
            <span style={{ background: PROJECT_COLORS[c] }} />
          </label>
        ))}
      </fieldset>
    </Dialog>
  );
}

/** Add Section or Rename Section (PRD §6). */
function SectionDialog({
  app,
  projectId,
  id,
  after,
}: {
  readonly app: AppController;
  readonly projectId: string;
  readonly id: string | null;
  readonly after: string | undefined;
}) {
  const [name, setName] = useState(id ? (app.list.getSection(projectId, id)?.name ?? '') : '');
  return (
    <Dialog
      title={id ? 'Rename section' : 'Add section'}
      onClose={() => app.close()}
      onSubmit={() => {
        if (!name.trim()) return;
        app.close();
        app.saveSection(projectId, id, name, after);
      }}
      actions={<Actions app={app} save={id ? 'Save' : 'Add Section'} />}
    >
      <label class="tk-field">
        <span>Name</span>
        <input
          required
          maxLength={MAX_PROJECT_NAME}
          value={name}
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
        />
      </label>
    </Dialog>
  );
}

/** Move to… (M): pick a project by typing. */
function MoveDialog({ app, ids }: { readonly app: AppController; readonly ids: readonly string[] }) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const projects = app.list.data.projects.map((p) => ({
    id: p.id,
    title: p.name,
    group: '',
    color: p.color,
  }));
  const results = filterEntries(projects, query);
  const pick = (i: number) => {
    const p = results[i];
    if (!p) return;
    app.close();
    app.moveTo(ids, p.id);
  };
  return (
    <ListPopup
      label={`Move ${plural(ids.length, 'task')} to`}
      placeholder="Move to project…"
      query={query}
      onQuery={(q) => {
        setQuery(q);
        setIndex(0);
      }}
      index={index}
      onIndex={setIndex}
      count={results.length}
      onPick={pick}
      onClose={() => app.close()}
    >
      {results.map((p, i) => (
        <li
          key={p.id}
          id={`tk-palette-${i}`}
          role="option"
          aria-selected={i === index}
          onPointerMove={() => setIndex(i)}
          onClick={() => pick(i)}
        >
          <span class="tk-dot" style={{ background: PROJECT_COLORS[p.color] }} />
          <span class="tk-palette-title">{p.title}</span>
        </li>
      ))}
    </ListPopup>
  );
}

/** Go to Section… (G then S): pick a section of the view on screen by typing. */
function GoToSectionDialog({ app }: { readonly app: AppController }) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const sections = app.namedSections().map((s) => ({
    id: s.key,
    title: s.heading ?? '',
    group: '',
    count: s.rows.filter((r) => !r.isSubtask).length,
  }));
  const results = filterEntries(sections, query);
  const pick = (i: number) => {
    const s = results[i];
    if (!s) return;
    app.close();
    // Let the picker close (and focus go back) first, or an add-task row it opens loses focus and closes.
    queueMicrotask(() => app.goToSection(s.id));
  };
  return (
    <ListPopup
      label="Go to section"
      placeholder="Go to section…"
      query={query}
      onQuery={(q) => {
        setQuery(q);
        setIndex(0);
      }}
      index={index}
      onIndex={setIndex}
      count={results.length}
      onPick={pick}
      onClose={() => app.close()}
    >
      {results.map((s, i) => (
        <li
          key={s.id}
          id={`tk-palette-${i}`}
          role="option"
          aria-selected={i === index}
          onPointerMove={() => setIndex(i)}
          onClick={() => pick(i)}
        >
          <span class="tk-palette-title">{s.title}</span>
          <span class="tk-palette-group">{s.count ? plural(s.count, 'task') : 'Empty'}</span>
        </li>
      ))}
    </ListPopup>
  );
}

const THEMES: readonly { value: Theme; label: string; icon: string }[] = [
  { value: 'auto', label: 'System', icon: 'auto' },
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
];

/** Settings (⌘,): changes apply at once, no Apply button. */
function SettingsDialog({ app }: { readonly app: AppController }) {
  const theme = app.theme.value;
  return (
    <Dialog
      title="Settings"
      onClose={() => app.close()}
      actions={
        <button type="button" class="tk-button tk-button-primary" onClick={() => app.close()}>
          Done
        </button>
      }
    >
      <fieldset class="tk-segmented">
        <legend>Theme</legend>
        {THEMES.map((t) => (
          <label key={t.value} class={theme === t.value ? 'tk-on' : undefined}>
            <input
              type="radio"
              name="theme"
              value={t.value}
              checked={theme === t.value}
              data-autofocus={theme === t.value ? '' : undefined}
              onChange={() => app.setTheme(t.value)}
            />
            <Icon name={t.icon} />
            {t.label}
          </label>
        ))}
      </fieldset>
      <label class="tk-check-field">
        <input
          type="checkbox"
          checked={app.doneRules.value}
          onChange={(e) => app.setDoneRules((e.target as HTMLInputElement).checked)}
        />
        <span>
          A new section named Done completes tasks moved into it
          <small class="tk-muted">
            and reopens tasks moved out. You can change its rules in Section Automations….
          </small>
        </span>
      </label>
      <div class="tk-field">
        <span>Your tasks</span>
        <p class="tk-muted">{app.location}</p>
      </div>
    </Dialog>
  );
}

function ShortcutsDialog({
  app,
  catalog,
}: {
  readonly app: AppController;
  readonly catalog: CommandCatalog;
}) {
  const groups = shortcutGroups(catalog, isMac);
  return (
    <Dialog
      title="Keyboard shortcuts"
      class="tk-dialog-wide"
      onClose={() => app.close()}
      actions={
        <button type="button" class="tk-button tk-button-primary" onClick={() => app.close()}>
          Close
        </button>
      }
    >
      <div class="tk-shortcuts">
        {groups.map((g) => (
          <section key={g.title}>
            <h3>{g.title}</h3>
            <dl>
              {g.lines.map((l) => (
                <div key={l.title} class="tk-shortcut">
                  <dt>{l.title}</dt>
                  <dd>
                    {l.keys.map((way, i) => (
                      <span key={i} class="tk-way">
                        {i > 0 && <span class="tk-or">or</span>}
                        {way.map((k, j) => (
                          <kbd key={j}>{k}</kbd>
                        ))}
                      </span>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}

/** The file changed somewhere else while this window had changes (PRD §3.4). Nothing is merged. */
function ConflictDialog({ app, changed }: { readonly app: AppController; readonly changed: number }) {
  const s = app.session;
  const notice = (text: string | null) => {
    if (text) app.say(text);
  };
  // A file from a newer Taskite is left alone; the conflict stays until it's settled another way.
  const failed = (e: unknown) =>
    app.say(e instanceof Error ? e.message : String(e), { sticky: true, tone: 'error' });
  return (
    <Dialog
      title="Your tasks changed somewhere else"
      onClose={() => undefined}
      actions={
        <>
          <button
            type="button"
            class="tk-button"
            disabled={s.choosing.value}
            onClick={() =>
              void s
                .reload()
                .then((n) => notice(n ?? 'Loaded the tasks from the other change.'))
                .catch(failed)
            }
          >
            Use Theirs
          </button>
          <button
            type="button"
            class="tk-button"
            disabled={s.choosing.value}
            onClick={() =>
              void s
                .keepMine()
                .then(() => app.say('Kept your tasks.'))
                .catch(failed)
            }
          >
            Keep Mine
          </button>
          <button
            type="button"
            class="tk-button tk-button-primary"
            data-autofocus
            disabled={s.choosing.value}
            onClick={() =>
              void s
                .saveCopyAndReload()
                .then((name) => name && app.say(`Saved your version as ${name}, then loaded theirs.`))
                .catch(failed)
            }
          >
            Save Mine as a Copy
          </button>
        </>
      }
    >
      <p>
        Another window or device saved the tasks file while you had changes here.{' '}
        {changed > 0 && `${plural(changed, 'task')} differ.`}
      </p>
      <p class="tk-muted">
        <strong>Save Mine as a Copy</strong> keeps both. <strong>Keep Mine</strong> replaces the other change.{' '}
        <strong>Use Theirs</strong> drops the changes made here.
      </p>
    </Dialog>
  );
}

/** Unsaved changes from last time (PRD §3.5). */
function RecoveryDialog({ app }: { readonly app: AppController }) {
  const s = app.session;
  return (
    <Dialog
      title="Restore unsaved changes?"
      onClose={() => undefined}
      actions={
        <>
          <button
            type="button"
            class="tk-button"
            onClick={() => {
              s.discardRecovered();
              app.say('Unsaved changes discarded.');
            }}
          >
            Discard
          </button>
          <button
            type="button"
            class="tk-button tk-button-primary"
            data-autofocus
            onClick={() => {
              s.restoreRecovered();
              app.say('Unsaved changes restored.');
            }}
          >
            Restore
          </button>
        </>
      }
    >
      <p>Taskite closed last time before some changes were saved.</p>
    </Dialog>
  );
}

/** Asks for the server's access token (the NAS server, PRD §10). */
export function TokenPrompt(props: {
  readonly wrong: boolean;
  readonly onDone: (token: string | null) => void;
}) {
  const [token, setToken] = useState('');
  return (
    <Dialog
      title="Sign in to Taskite"
      onClose={() => props.onDone(null)}
      onSubmit={() => props.onDone(token.trim() || null)}
      actions={
        <>
          <button type="button" class="tk-button" onClick={() => props.onDone(null)}>
            Cancel
          </button>
          <button type="submit" class="tk-button tk-button-primary">
            Sign In
          </button>
        </>
      }
    >
      <p>This server needs its access token (TASKITE_TOKEN).</p>
      {props.wrong && <p class="tk-error-text">That token didn't work.</p>}
      <label class="tk-field">
        <span>Access token</span>
        <input
          type="password"
          autocomplete="current-password"
          value={token}
          onInput={(e) => setToken((e.target as HTMLInputElement).value)}
        />
      </label>
    </Dialog>
  );
}
