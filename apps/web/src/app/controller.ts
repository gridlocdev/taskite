/**
 * The app's state and every action the commands and components call. No DOM here: the components draw it
 * and the tests drive it in Node.
 */
import { batch, computed, signal, type Signal } from '@preact/signals';
import {
  INBOX_ID,
  addDays,
  addDraft,
  fallbackAfter,
  formatDue,
  parseQuickAdd,
  plural,
  rangeIds,
  resolveDraft,
  resolveView,
  sameView,
  stepId,
  todayISO,
  viewContent,
  visibleIds,
  type Priority,
  type Project,
  type ProjectSection,
  type ProjectColor,
  type Recurrence,
  type SavedView,
  type Task,
  type TaskPatch,
  type Theme,
  type View,
} from '@taskite/core';
import type { TaskSession } from '@taskite/ui';
import { stepOrder } from './forms.ts';

/** How long a checked-off row shows its tick before it leaves, and how long a leaving row fades (PRD §5.3). */
export const COMPLETE_MS = 350;
export const LEAVE_MS = 180;
/** How long a notice stays when it isn't an error. */
export const NOTICE_MS = 5000;

export interface NoticeAction {
  readonly label: string;
  readonly run: () => void;
  /** For an Undo: the list's step it belongs to; the action is dropped once the list moves past it. */
  readonly step?: number;
}

export interface Notice {
  readonly id: number;
  readonly text: string;
  readonly action: NoticeAction | null;
  /** Stays until acted on or replaced (errors). */
  readonly sticky: boolean;
  readonly tone: 'info' | 'error';
}

/** The one dialog that can be open (PRD §9). */
/** The task editor's unsaved text: save it, or ask whether there is any. */
export interface Draft {
  flush(): void;
  dirty(): boolean;
}

export type DialogState =
  | { readonly kind: 'task'; readonly id: string }
  | { readonly kind: 'due'; readonly ids: readonly string[] }
  | { readonly kind: 'project'; readonly id: string | null }
  | { readonly kind: 'label'; readonly name: string }
  /** Add Section (no id, after `after`) or Rename Section. */
  | {
      readonly kind: 'section';
      readonly projectId: string;
      readonly id: string | null;
      readonly after?: string;
    }
  | {
      readonly kind: 'confirm';
      readonly title: string;
      readonly message: string;
      readonly confirm: string;
      readonly run: () => void;
    }
  | { readonly kind: 'move'; readonly ids: readonly string[] }
  | { readonly kind: 'commands'; readonly query: string }
  | { readonly kind: 'settings' }
  | { readonly kind: 'about' }
  | { readonly kind: 'shortcuts' };

/** Which right-click menu is open (PRD §8). Its items are listed in `MENUS` in commands.ts. */
export type MenuKind = 'task' | 'list' | 'project' | 'label' | 'section' | 'completed' | 'trash' | 'projects';

/** What a sidebar menu acts on, when it isn't the view on screen. */
export type MenuTarget =
  | { readonly kind: 'project'; readonly id: string }
  | { readonly kind: 'label'; readonly name: string }
  | { readonly kind: 'section'; readonly projectId: string; readonly id: string };

export interface ContextMenuState {
  readonly x: number;
  readonly y: number;
  readonly kind: MenuKind;
  readonly target?: MenuTarget;
}

export interface ControllerOptions {
  readonly now?: () => number;
  /** Waits for an animation; tests pass one that doesn't. */
  readonly wait?: (ms: number) => Promise<void>;
  /** The app's version, for About. */
  readonly version?: string;
  /** Where the tasks file lives, for About and Settings. */
  readonly location?: string;
}

/** With no saved view, the app opens on Today (PRD §5.1). */
const DEFAULT_VIEW: View = { type: 'today' };

export class AppController {
  readonly session: TaskSession;
  readonly version: string;
  readonly location: string;
  readonly #now: () => number;
  readonly #wait: (ms: number) => Promise<void>;

  /** Bumped on every change to the task list, so computed values read it. */
  readonly rev = signal(0);
  readonly today: Signal<string>;
  readonly view = signal<View>(DEFAULT_VIEW);
  readonly search = signal('');
  readonly selected = signal<ReadonlySet<string>>(new Set());
  /** The row keyboard focus is on; Shift+arrows extend from `anchor` to it. */
  readonly cursor = signal<string | null>(null);
  #anchor: string | null = null;
  /** Where the add-task row is open: `end`, or `day:YYYY-MM-DD` in Upcoming. */
  readonly composer = signal<string | null>(null);
  readonly dialog = signal<DialogState | null>(null);
  readonly menu = signal<ContextMenuState | null>(null);
  readonly notice = signal<Notice | null>(null);
  /** Rows showing their tick before they leave. */
  readonly completing = signal<ReadonlySet<string>>(new Set());
  /** Rows fading out. */
  readonly leaving = signal<ReadonlySet<string>>(new Set());
  /** What the screen reader's live region says next. */
  readonly announcement = signal('');
  /** Bumped when the list should take keyboard focus (after a dialog or the composer closes). */
  readonly focusList = signal(0);
  /** Bumped to put the cursor in the search box. */
  readonly focusSearch = signal(0);

  #noticeId = 0;
  #noticeTimer: ReturnType<typeof setTimeout> | undefined;

  readonly theme = computed<Theme>(() => {
    void this.rev.value;
    return this.list.data.settings.theme;
  });

  /** The view on screen: Search while there's a query, and a gone project or label falls back to the Inbox. */
  readonly shown = computed<View>(() => {
    void this.rev.value;
    const q = this.search.value.trim();
    return q ? { type: 'search', query: q } : resolveView(this.list, this.view.value);
  });

  readonly content = computed(() => {
    void this.rev.value;
    return viewContent(this.list, this.shown.value, this.today.value);
  });

  readonly ids = computed(() => visibleIds(this.content.value));

  constructor(session: TaskSession, opts: ControllerOptions = {}) {
    this.session = session;
    this.#now = opts.now ?? Date.now;
    this.#wait = opts.wait ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.version = opts.version ?? '';
    this.location = opts.location ?? session.store.location();
    this.today = signal(todayISO(new Date(this.#now())));
    const last = session.list.data.settings.lastView;
    if (last) this.view.value = resolveView(session.list, last);
    session.list.onChange(() => {
      const notice = this.notice.peek();
      if (notice?.action?.step !== undefined && notice.action.step !== this.list.step)
        this.notice.value = { ...notice, action: null };
      // `ids` is computed from `rev`, so read before bumping it, it is still the rows shown before the change.
      const before = this.ids.peek();
      this.rev.value++;
      this.#pruneSelection(before);
    });
  }

  get list() {
    return this.session.list;
  }

  // ---------- Notices ----------

  /** Puts a message in the status bar (PRD §5.5). */
  say(text: string, opts: { action?: NoticeAction; sticky?: boolean; tone?: 'info' | 'error' } = {}): void {
    clearTimeout(this.#noticeTimer);
    const notice: Notice = {
      id: ++this.#noticeId,
      text,
      action: opts.action ?? null,
      sticky: opts.sticky ?? false,
      tone: opts.tone ?? 'info',
    };
    this.notice.value = notice;
    this.announcement.value = text;
    if (!notice.sticky) {
      this.#noticeTimer = setTimeout(() => {
        if (this.notice.peek()?.id === notice.id) this.notice.value = null;
      }, NOTICE_MS);
    }
  }

  /**
   * A notice with Undo, for the edit that just changed tasks. Its Undo goes away as soon as anything else
   * changes the tasks, so it can't take back a different change than the one it names.
   */
  sayUndoable(text: string): void {
    // An edit that changed nothing says nothing: there is nothing to undo, and Undo would take back the step before.
    if (!this.list.lastEditChanged) return;
    const step = this.list.step;
    this.say(text, {
      action: {
        label: 'Undo',
        step,
        run: () => {
          if (this.list.step === step) this.undo();
        },
      },
    });
  }

  dismissNotice(): void {
    clearTimeout(this.#noticeTimer);
    this.notice.value = null;
  }

  // ---------- Views ----------

  go(view: SavedView): void {
    batch(() => {
      this.search.value = '';
      this.composer.value = null;
      if (!sameView(view, this.view.peek())) {
        this.view.value = view;
        this.#select([]);
        this.cursor.value = null;
        this.#anchor = null;
      }
    });
    this.list.rememberView(view);
    this.announcement.value = this.title();
  }

  setSearch(query: string): void {
    batch(() => {
      this.search.value = query;
      this.composer.value = null;
      this.cursor.value = null;
      this.#anchor = null;
      this.#select([]);
    });
  }

  title(): string {
    const view = this.shown.value;
    switch (view.type) {
      case 'project':
        return this.list.getProject(view.id)?.name ?? 'Inbox';
      case 'label':
        return `@${view.name}`;
      case 'search':
        return `Search: ${view.query}`;
      default:
        return view.type[0]!.toUpperCase() + view.type.slice(1);
    }
  }

  /** Moves to the next day's date when the clock passes midnight (PRD §5.2). */
  tick(): void {
    const today = todayISO(new Date(this.#now()));
    if (today !== this.today.peek()) this.today.value = today;
  }

  // ---------- Choosing tasks ----------

  selectedIds(): string[] {
    const chosen = this.selected.value;
    return this.ids.value.filter((id) => chosen.has(id));
  }

  /** The chosen tasks, or the one under the cursor. */
  targetIds(): string[] {
    const ids = this.selectedIds();
    if (ids.length) return ids;
    const cursor = this.cursor.value;
    return cursor && this.ids.value.includes(cursor) ? [cursor] : [];
  }

  hasTargets(): boolean {
    return this.targetIds().length > 0;
  }

  /** One task chosen (Edit, which opens one task). */
  single(): Task | undefined {
    const ids = this.targetIds();
    return ids.length === 1 ? this.list.getTask(ids[0]!) : undefined;
  }

  #select(ids: readonly string[]): void {
    this.selected.value = new Set(ids);
  }

  /** A click on a row: alone, ⌘/Ctrl adds or removes it, Shift takes the range from the anchor (PRD §5.3). */
  click(id: string, how: { toggle?: boolean; range?: boolean } = {}): void {
    batch(() => {
      if (how.range && this.#anchor && this.ids.value.includes(this.#anchor)) {
        this.#select(rangeIds(this.ids.value, this.#anchor, id));
      } else if (how.toggle) {
        const next = new Set(this.selected.value);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        this.selected.value = next;
        this.#anchor = id;
      } else {
        this.#select([id]);
        this.#anchor = id;
      }
      this.cursor.value = id;
    });
    this.#announceSelection();
  }

  /** ↓ / ↑: moves to the next row, choosing it alone; with `extend`, grows the range from the anchor. */
  step(delta: 1 | -1, extend = false): void {
    const ids = this.ids.value;
    const from = this.cursor.value ?? (delta > 0 ? null : (ids[ids.length - 1] ?? null));
    const next =
      this.cursor.value === null ? (delta > 0 ? ids[0] : ids[ids.length - 1]) : stepId(ids, from, delta);
    if (!next) return;
    batch(() => {
      if (extend) {
        this.#anchor ??= this.cursor.value ?? next;
        this.#select(rangeIds(ids, this.#anchor, next));
      } else {
        this.#select([next]);
        this.#anchor = next;
      }
      this.cursor.value = next;
    });
    this.#announceSelection();
  }

  selectAll(): void {
    this.#select(this.ids.value);
    this.#announceSelection();
  }

  clearSelection(): void {
    batch(() => {
      this.#select([]);
      this.#anchor = null;
    });
  }

  #announceSelection(): void {
    const n = this.selected.value.size;
    if (n > 1) this.announcement.value = `${plural(n, 'task')} chosen`;
    else {
      const task = this.cursor.value ? this.list.getTask(this.cursor.value) : undefined;
      if (task) this.announcement.value = task.title;
    }
  }

  /** Drops ids that are no longer on screen after a change. */
  /**
   * After any change, keeps the choice, the cursor and the range's start on rows that are still shown. A
   * cursor whose row went (Clear Completed, an undone add, a change made elsewhere) moves to the nearest
   * row that was below it, else above.
   */
  #pruneSelection(before: readonly string[]): void {
    const ids = new Set(this.ids.peek());
    const chosen = this.selected.peek();
    batch(() => {
      if ([...chosen].some((id) => !ids.has(id)))
        this.selected.value = new Set([...chosen].filter((id) => ids.has(id)));
      if (this.#anchor && !ids.has(this.#anchor)) this.#anchor = null;
      const cursor = this.cursor.peek();
      if (cursor === null || ids.has(cursor)) return;
      const at = before.indexOf(cursor);
      const near = [...before.slice(at + 1), ...before.slice(0, Math.max(at, 0)).reverse()];
      const next = near.find((id) => ids.has(id)) ?? null;
      this.cursor.value = next;
      if (next && this.selected.peek().size === 0) this.#select([next]);
    });
  }

  /** Before rows leave the view, puts the cursor on the row that will take their place (PRD §5.3). */
  #fallBack(gone: readonly string[]): void {
    const goneSet = new Set(gone);
    const cursor = this.cursor.peek();
    const rest = [...this.selected.peek()].filter((id) => !goneSet.has(id));
    // Checking off a row outside the choice leaves the choice and the cursor alone.
    if (rest.length && cursor !== null && !goneSet.has(cursor)) {
      this.#select(rest);
      return;
    }
    const next = fallbackAfter(this.ids.peek(), goneSet);
    batch(() => {
      this.cursor.value = next;
      this.#anchor = next;
      this.#select(rest.length ? rest : next ? [next] : []);
    });
  }

  /**
   * Plays a row's way out before the change is made. Returns the ids still waiting afterwards: Undo during
   * the animation cancels it (the change it would undo hasn't happened yet).
   */
  async #leave(ids: readonly string[], mark: 'completing' | 'leaving', ms: number): Promise<string[]> {
    const sig = mark === 'completing' ? this.completing : this.leaving;
    sig.value = new Set([...sig.value, ...ids]);
    await this.#wait(ms);
    const still = ids.filter((id) => sig.peek().has(id));
    sig.value = new Set([...sig.value].filter((id) => !ids.includes(id)));
    return still;
  }

  // ---------- Adding ----------

  /** Where Add task opens in this view, or null when the view takes no new tasks. */
  defaultSlot(): string | null {
    const view = this.shown.value;
    if (view.type === 'upcoming') return `day:${this.today.value}`;
    if (view.type === 'completed' || view.type === 'trash' || view.type === 'search') return null;
    return 'end';
  }

  /** New Task: opens the add-task row here, or in the Inbox from a view that can't take one. */
  newTask(): void {
    this.menu.value = null;
    if (this.defaultSlot() === null) this.go({ type: 'project', id: INBOX_ID });
    this.composer.value = this.defaultSlot();
  }

  closeComposer(): void {
    this.composer.value = null;
    this.focusList.value++;
  }

  /** Adds what the add-task row holds. True when a task was added. */
  addTask(text: string, slot: string): boolean {
    const draft = resolveDraft(text, this.shown.value, slot, this.today.value);
    const { task, createdProject } = addDraft(this.list, draft);
    if (!task) return false;
    if (createdProject) this.sayUndoable(`Created new project "${createdProject.name}".`);
    else this.announcement.value = `Added "${task.title}".`;
    return true;
  }

  // ---------- Task actions ----------

  /** Space: checks off the chosen tasks, or un-checks them when they are all done. */
  async toggleComplete(ids: readonly string[] = this.targetIds()): Promise<void> {
    const live = ids.filter((id) => !this.completing.peek().has(id) && this.list.getTask(id));
    if (!live.length) return;
    if (live.every((id) => this.list.getTask(id)?.completed)) {
      this.list.reopenTasks(live);
      this.sayUndoable(live.length === 1 ? 'Task reopened.' : `${plural(live.length, 'task')} reopened.`);
      return;
    }
    const open = live.filter((id) => !this.list.getTask(id)?.completed);
    const type = this.shown.peek().type;
    if (type !== 'search' && type !== 'completed') this.#fallBack(open);
    const still = await this.#leave(open, 'completing', COMPLETE_MS);
    if (!still.length) return;
    const results = this.list.completeTasks(still, this.today.peek());
    const [first] = results;
    if (results.length === 1 && first) {
      const title = this.list.getTask(first.id)?.title ?? '';
      if (first.repeated && first.nextDue)
        this.sayUndoable(
          `Nice! "${title}" is next due ${formatDue(first.nextDue, this.today.peek()).toLowerCase()}.`,
        );
      else this.sayUndoable('Task completed.');
    } else if (results.length > 1) this.sayUndoable(`${plural(results.length, 'task')} completed.`);
  }

  edit(id: string | undefined = this.single()?.id): void {
    if (id) this.open({ kind: 'task', id });
  }

  /**
   * Changes a task from the editor (PRD §9.1): one undo step, or none when nothing differs. A repeating
   * task needs a date to repeat from, so repeating gives it today and clearing the date stops it repeating.
   */
  saveTask(id: string, patch: TaskPatch): void {
    const task = this.list.getTask(id);
    if (!task || task.deletedAt !== null) return;
    const next: TaskPatch = { ...patch };
    if (next.recurrence && !(next.due ?? task.due)) next.due = this.today.peek();
    if (next.due === null && task.recurrence && next.recurrence === undefined) next.recurrence = null;
    const changed = Object.fromEntries(
      Object.entries(next).filter(
        ([key, value]) => JSON.stringify(task[key as keyof typeof task]) !== JSON.stringify(value),
      ),
    ) as TaskPatch;
    if (Object.keys(changed).length) this.list.updateTasks(id, changed);
  }

  /** The editor's subtask field: Quick Add text (PRD §4.4). A #project is ignored: subtasks live with their parent. */
  addSubtask(parentId: string, text: string): void {
    if (!text.trim()) return;
    const parsed = parseQuickAdd(text, this.today.peek());
    this.list.addTask({
      title: parsed.title || text,
      parentId,
      due: parsed.due ?? (parsed.recurrence ? this.today.peek() : null),
      recurrence: parsed.recurrence,
      priority: parsed.priority ?? 4,
      labels: parsed.labels,
    });
  }

  setDue(ids: readonly string[], due: string | null): void {
    if (!ids.length) return;
    // A repeating task can't be without a date, so clearing the date stops it repeating.
    this.list.updateTasks(ids, due ? { due } : { due: null, recurrence: null });
    this.sayUndoable(
      due
        ? `${ids.length === 1 ? 'Due' : `${plural(ids.length, 'task')} due`} ${formatDue(due, this.today.peek()).toLowerCase()}.`
        : 'Date removed.',
    );
  }

  setPriority(ids: readonly string[], priority: Priority): void {
    if (!ids.length) return;
    this.list.updateTasks(ids, { priority });
    this.announcement.value = `Priority ${priority}`;
  }

  setRecurrence(ids: readonly string[], recurrence: Recurrence | null): void {
    this.list.updateTasks(ids, recurrence ? { recurrence } : { recurrence: null });
  }

  /** Moves tasks to a project; a subtask moved on its own leaves its parent. */
  moveTo(ids: readonly string[], projectId: string): void {
    const project = this.list.getProject(projectId);
    if (!ids.length || !project) return;
    const type = this.shown.peek();
    if (type.type === 'project' && type.id !== projectId) this.#fallBack(ids);
    this.list.batch(() => {
      for (const id of ids) {
        const task = this.list.getTask(id);
        if (task?.parentId && !ids.includes(task.parentId))
          this.list.updateTasks(id, { projectId, parentId: null });
        else this.list.updateTasks(id, { projectId });
      }
    });
    this.sayUndoable(
      ids.length === 1
        ? `Moved task to ${project.name}.`
        : `Moved ${plural(ids.length, 'task')} to ${project.name}.`,
    );
  }

  addLabel(ids: readonly string[], label: string): void {
    const tasks = ids.map((id) => this.list.getTask(id)).filter((t): t is Task => !!t);
    this.list.batch(() => {
      for (const t of tasks)
        if (!t.labels.some((l) => l.toLowerCase() === label.toLowerCase()))
          this.list.updateTasks(t.id, { labels: [...t.labels, label] });
    });
    this.sayUndoable(`Added @${label}.`);
  }

  async trash(ids: readonly string[] = this.targetIds()): Promise<void> {
    if (!ids.length) return;
    const first = this.list.getTask(ids[0]!);
    this.#fallBack(ids);
    const still = await this.#leave(ids, 'leaving', LEAVE_MS);
    if (!still.length) return;
    this.list.deleteTasks(still, this.#now());
    this.sayUndoable(
      still.length === 1 && first
        ? `Moved "${first.title}" to the Trash.`
        : `Moved ${plural(still.length, 'task')} to the Trash.`,
    );
  }

  restore(ids: readonly string[] = this.targetIds()): void {
    if (!ids.length) return;
    this.#fallBack(ids);
    this.list.restoreTasks(ids);
    this.sayUndoable(ids.length === 1 ? 'Task restored.' : `${plural(ids.length, 'task')} restored.`);
  }

  purge(ids: readonly string[] = this.targetIds()): void {
    if (!ids.length) return;
    this.confirm({
      title: ids.length === 1 ? 'Delete for good?' : `Delete ${plural(ids.length, 'task')} for good?`,
      message: "You can undo this until you close Taskite. After that it can't be brought back.",
      confirm: 'Delete for Good',
      run: () => {
        this.#fallBack(ids);
        this.list.purgeTasks(ids);
        this.sayUndoable('Deleted for good.');
      },
    });
  }

  emptyTrash(): void {
    const n = this.list.trashList().length;
    if (!n) return;
    this.confirm({
      title: 'Empty the Trash?',
      message: `${plural(n, 'task')} will be deleted for good.`,
      confirm: 'Empty Trash',
      run: () => {
        this.list.emptyTrash();
        this.sayUndoable('Trash emptied.');
      },
    });
  }

  clearCompleted(): void {
    if (!this.list.liveTasks().some((t) => t.completed)) return;
    this.list.clearCompleted();
    this.sayUndoable('Completed tasks moved to the Trash.');
  }

  /** Puts dragged rows in a new order (project views). */
  reorder(ids: readonly string[]): void {
    this.list.reorderTasks(ids);
  }

  /** Whether the chosen tasks can move up and down: only where the order is yours (PRD §4.5). */
  canMove(): boolean {
    return this.shown.value.type === 'project' && this.hasTargets();
  }

  /** Move Up / Move Down (⌥↑ / ⌥↓): the chosen tasks pass one neighbour (PRD §4.5). */
  moveChosen(delta: 1 | -1): void {
    if (!this.canMove()) return;
    const parentOf = (id: string) => this.list.getTask(id)?.parentId ?? null;
    const order = stepOrder(this.ids.value, parentOf, this.targetIds(), delta);
    if (!order) return;
    this.list.reorderTasks(order);
    this.announcement.value = delta < 0 ? 'Moved up.' : 'Moved down.';
  }

  /** Schedules tasks for today (dropping them on Today). */
  scheduleToday(ids: readonly string[]): void {
    if (!ids.length) return;
    this.list.updateTasks(ids, { due: this.today.peek() });
    this.sayUndoable('Scheduled for today.');
  }

  undo(): void {
    // A completion or trash still animating hasn't been made yet: Undo cancels it.
    if (this.completing.peek().size || this.leaving.peek().size) {
      this.completing.value = new Set();
      this.leaving.value = new Set();
      this.say('Undone.');
      return;
    }
    if (!this.list.canUndo) return;
    this.list.undo();
    this.say('Undone.');
  }

  redo(): void {
    if (!this.list.canRedo) return;
    this.list.redo();
    this.say('Redone.');
  }

  // ---------- Projects and labels ----------

  saveProject(id: string | null, name: string, color: ProjectColor): Project | null {
    const trimmed = name.trim();
    if (!trimmed) return null;
    if (id) {
      this.list.updateProject(id, { name: trimmed, color });
      return this.list.getProject(id) ?? null;
    }
    const project = this.list.addProject(trimmed, color);
    this.go({ type: 'project', id: project.id });
    this.sayUndoable(`Created new project "${project.name}".`);
    return project;
  }

  /** The project on screen, if it's one that can be edited (not the Inbox). */
  currentProject(): Project | undefined {
    const view = this.shown.value;
    return view.type === 'project' && view.id !== INBOX_ID ? this.list.getProject(view.id) : undefined;
  }

  currentLabel(): string | undefined {
    const view = this.shown.value;
    return view.type === 'label' ? view.name : undefined;
  }

  /** The project a project command acts on: the one right-clicked in the sidebar, else the one on screen. */
  projectTarget(): Project | undefined {
    const target = this.menu.value?.target;
    if (target?.kind === 'project')
      return target.id === INBOX_ID ? undefined : this.list.getProject(target.id);
    return this.currentProject();
  }

  /** The label a label command acts on: the one right-clicked in the sidebar, else the one on screen. */
  labelTarget(): string | undefined {
    const target = this.menu.value?.target;
    return target?.kind === 'label' ? target.name : this.currentLabel();
  }

  deleteProject(id: string): void {
    const project = this.list.getProject(id);
    if (!project || id === INBOX_ID) return;
    const n = this.list.liveTasks().filter((t) => t.projectId === id).length;
    this.confirm({
      title: `Delete "${project.name}"?`,
      message: n ? `Its ${plural(n, 'task')} will move to the Trash.` : 'It has no tasks.',
      confirm: 'Delete Project',
      run: () => {
        this.list.deleteProject(id, this.#now());
        this.go({ type: 'project', id: INBOX_ID });
        this.sayUndoable(`Deleted project "${project.name}".`);
      },
    });
  }

  /** Renames and recolours a label (PRD §4.7); a label on screen stays on screen under its new name. */
  editLabel(name: string, next: string, color: ProjectColor | null): void {
    const before = this.list.labelColor(name);
    const renamed = next.trim().replace(/^@/, '').replace(/\s+/g, '-');
    if (renamed === name && before === color) return;
    // Read before the edit: once the old name is gone, the view on screen falls back.
    const view = this.shown.peek();
    if (!this.list.editLabel(name, next, color)) return;
    if (view.type === 'label' && view.name.toLowerCase() === name.toLowerCase())
      this.go({ type: 'label', name: renamed });
    if (renamed !== name) this.sayUndoable(`Renamed @${name} to @${renamed}.`);
  }

  removeLabel(name: string): void {
    this.confirm({
      title: `Remove @${name}?`,
      message: 'The label comes off every task. The tasks stay.',
      confirm: 'Remove Label',
      run: () => {
        this.list.deleteLabel(name);
        this.go({ type: 'project', id: INBOX_ID });
        this.sayUndoable(`Removed @${name}.`);
      },
    });
  }

  // ---------- Sections (PRD §6) ----------

  /** The project on screen, the Inbox included. */
  shownProject(): Project | undefined {
    const view = this.shown.value;
    return view.type === 'project' ? this.list.getProject(view.id) : undefined;
  }

  /** The section a section command acts on: the one whose heading was right-clicked. */
  sectionTarget(): { readonly projectId: string; readonly section: ProjectSection } | undefined {
    const target = this.menu.value?.target;
    if (target?.kind !== 'section') return undefined;
    const section = this.list.getSection(target.projectId, target.id);
    return section ? { projectId: target.projectId, section } : undefined;
  }

  /** Adds a section (after `after`, else at the end) or renames one. */
  saveSection(projectId: string, id: string | null, name: string, after?: string): void {
    if (!name.trim()) return;
    if (id) {
      this.list.renameSection(projectId, id, name);
      return;
    }
    const section = this.list.addSection(projectId, name, after);
    if (section) this.announcement.value = `Added section "${section.name}".`;
  }

  deleteSection(projectId: string, id: string): void {
    const section = this.list.getSection(projectId, id);
    if (!section) return;
    const n = this.list.liveTasks().filter((t) => t.projectId === projectId && t.sectionId === id).length;
    this.confirm({
      title: `Delete "${section.name}"?`,
      message: n ? `Its ${plural(n, 'task')} will move to the Trash.` : 'It has no tasks.',
      confirm: 'Delete Section',
      run: () => {
        this.list.deleteSection(projectId, id, this.#now());
        this.sayUndoable(`Deleted section "${section.name}".`);
      },
    });
  }

  /** Shows the project on screen as a board, or back as a list. */
  setBoard(on: boolean): void {
    const project = this.shownProject();
    if (project) this.list.setProjectView(project.id, on ? 'board' : 'list');
  }

  /**
   * Drops dragged tasks into a section (undefined: above the first one) in the given order, as one undo
   * step. Subtasks dragged without their parent stay with it.
   */
  dropInto(dragged: readonly string[], sectionId: string | undefined, order: readonly string[] | null): void {
    const tops = dragged.filter((id) => !this.list.getTask(id)?.parentId);
    this.list.batch(() => {
      if (tops.length) this.list.updateTasks(tops, { sectionId });
      if (order) this.list.reorderTasks(order);
    });
  }

  /** Whether the chosen tasks can move to the next or previous section (⌥← ⌥→). */
  canMoveSection(): boolean {
    return !!this.shownProject()?.sections?.length && this.hasTargets();
  }

  /** ⌥← / ⌥→: the chosen tasks go to the end of the previous or next section (PRD §4.5). */
  moveChosenSection(delta: 1 | -1): void {
    const project = this.shownProject();
    if (!project || !this.canMoveSection()) return;
    const tops = [
      ...new Set(
        this.targetIds().map((id) => {
          const task = this.list.getTask(id);
          return task?.parentId ?? id;
        }),
      ),
    ];
    const first = this.list.getTask(tops[0] ?? '');
    if (!first) return;
    const keys = [undefined, ...(project.sections ?? []).map((s) => s.id)];
    const to = keys.indexOf(first.sectionId) + delta;
    if (to < 0 || to >= keys.length) return;
    const sectionId = keys[to];
    const order = [...this.ids.peek().filter((id) => !tops.includes(id)), ...tops];
    this.dropInto(tops, sectionId, order);
    const name = sectionId ? this.list.getSection(project.id, sectionId)?.name : null;
    this.announcement.value = name ? `Moved to ${name}.` : 'Moved out of sections.';
  }

  // ---------- Settings ----------

  setTheme(theme: Theme): void {
    this.list.updateSettings({ theme });
  }

  // ---------- Dialogs ----------

  /**
   * The open editor's typed text, which isn't in the task list until it's saved. Everything that closes
   * or replaces the editor saves it first: another dialog, Esc, a conflict, closing the window (PRD §9.1).
   */
  #draft: Draft | null = null;

  /** The editor registers its draft while it's open. */
  setDraft(draft: Draft | null): void {
    this.#draft = draft;
  }

  /** Saves the open editor's typed text, if any. */
  flushDraft(): void {
    this.#draft?.flush();
  }

  /** Whether the open editor holds typed text not yet saved. Changes from elsewhere wait for it. */
  hasDraft(): boolean {
    return this.#draft?.dirty() ?? false;
  }

  open(dialog: DialogState): void {
    this.flushDraft();
    batch(() => {
      this.menu.value = null;
      this.dialog.value = dialog;
    });
  }

  close(): void {
    this.flushDraft();
    this.dialog.value = null;
    this.focusList.value++;
  }

  confirm(opts: { title: string; message: string; confirm: string; run: () => void }): void {
    this.open({ kind: 'confirm', ...opts });
  }

  /** Opens or closes a dialog that its own shortcut toggles (⌘K, ⌘/). */
  toggle(kind: 'commands' | 'shortcuts', query = ''): void {
    if (this.dialog.peek()?.kind === kind) this.close();
    else this.open(kind === 'commands' ? { kind, query } : { kind });
  }

  /** Commands only run with nothing in the way: no dialog, no save conflict (PRD §9). */
  blocked(): boolean {
    return this.dialog.value !== null || this.session.conflict.value !== null;
  }

  // ---------- Saving ----------

  /** Shows the save state in the status bar: failures stay with Try again (PRD §3.3). */
  saveStatusChanged(status: string): void {
    if (status === 'failed')
      this.say("Couldn't save your tasks.", {
        sticky: true,
        tone: 'error',
        action: { label: 'Try Again', run: () => this.session.retry() },
      });
    else if (status === 'saved' && this.notice.peek()?.tone === 'error') this.say('Saved.');
  }

  /** The next day after `today`, for the due dialog's quick buttons. */
  tomorrow(): string {
    return addDays(this.today.value, 1);
  }
}
