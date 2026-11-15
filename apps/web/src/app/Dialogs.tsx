import { useState } from 'preact/hooks';
import {
  INBOX_ID,
  PROJECT_COLORS,
  PROJECT_COLOR_NAMES,
  RECURRENCES,
  RECURRENCE_LABELS,
  plural,
  type Priority,
  type ProjectColor,
  type Recurrence,
  type Theme,
} from '@taskite/core';
import { Dialog, Icon, ListPopup, filterEntries, isMac, type CommandCatalog } from '@taskite/ui';
import { CommandMenu } from './CommandMenu.tsx';
import type { AppController } from './controller.ts';
import { duePreview, parseDueText, parseLabels } from './forms.ts';
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

/** The task editor (PRD §9.1). Saving is one undo step. */
function TaskEditor({ app, id }: { readonly app: AppController; readonly id: string }) {
  const task = app.list.getTask(id);
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [due, setDue] = useState(task?.due ?? '');
  const [recurrence, setRecurrence] = useState<Recurrence | ''>(task?.recurrence ?? '');
  const [priority, setPriority] = useState<Priority>(task?.priority ?? 4);
  const [projectId, setProjectId] = useState(task?.projectId ?? INBOX_ID);
  const [labels, setLabels] = useState(task?.labels.join(', ') ?? '');
  const [subtask, setSubtask] = useState('');
  void app.rev.value;
  if (!task) return null;
  const subtasks = app.list.getSubtasks(task.id);
  const save = () => {
    if (!title.trim()) return;
    app.saveTask(task.id, {
      title: title.trim(),
      description: description.trim(),
      due: due || null,
      recurrence: recurrence || null,
      priority,
      labels: parseLabels(labels),
      ...(task.parentId ? {} : { projectId }),
    });
    app.close();
  };
  return (
    <Dialog
      title={task.parentId ? 'Edit subtask' : 'Edit task'}
      class="tk-dialog-wide"
      onClose={() => app.close()}
      onSubmit={save}
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
          <Actions app={app} save="Save" />
        </>
      }
    >
      <label class="tk-field">
        <span>Task name</span>
        <input required value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} />
      </label>
      <label class="tk-field">
        <span>Description</span>
        <textarea
          rows={3}
          placeholder="Notes, links, details…"
          value={description}
          onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)}
        />
      </label>
      <div class="tk-field-row">
        <label class="tk-field">
          <span>Due date</span>
          <input type="date" value={due} onInput={(e) => setDue((e.target as HTMLInputElement).value)} />
        </label>
        <label class="tk-field">
          <span>Repeat</span>
          <select
            value={recurrence}
            onChange={(e) => setRecurrence((e.target as HTMLSelectElement).value as Recurrence | '')}
          >
            <option value="">Doesn't repeat</option>
            {RECURRENCES.map((r) => (
              <option key={r} value={r}>
                {RECURRENCE_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
        <label class="tk-field">
          <span>Priority</span>
          <select
            value={String(priority)}
            onChange={(e) => setPriority(Number((e.target as HTMLSelectElement).value) as Priority)}
          >
            <option value="1">Priority 1 (urgent)</option>
            <option value="2">Priority 2 (high)</option>
            <option value="3">Priority 3 (medium)</option>
            <option value="4">Priority 4 (normal)</option>
          </select>
        </label>
      </div>
      <div class="tk-field-row">
        {!task.parentId && (
          <label class="tk-field">
            <span>Project</span>
            <select value={projectId} onChange={(e) => setProjectId((e.target as HTMLSelectElement).value)}>
              {app.list.data.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label class="tk-field tk-grow">
          <span>Labels</span>
          <input
            placeholder="e.g. errands, phone"
            value={labels}
            onInput={(e) => setLabels((e.target as HTMLInputElement).value)}
          />
          <small class="tk-muted">Separate labels with commas.</small>
        </label>
      </div>
      {!task.parentId && (
        <fieldset class="tk-subtasks">
          <legend>Subtasks</legend>
          <ul>
            {subtasks.map((s) => (
              <li key={s.id} class={s.completed ? 'tk-done' : undefined}>
                <label>
                  <input
                    type="checkbox"
                    checked={s.completed}
                    onChange={() => (s.completed ? app.list.reopenTasks(s.id) : app.list.completeTasks(s.id))}
                  />
                  <span>{s.title}</span>
                </label>
                <button
                  type="button"
                  class="tk-icon-button tk-small"
                  aria-label={`Move "${s.title}" to the Trash`}
                  onClick={() => app.list.deleteTasks(s.id)}
                >
                  <Icon name="x" />
                </button>
              </li>
            ))}
          </ul>
          <input
            placeholder="Add a subtask and press Enter"
            aria-label="New subtask"
            value={subtask}
            onInput={(e) => setSubtask((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.isComposing) {
                e.preventDefault();
                app.addSubtask(task.id, subtask);
                setSubtask('');
              }
            }}
          />
        </fieldset>
      )}
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
  return (
    <Dialog
      title="Your tasks changed somewhere else"
      onClose={() => undefined}
      actions={
        <>
          <button
            type="button"
            class="tk-button"
            onClick={() =>
              void s.reload().then((n) => notice(n ?? 'Loaded the tasks from the other change.'))
            }
          >
            Use Theirs
          </button>
          <button
            type="button"
            class="tk-button"
            onClick={() => void s.keepMine().then(() => app.say('Kept your tasks.'))}
          >
            Keep Mine
          </button>
          <button
            type="button"
            class="tk-button tk-button-primary"
            data-autofocus
            onClick={() =>
              void s
                .saveCopyAndReload()
                .then((name) => app.say(`Saved your version as ${name}, then loaded theirs.`))
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
