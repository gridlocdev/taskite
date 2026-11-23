/**
 * The task list engine: every edit to tasks, projects and labels, with undo (PRD §4, §6). It holds the
 * data in memory and tells listeners after each change; saving is the caller's job.
 */
import { attachmentIds, cleanAttachments, type Attachment } from './attachments.ts';
import {
  addDoneRules,
  automationDueDate,
  cleanAutomations,
  isDoneName,
  renameLabelInRules,
  type AutomationRun,
  type AutomationTrigger,
  type SectionAutomation,
} from './automations.ts';
import { firstDayOfWeek, nextOccurrence, parseISODate, todayISO } from './dates.ts';
import {
  INBOX_ID,
  PROJECT_COLOR_NAMES,
  expiredTaskIds,
  pruneAutomations,
  type AppData,
  type Project,
  type ProjectSection,
  type ProjectColor,
  type SavedView,
  type Settings,
  type Task,
} from './model.ts';

/** How many steps Undo can go back (PRD §4.7). */
export const MAX_HISTORY = 100;

/** `edit`: an undo step, an undo or a redo. `settings`: saved but not an undo step. `load`: new data replaced it all. */
/**
 * `load` and `outside` came from the file, so there is nothing to save. `view`: a step that changes only what an
 * editor shows (`mark`), or its undo or redo; the data is as it was, so there is nothing to save either.
 */
export type ChangeKind = 'edit' | 'settings' | 'load' | 'outside' | 'view';

/**
 * One undo step: the data before it, or null for a step that changed only what an editor shows. `mark` is what
 * that editor needs to take the step back or make it again; the engine only carries it.
 */
interface Step {
  readonly data: AppData | null;
  mark?: unknown;
}

export interface CompleteResult {
  id: string;
  repeated: boolean;
  nextDue: string | null;
}

/** Attachments come and go only through addAttachments and removeAttachment, which keep their ids unique. */
export type NewTask = Partial<Omit<Task, 'id' | 'title' | 'attachments'>> & { title: string };
export type TaskPatch = Partial<Omit<Task, 'id' | 'attachments'>>;

export interface TaskListOptions {
  /** Clock, for tests. */
  now?: () => number;
  /** Id maker, for tests. */
  newId?: () => string;
  /** The day weeks start on (0 = Sunday), for automations that date a task next week. The locale's by default. */
  weekStart?: number;
}

/** Something that sets off a section's rules: a task entering it, leaving it, or being completed in it (PRD §6.1). */
interface Trigger {
  task: Task;
  on: AutomationTrigger;
  projectId: string;
  sectionId: string;
}

type Ids = string | readonly string[];

function toList(ids: Ids): readonly string[] {
  return typeof ids === 'string' ? [ids] : ids;
}

/** Sets or clears a label's colour in `data`; true when it changed. */
function setColor(data: AppData, label: string, color: ProjectColor | null): boolean {
  const key = labelKey(label);
  const colors = data.labelColors ?? {};
  if ((colors[key] ?? null) === color) return false;
  if (color) colors[key] = color;
  else delete colors[key];
  if (Object.keys(colors).length) data.labelColors = colors;
  else delete data.labelColors;
  return true;
}

function labelKey(label: string): string {
  return label.toLowerCase();
}

/** Whether a task has a label, ignoring case. */
export function hasLabel(task: Pick<Task, 'labels'>, label: string): boolean {
  return task.labels.some((l) => labelKey(l) === labelKey(label));
}

/** The key Quick Add's "#Project" matches on: ignores case, spaces, "-" and "_" (PRD §4.2). */
export function projectKey(name: string): string {
  return name.toLowerCase().replace(/[\s_-]+/g, '');
}

interface Lookup {
  readonly tasks: readonly Task[];
  readonly byId: Map<string, Task>;
  readonly children: Map<string, Task[]>;
}

/** Deletes tasks for good; their subtasks become tasks of their own. */
function removeTasks(data: AppData, ids: ReadonlySet<string>): void {
  if (!ids.size) return;
  data.tasks = data.tasks.filter((t) => !ids.has(t.id));
  for (const t of data.tasks) if (t.parentId && ids.has(t.parentId)) t.parentId = null;
}

/** Where a task sits, as one string to compare. */
/**
 * What a task's move sets off: leaving the section it was in, then entering the one it's in now. Nothing when
 * it stayed where it was.
 */
function moveTriggers(task: Task, from: { projectId: string; sectionId?: string | undefined }): Trigger[] {
  if (from.projectId === task.projectId && from.sectionId === task.sectionId) return [];
  const triggers: Trigger[] = [];
  if (from.sectionId)
    triggers.push({ task, on: 'leave', projectId: from.projectId, sectionId: from.sectionId });
  if (task.sectionId)
    triggers.push({ task, on: 'enter', projectId: task.projectId, sectionId: task.sectionId });
  return triggers;
}

/** Whether an edit changed anything: an edit that leaves the data as it was records no undo step. */
function sameData(a: AppData, b: AppData): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export class TaskList {
  #data: AppData;
  #undo: Step[] = [];
  #redo: Step[] = [];
  #listeners = new Set<(kind: ChangeKind) => void>();
  #now: () => number;
  #newId: () => string;
  #batching = false;
  #batchChanged = false;
  #step = 0;
  #index: Lookup | null = null;
  #changing = false;
  #lastEditChanged = false;
  #weekStart: number | undefined;
  #automated: AutomationRun[] = [];

  constructor(data: AppData, options: TaskListOptions = {}) {
    this.#data = data;
    this.#now = options.now ?? Date.now;
    this.#newId = options.newId ?? (() => crypto.randomUUID());
    this.#weekStart = options.weekStart;
  }

  /** What automations changed in the last edit (empty when none ran), for its notice (PRD §6.1). */
  get automated(): readonly AutomationRun[] {
    return this.#automated;
  }

  /** The live data. Treat it as read-only; change it through the methods. */
  get data(): AppData {
    return this.#data;
  }

  /** Calls `fn` after every change. Returns a function that stops it. */
  onChange(fn: (kind: ChangeKind) => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  #emit(kind: ChangeKind): void {
    this.#index = null;
    if (kind !== 'settings') this.#step++;
    for (const fn of this.#listeners) fn(kind);
  }

  /** Replaces all data (a reload) and clears undo. */
  replace(data: AppData): void {
    this.#data = data;
    this.#undo = [];
    this.#redo = [];
    this.#emit('load');
  }

  /**
   * Takes the file's data after it changed somewhere else (PRD §3.4), as one undo step: Undo puts back
   * what this window showed. Older steps are dropped, so Undo can't quietly take back the other change
   * along with one of this window's. Settings stay this window's.
   */
  takeOutside(data: AppData): void {
    this.#undo = [{ data: structuredClone(this.#data) }];
    this.#redo = [];
    this.#data = { ...data, settings: this.#data.settings };
    this.#lastEditChanged = true;
    this.#emit('outside');
  }

  /** Runs `change` on the data as one undo step. Nothing is recorded if it returns false. */
  #edit(change: (data: AppData) => boolean | void): void {
    if (this.#batching) {
      if (this.#run(change) !== false) this.#batchChanged = true;
      return;
    }
    const before = structuredClone(this.#data);
    this.#automated = [];
    if (this.#run(change) === false || sameData(before, this.#data)) {
      this.#lastEditChanged = false;
      return;
    }
    this.#record(before);
  }

  /** Runs an edit's change with the lookup tables off, since the change moves tasks under them. */
  #run(change: (data: AppData) => boolean | void): boolean | void {
    const outer = this.#changing;
    this.#changing = true;
    this.#index = null;
    try {
      return change(this.#data);
    } finally {
      this.#changing = outer;
      this.#index = null;
    }
  }

  #record(before: AppData): void {
    this.#lastEditChanged = true;
    this.#push({ data: before });
    this.#emit('edit');
  }

  #push(step: Step): void {
    this.#undo.push(step);
    if (this.#undo.length > MAX_HISTORY) this.#undo.shift();
    this.#redo = [];
  }

  /** Runs several edits as one undo step. */
  batch<T>(fn: () => T): T {
    if (this.#batching) return fn();
    const before = structuredClone(this.#data);
    this.#automated = [];
    this.#batching = true;
    this.#batchChanged = false;
    try {
      return fn();
    } finally {
      this.#batching = false;
      if (this.#batchChanged && !sameData(before, this.#data)) this.#record(before);
      else this.#lastEditChanged = false;
    }
  }

  // ---------- Undo ----------

  /**
   * Goes up with every change to the tasks, undo and redo included (not settings). A notice that offers
   * Undo remembers it, so its Undo only ever takes back the change it announced.
   */
  get step(): number {
    return this.#step;
  }

  /** False when the last edit left everything as it was (and so recorded no undo step). */
  get lastEditChanged(): boolean {
    return this.#lastEditChanged;
  }

  get canUndo(): boolean {
    return this.#undo.length > 0;
  }

  get canRedo(): boolean {
    return this.#redo.length > 0;
  }

  /**
   * Records an undo step that changes only what an editor shows, such as a field it added (PRD §4.7). Undo and
   * Redo hand `mark` back to the editor, which puts its fields as they were.
   */
  mark(mark: unknown): void {
    this.#push({ data: null, mark });
    this.#emit('view');
  }

  /**
   * Adds `mark` to the last undo step, so Undo takes back what the editor showed along with the change. False
   * when the last step has no data to go with it; the caller records `mark` on its own then.
   */
  markLast(mark: unknown): boolean {
    const last = this.#undo.at(-1);
    if (!last?.data || !this.#lastEditChanged) return false;
    last.mark = mark;
    return true;
  }

  /** Forgets every mark, once the editor they belong to has closed: steps that only held one go. */
  dropMarks(): void {
    const strip = (steps: Step[]): Step[] => steps.filter((s) => s.data).map((s) => ({ data: s.data }));
    this.#undo = strip(this.#undo);
    this.#redo = strip(this.#redo);
  }

  /**
   * Goes back one change. Settings stay as they are (PRD §4.7). Returns the step's mark, for the editor that
   * made it.
   */
  undo(): unknown {
    this.#automated = [];
    const previous = this.#undo.pop();
    if (!previous) return undefined;
    this.#redo.push(this.#swap(previous));
    this.#emit(previous.data ? 'edit' : 'view');
    return previous.mark;
  }

  /** Makes the change Undo took back. Returns the step's mark, as `undo` does. */
  redo(): unknown {
    this.#automated = [];
    const next = this.#redo.pop();
    if (!next) return undefined;
    this.#undo.push(this.#swap(next));
    this.#emit(next.data ? 'edit' : 'view');
    return next.mark;
  }

  /** Puts `step`'s data in place and returns the step that goes back to what was there. */
  #swap(step: Step): Step {
    if (!step.data) return { data: null, mark: step.mark };
    const back: Step = { data: structuredClone(this.#data), mark: step.mark };
    this.#data = { ...step.data, settings: this.#data.settings };
    return back;
  }

  // ---------- Reading tasks ----------

  getTask(id: string): Task | undefined {
    if (this.#changing) return this.#data.tasks.find((t) => t.id === id);
    return this.#lookup().byId.get(id);
  }

  /**
   * Tasks by id and live subtasks by parent, so a view with thousands of rows doesn't scan every task for
   * each one. Built on first use after a change; while an edit runs, lookups scan the tasks instead.
   */
  #lookup(): Lookup {
    if (this.#index?.tasks === this.#data.tasks) return this.#index;
    const byId = new Map<string, Task>();
    const children = new Map<string, Task[]>();
    for (const t of this.#data.tasks) {
      byId.set(t.id, t);
      if (t.parentId && t.deletedAt === null) {
        const list = children.get(t.parentId);
        if (list) list.push(t);
        else children.set(t.parentId, [t]);
      }
    }
    for (const list of children.values()) list.sort((a, b) => a.order - b.order);
    this.#index = { tasks: this.#data.tasks, byId, children };
    return this.#index;
  }

  /** Every task not in the Trash. */
  liveTasks(): Task[] {
    return this.#data.tasks.filter((t) => t.deletedAt === null);
  }

  /** Every open task not in the Trash. */
  activeTasks(): Task[] {
    return this.#data.tasks.filter((t) => t.deletedAt === null && !t.completed);
  }

  /** Every task in the Trash, most recently deleted first. */
  trashedTasks(): Task[] {
    return this.#data.tasks
      .filter((t) => t.deletedAt !== null)
      .sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));
  }

  /**
   * The Trash as listed: top-level tasks, and subtasks whose parent isn't trashed (PRD §4.6), or is gone
   * altogether, so nothing in the Trash is out of sight.
   */
  trashList(): Task[] {
    return this.trashedTasks().filter((t) => {
      const parent = t.parentId ? this.getTask(t.parentId) : undefined;
      return !parent || parent.deletedAt === null;
    });
  }

  /** Subtasks not in the Trash, in order. */
  getSubtasks(parentId: string): Task[] {
    if (this.#changing)
      return this.#data.tasks
        .filter((t) => t.parentId === parentId && t.deletedAt === null)
        .sort((a, b) => a.order - b.order);
    return [...(this.#lookup().children.get(parentId) ?? [])];
  }

  // ---------- Changing tasks ----------

  /** Adds a task at the end of its project. A subtask always joins its parent's project. */
  addTask(fields: NewTask): Task {
    const parent = fields.parentId ? this.getTask(fields.parentId) : undefined;
    const projectId = parent?.projectId ?? fields.projectId ?? INBOX_ID;
    const task: Task = {
      id: this.#newId(),
      title: fields.title.trim(),
      description: fields.description ?? '',
      projectId,
      parentId: parent ? parent.id : null,
      labels: fields.labels ?? [],
      priority: fields.priority ?? 4,
      due: fields.due ?? null,
      recurrence: fields.recurrence ?? null,
      completed: false,
      completedAt: null,
      createdAt: this.#now(),
      order: 0,
      deletedAt: null,
    };
    const sectionId = parent ? parent.sectionId : fields.sectionId;
    if (sectionId && this.getSection(projectId, sectionId)) task.sectionId = sectionId;
    this.#edit((data) => {
      const orders = data.tasks.filter((t) => t.projectId === projectId).map((t) => t.order);
      task.order = Math.max(-1, ...orders) + 1;
      data.tasks.push(task);
      if (!parent && task.sectionId)
        this.#automate([{ task, on: 'enter', projectId, sectionId: task.sectionId }]);
    });
    return task;
  }

  /**
   * Changes fields on tasks as one undo step. Subtasks follow their parent's project and section, and a
   * subtask moved to another project or section by itself leaves its parent. A task
   * that moves to another project leaves its section unless the patch names one there; `sectionId:
   * undefined` takes a task out of its section.
   */
  updateTasks(ids: Ids, patch: TaskPatch): void {
    const tasks = toList(ids)
      .map((id) => this.getTask(id))
      .filter((t) => t !== undefined);
    if (!tasks.length) return;
    const { sectionId, ...fields } = patch;
    const setsSection = 'sectionId' in patch;
    this.#edit(() => {
      const was = new Map(tasks.map((t) => [t, { projectId: t.projectId, sectionId: t.sectionId }]));
      for (const task of tasks) {
        const moved = fields.projectId !== undefined && fields.projectId !== task.projectId;
        // A date or repeat set by hand starts a new day of the month.
        const redated =
          (fields.due !== undefined && fields.due !== task.due) ||
          (fields.recurrence !== undefined && fields.recurrence !== task.recurrence);
        const { projectId, ...rest } = fields;
        Object.assign(task, rest);
        if (redated) delete task.repeatDay;
        if (setsSection || moved) this.#place(task, projectId ?? task.projectId, sectionId ?? null);
      }
      // A subtask moved away from its parent on its own leaves it (PRD §6).
      for (const task of tasks) {
        const parent = task.parentId ? this.getTask(task.parentId) : undefined;
        if (parent && (parent.projectId !== task.projectId || parent.sectionId !== task.sectionId))
          task.parentId = null;
      }
      this.#automate(
        tasks.filter((t) => !t.parentId && t.deletedAt === null).flatMap((t) => moveTriggers(t, was.get(t)!)),
      );
    });
  }

  /**
   * Puts a task in a project and section (or the project's top when the section isn't there), with its
   * subtasks. Subtasks in the Trash move too, so a restored one comes back beside its parent.
   */
  #place(task: Task, projectId: string, sectionId: string | null): void {
    task.projectId = projectId;
    if (sectionId && this.getSection(projectId, sectionId)) task.sectionId = sectionId;
    else delete task.sectionId;
    for (const sub of this.#data.tasks.filter((t) => t.parentId === task.id)) {
      sub.projectId = task.projectId;
      if (task.sectionId) sub.sectionId = task.sectionId;
      else delete sub.sectionId;
    }
  }

  /** Checks tasks off as one undo step; a repeating task with a date moves to its next date (PRD §4.3). */
  completeTasks(ids: Ids, today: string = todayISO()): CompleteResult[] {
    const tasks = toList(ids)
      .map((id) => this.getTask(id))
      .filter((t): t is Task => t !== undefined && !t.completed);
    if (!tasks.length) return [];
    const results: CompleteResult[] = [];
    this.#edit(() => {
      const now = this.#now();
      for (const task of tasks) results.push(this.#completeOne(task, now, today));
      this.#automate(
        tasks
          .filter((t) => t.completed && !t.parentId && t.sectionId)
          .map((t) => ({
            task: t,
            on: 'complete' as const,
            projectId: t.projectId,
            sectionId: t.sectionId ?? '',
          })),
        today,
      );
    });
    return results;
  }

  /** Checks one open task off, or moves a repeating one to its next date (PRD §4.3). */
  #completeOne(task: Task, now: number, today: string): CompleteResult {
    if (task.recurrence && task.due) {
      const day = task.repeatDay ?? parseISODate(task.due).getDate();
      task.due = nextOccurrence(task.due, task.recurrence, today, day);
      // Remember the day only while a short month has moved the date off it.
      const monthly = task.recurrence === 'monthly' || task.recurrence === 'yearly';
      if (monthly && parseISODate(task.due).getDate() !== day) task.repeatDay = day;
      else delete task.repeatDay;
      return { id: task.id, repeated: true, nextDue: task.due };
    }
    task.completed = true;
    task.completedAt = now;
    for (const sub of this.getSubtasks(task.id)) {
      if (!sub.completed) Object.assign(sub, { completed: true, completedAt: now });
    }
    return { id: task.id, repeated: false, nextDue: null };
  }

  /**
   * Runs the rules the triggers set off, inside the edit that caused them (PRD §6.1). A rule that moves a task
   * into another section, or completes it, sets off that section's rules in turn, but each section and
   * trigger runs at most once per task, so rules can't loop.
   */
  #automate(triggers: readonly Trigger[], today: string = todayISO(new Date(this.#now()))): void {
    const queue = [...triggers];
    const seen = new Map<Task, Set<string>>();
    const now = this.#now();
    for (let next = queue.shift(); next; next = queue.shift()) {
      const { task, on, projectId, sectionId } = next;
      const done = seen.get(task) ?? new Set<string>();
      seen.set(task, done);
      const key = `${on} ${projectId}/${sectionId}`;
      if (done.has(key)) continue;
      done.add(key);
      const rules = this.getSection(projectId, sectionId)?.automations ?? [];
      for (const rule of rules) {
        if (rule.on !== on) continue;
        for (const action of rule.do) {
          if (task.deletedAt !== null) break;
          const from = { projectId: task.projectId, sectionId: task.sectionId };
          const changed = this.#apply(task, action, now, today);
          if (!changed) continue;
          this.#automated.push({ taskId: task.id, projectId, sectionId, action });
          if ('moveTo' in action) queue.push(...moveTriggers(task, from));
          if ('complete' in action && task.completed && task.sectionId)
            queue.push({ task, on: 'complete', projectId: task.projectId, sectionId: task.sectionId });
        }
      }
    }
  }

  /** Does one action to a task. Says whether it changed anything. */
  #apply(task: Task, action: SectionAutomation['do'][number], now: number, today: string): boolean {
    const before = JSON.stringify(task);
    if ('complete' in action) {
      if (action.complete && !task.completed) this.#completeOne(task, now, today);
      if (!action.complete && task.completed) Object.assign(task, { completed: false, completedAt: null });
    } else if ('due' in action) {
      const due = automationDueDate(action.due, today, this.#weekStart ?? firstDayOfWeek());
      if (due !== task.due) {
        task.due = due;
        delete task.repeatDay;
      }
    } else if ('priority' in action) {
      task.priority = action.priority;
    } else if ('addLabel' in action) {
      if (!hasLabel(task, action.addLabel)) task.labels = [...task.labels, action.addLabel];
    } else if ('removeLabel' in action) {
      task.labels = task.labels.filter((l) => labelKey(l) !== labelKey(action.removeLabel));
    } else {
      const { projectId, sectionId } = action.moveTo;
      if (this.getProject(projectId)) this.#place(task, projectId, sectionId);
    }
    return JSON.stringify(task) !== before;
  }

  /**
   * Runs a section's "enters" rules on the tasks already in it, as one undo step: what the editor's "Apply to
   * the N tasks already here?" does (PRD §6.1).
   */
  applyEnterRules(projectId: string, sectionId: string): void {
    if (!this.getSection(projectId, sectionId)?.automations?.some((r) => r.on === 'enter')) return;
    const tasks = this.openTasksIn(projectId, sectionId);
    if (!tasks.length) return;
    this.#edit(() => {
      this.#automate(tasks.map((task) => ({ task, on: 'enter' as const, projectId, sectionId })));
    });
  }

  /** The open top-level tasks in a section: the ones "Apply to the N tasks already here?" counts and runs on. */
  openTasksIn(projectId: string, sectionId: string): Task[] {
    return this.#data.tasks.filter(
      (t) =>
        t.deletedAt === null &&
        !t.completed &&
        !t.parentId &&
        t.projectId === projectId &&
        t.sectionId === sectionId,
    );
  }

  /** Un-checks tasks, and their parents so they show again. */
  reopenTasks(ids: Ids): void {
    const tasks = toList(ids)
      .map((id) => this.getTask(id))
      .filter((t): t is Task => t !== undefined && t.completed);
    if (!tasks.length) return;
    this.#edit(() => {
      for (const task of tasks) {
        task.completed = false;
        task.completedAt = null;
        const parent = task.parentId ? this.getTask(task.parentId) : undefined;
        if (parent?.completed) Object.assign(parent, { completed: false, completedAt: null });
      }
    });
  }

  /** Moves tasks and their subtasks to the Trash. */
  deleteTasks(ids: Ids, now: number = this.#now()): void {
    const idSet = new Set(toList(ids));
    const tasks = this.#data.tasks.filter(
      (t) => t.deletedAt === null && (idSet.has(t.id) || (t.parentId !== null && idSet.has(t.parentId))),
    );
    if (!tasks.length) return;
    this.#edit(() => {
      for (const task of tasks) task.deletedAt = now;
    });
  }

  /**
   * Takes tasks out of the Trash with the subtasks deleted alongside them. Restoring a subtask restores
   * its parent; a task whose project is gone goes to the Inbox (PRD §4.6).
   */
  restoreTasks(ids: Ids): void {
    const toRestore = new Set<Task>();
    for (const id of toList(ids)) {
      const task = this.getTask(id);
      if (!task || task.deletedAt === null) continue;
      toRestore.add(task);
      for (const sub of this.#data.tasks) {
        if (sub.parentId === task.id && sub.deletedAt === task.deletedAt) toRestore.add(sub);
      }
      const parent = task.parentId ? this.getTask(task.parentId) : undefined;
      if (parent && parent.deletedAt !== null) toRestore.add(parent);
    }
    if (!toRestore.size) return;
    this.#edit(() => {
      for (const task of toRestore) {
        task.deletedAt = null;
        if (!this.getProject(task.projectId)) task.projectId = INBOX_ID;
        if (task.sectionId && !this.getSection(task.projectId, task.sectionId)) delete task.sectionId;
      }
      // A subtask always sits in its parent's project and section (PRD §6).
      for (const task of toRestore) {
        const parent = task.parentId ? this.getTask(task.parentId) : undefined;
        if (!parent) {
          // Its parent is gone for good (hand-edited data): it comes back as a task of its own.
          task.parentId = null;
          continue;
        }
        task.projectId = parent.projectId;
        if (parent.sectionId) task.sectionId = parent.sectionId;
        else delete task.sectionId;
      }
    });
  }

  /** Deletes tasks in the Trash for good. Undo still works right after. */
  purgeTasks(ids: Ids): void {
    const idSet = new Set(toList(ids).filter((id) => this.getTask(id)?.deletedAt != null));
    if (!idSet.size) return;
    this.#edit((data) => {
      // A subtask goes with its parent only when it's in the Trash too; a live one was restored on its own.
      data.tasks = data.tasks.filter(
        (t) => !idSet.has(t.id) && !(t.parentId && idSet.has(t.parentId) && t.deletedAt !== null),
      );
      for (const t of data.tasks) if (t.parentId && idSet.has(t.parentId)) t.parentId = null;
    });
  }

  emptyTrash(): void {
    this.purgeTasks(this.trashedTasks().map((t) => t.id));
  }

  /** Moves every completed task to the Trash. */
  clearCompleted(): void {
    this.deleteTasks(
      this.liveTasks()
        .filter((t) => t.completed)
        .map((t) => t.id),
    );
  }

  /** Sets the order of tasks to match the list. */
  reorderTasks(orderedIds: readonly string[]): void {
    this.#edit(() => {
      orderedIds.forEach((id, index) => {
        const task = this.getTask(id);
        if (task) task.order = index;
      });
    });
  }

  /**
   * Removes tasks that have been in the Trash too long, with no undo step (PRD §3.2). They leave the undo
   * and redo history too, so Undo can't bring back a task that is gone for good.
   * Returns whether anything was removed.
   */
  purgeExpired(now: number = this.#now()): boolean {
    for (const { data } of [...this.#undo, ...this.#redo])
      if (data) removeTasks(data, expiredTaskIds(data, now));
    const ids = expiredTaskIds(this.#data, now);
    if (!ids.size) return false;
    removeTasks(this.#data, ids);
    this.#emit('settings');
    return true;
  }

  // ---------- Attachments ----------

  /**
   * Attaches files whose bytes are already stored under their ids (PRD §4.8), as one undo step. Ids that
   * aren't UUIDs or that a task already names are left out, and a task in the Trash takes none. Returns
   * what was attached.
   */
  addAttachments(taskId: string, attachments: readonly Attachment[]): Attachment[] {
    const task = this.getTask(taskId);
    if (!task || task.deletedAt !== null) return [];
    const added = cleanAttachments(attachments, attachmentIds(this.#data));
    if (!added.length) return [];
    this.#edit(() => {
      task.attachments = [...(task.attachments ?? []), ...added];
    });
    return added;
  }

  /** Takes an attachment off its task, as one undo step. Its file stays until no task names it (PRD §4.8). */
  removeAttachment(taskId: string, attachmentId: string): void {
    const task = this.getTask(taskId);
    if (!task?.attachments?.some((a) => a.id === attachmentId)) return;
    this.#edit(() => {
      const left = task.attachments!.filter((a) => a.id !== attachmentId);
      if (left.length) task.attachments = left;
      else delete task.attachments;
    });
  }

  // ---------- Projects ----------

  getProject(id: string): Project | undefined {
    return this.#data.projects.find((p) => p.id === id);
  }

  findProjectByName(name: string): Project | undefined {
    return this.#data.projects.find((p) => projectKey(p.name) === projectKey(name));
  }

  /** The colour a project made from Quick Add gets: the next one in turn, never gray. */
  nextProjectColor(): ProjectColor {
    const colors = PROJECT_COLOR_NAMES.filter((c) => c !== 'gray');
    return colors[this.#data.projects.length % colors.length] ?? 'blue';
  }

  addProject(name: string, color: ProjectColor = 'blue'): Project {
    const project: Project = { id: this.#newId(), name: name.trim(), color };
    this.#edit((data) => {
      data.projects.push(project);
    });
    return project;
  }

  updateProject(id: string, patch: Partial<Omit<Project, 'id'>>): void {
    const project = this.getProject(id);
    if (!project) return;
    this.#edit(() => {
      Object.assign(project, patch);
    });
  }

  /**
   * Deletes a project and moves its tasks to the Trash. They belong to the Inbox from then on, where Restore
   * puts them and where the file would load them (PRD §3.2, §4.6). The Inbox can't be deleted.
   */
  deleteProject(id: string, now: number = this.#now()): void {
    if (id === INBOX_ID || !this.getProject(id)) return;
    this.#edit((data) => {
      data.projects = data.projects.filter((p) => p.id !== id);
      for (const task of data.tasks) {
        if (task.projectId !== id) continue;
        if (task.deletedAt === null) task.deletedAt = now;
        task.projectId = INBOX_ID;
        delete task.sectionId;
      }
      pruneAutomations(data.projects);
    });
  }

  // ---------- Sections ----------

  getSection(projectId: string, sectionId: string): ProjectSection | undefined {
    return this.getProject(projectId)?.sections?.find((s) => s.id === sectionId);
  }

  /** Adds a section at the end of a project, or after `afterId`. */
  addSection(projectId: string, name: string, afterId?: string): ProjectSection | undefined {
    const project = this.getProject(projectId);
    const trimmed = name.trim();
    if (!project || !trimmed) return undefined;
    const section: ProjectSection = { id: this.#newId(), name: trimmed };
    this.#edit(() => {
      this.#doneRules(section);
      const sections = project.sections ?? [];
      const at = afterId ? sections.findIndex((s) => s.id === afterId) : -1;
      sections.splice(at < 0 ? sections.length : at + 1, 0, section);
      project.sections = sections;
    });
    return section;
  }

  renameSection(projectId: string, sectionId: string, name: string): void {
    const section = this.getSection(projectId, sectionId);
    const trimmed = name.trim();
    if (!section || !trimmed || section.name === trimmed) return;
    this.#edit(() => {
      section.name = trimmed;
      this.#doneRules(section);
    });
  }

  /** A section made or renamed Done gets the Done rules it lacks, unless the setting is off (PRD §6.1). */
  #doneRules(section: ProjectSection): void {
    if (this.#data.settings.doneRules === false || !isDoneName(section.name)) return;
    const rules = section.automations ?? [];
    if (addDoneRules(rules)) section.automations = rules;
  }

  /** Moves a section one place left (-1) or right (1). */
  moveSection(projectId: string, sectionId: string, by: -1 | 1): void {
    const sections = this.getProject(projectId)?.sections ?? [];
    const from = sections.findIndex((s) => s.id === sectionId);
    const to = from + by;
    if (from < 0 || to < 0 || to >= sections.length) return;
    this.#edit(() => {
      const [section] = sections.splice(from, 1);
      if (section) sections.splice(to, 0, section);
    });
  }

  /** Deletes a section and moves its tasks to the Trash; restored, they come back unsectioned. */
  deleteSection(projectId: string, sectionId: string, now: number = this.#now()): void {
    const project = this.getProject(projectId);
    if (!project || !this.getSection(projectId, sectionId)) return;
    this.#edit((data) => {
      const sections = (project.sections ?? []).filter((s) => s.id !== sectionId);
      if (sections.length) project.sections = sections;
      else delete project.sections;
      for (const task of data.tasks) {
        if (task.projectId !== projectId || task.sectionId !== sectionId) continue;
        delete task.sectionId;
        if (task.deletedAt === null) task.deletedAt = now;
      }
      pruneAutomations(data.projects);
    });
  }

  /**
   * Replaces a section's rules with what the editor saved (PRD §6.1), as one undo step. Rules are checked as
   * they would be on reading: what this version can't run, or a move to a place that's gone, is dropped.
   */
  setSectionAutomations(projectId: string, sectionId: string, rules: readonly SectionAutomation[]): void {
    const section = this.getSection(projectId, sectionId);
    if (!section) return;
    this.#edit((data) => {
      // Cleaning builds new objects, so later changes to `rules` don't reach the data.
      section.automations = cleanAutomations(rules, () => true);
      pruneAutomations(data.projects);
    });
  }

  /** Shows a project as a list or as a board with a column per section. */
  setProjectView(projectId: string, view: 'list' | 'board'): void {
    const project = this.getProject(projectId);
    if (!project || (project.view ?? 'list') === view) return;
    this.#edit(() => {
      if (view === 'board') project.view = 'board';
      else delete project.view;
    });
  }

  // ---------- Labels ----------

  /** Every label on a task outside the Trash, alphabetical, ignoring case duplicates. */
  getLabels(): string[] {
    const seen = new Map<string, string>();
    for (const task of this.liveTasks()) {
      for (const label of task.labels) if (!seen.has(labelKey(label))) seen.set(labelKey(label), label);
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }

  /** Removes a label from every task, and forgets its colour. */
  deleteLabel(label: string): void {
    this.#edit((data) => {
      for (const task of data.tasks) task.labels = task.labels.filter((l) => labelKey(l) !== labelKey(label));
      setColor(data, label, null);
    });
  }

  /** The colour chosen for a label, or null for the plain label colour. */
  labelColor(label: string): ProjectColor | null {
    return this.#data.labelColors?.[labelKey(label)] ?? null;
  }

  /**
   * Renames a label on every task and gives it a colour (null for none), as one undo step. Renaming onto
   * a label a task already has leaves that task with one copy. False when the name is empty.
   */
  editLabel(label: string, name: string, color: ProjectColor | null): boolean {
    const next = name.trim().replace(/^@/, '').replace(/\s+/g, '-');
    if (!next) return false;
    this.#edit((data) => {
      let changed = false;
      if (next !== label) {
        for (const task of data.tasks) {
          if (!task.labels.some((l) => labelKey(l) === labelKey(label))) continue;
          const kept = task.labels.filter(
            (l) => labelKey(l) !== labelKey(label) && labelKey(l) !== labelKey(next),
          );
          task.labels = [...kept, next];
          changed = true;
        }
        if (labelKey(next) !== labelKey(label)) changed = setColor(data, label, null) || changed;
        for (const project of data.projects)
          for (const section of project.sections ?? [])
            if (section.automations)
              changed = renameLabelInRules(section.automations, label, next) || changed;
      }
      return setColor(data, next, color) || changed;
    });
    return true;
  }

  // ---------- Settings ----------

  /** Remembers the view shown, so the app reopens there. Not an undo step. */
  rememberView(view: SavedView): void {
    if (JSON.stringify(this.#data.settings.lastView) === JSON.stringify(view)) return;
    this.#data.settings.lastView = view;
    this.#emit('settings');
  }

  /** Settings changes are saved but are not undo steps. */
  updateSettings(patch: Partial<Settings>): void {
    Object.assign(this.#data.settings, patch);
    this.#emit('settings');
  }
}
