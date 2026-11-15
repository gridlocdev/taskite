/**
 * The task list engine: every edit to tasks, projects and labels, with undo (PRD §4, §6). It holds the
 * data in memory and tells listeners after each change; saving is the caller's job.
 */
import { nextOccurrence, todayISO } from './dates.ts';
import {
  INBOX_ID,
  PROJECT_COLOR_NAMES,
  expiredTaskIds,
  type AppData,
  type Project,
  type ProjectColor,
  type SavedView,
  type Settings,
  type Task,
} from './model.ts';

/** How many steps Undo can go back (PRD §4.7). */
export const MAX_HISTORY = 100;

/** `edit`: an undo step, an undo or a redo. `settings`: saved but not an undo step. `load`: new data replaced it all. */
export type ChangeKind = 'edit' | 'settings' | 'load';

export interface CompleteResult {
  id: string;
  repeated: boolean;
  nextDue: string | null;
}

export type NewTask = Partial<Omit<Task, 'id' | 'title'>> & { title: string };
export type TaskPatch = Partial<Omit<Task, 'id'>>;

export interface TaskListOptions {
  /** Clock, for tests. */
  now?: () => number;
  /** Id maker, for tests. */
  newId?: () => string;
}

type Ids = string | readonly string[];

function toList(ids: Ids): readonly string[] {
  return typeof ids === 'string' ? [ids] : ids;
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

export class TaskList {
  #data: AppData;
  #undo: AppData[] = [];
  #redo: AppData[] = [];
  #listeners = new Set<(kind: ChangeKind) => void>();
  #now: () => number;
  #newId: () => string;
  #batching = false;
  #batchChanged = false;

  constructor(data: AppData, options: TaskListOptions = {}) {
    this.#data = data;
    this.#now = options.now ?? Date.now;
    this.#newId = options.newId ?? (() => crypto.randomUUID());
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
    for (const fn of this.#listeners) fn(kind);
  }

  /** Replaces all data (a reload) and clears undo. */
  replace(data: AppData): void {
    this.#data = data;
    this.#undo = [];
    this.#redo = [];
    this.#emit('load');
  }

  /** Runs `change` on the data as one undo step. Nothing is recorded if it returns false. */
  #edit(change: (data: AppData) => boolean | void): void {
    if (this.#batching) {
      if (change(this.#data) !== false) this.#batchChanged = true;
      return;
    }
    const before = structuredClone(this.#data);
    if (change(this.#data) === false) return;
    this.#record(before);
  }

  #record(before: AppData): void {
    this.#undo.push(before);
    if (this.#undo.length > MAX_HISTORY) this.#undo.shift();
    this.#redo = [];
    this.#emit('edit');
  }

  /** Runs several edits as one undo step. */
  batch<T>(fn: () => T): T {
    if (this.#batching) return fn();
    const before = structuredClone(this.#data);
    this.#batching = true;
    this.#batchChanged = false;
    try {
      return fn();
    } finally {
      this.#batching = false;
      if (this.#batchChanged) this.#record(before);
    }
  }

  // ---------- Undo ----------

  get canUndo(): boolean {
    return this.#undo.length > 0;
  }

  get canRedo(): boolean {
    return this.#redo.length > 0;
  }

  /** Goes back one change. Settings stay as they are (PRD §4.7). */
  undo(): void {
    const previous = this.#undo.pop();
    if (!previous) return;
    this.#redo.push(structuredClone(this.#data));
    this.#data = { ...previous, settings: this.#data.settings };
    this.#emit('edit');
  }

  redo(): void {
    const next = this.#redo.pop();
    if (!next) return;
    this.#undo.push(structuredClone(this.#data));
    this.#data = { ...next, settings: this.#data.settings };
    this.#emit('edit');
  }

  // ---------- Reading tasks ----------

  getTask(id: string): Task | undefined {
    return this.#data.tasks.find((t) => t.id === id);
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

  /** The Trash as listed: top-level tasks, and subtasks whose parent isn't trashed (PRD §4.6). */
  trashList(): Task[] {
    return this.trashedTasks().filter((t) => !t.parentId || this.getTask(t.parentId)?.deletedAt === null);
  }

  /** Subtasks not in the Trash, in order. */
  getSubtasks(parentId: string): Task[] {
    return this.#data.tasks
      .filter((t) => t.parentId === parentId && t.deletedAt === null)
      .sort((a, b) => a.order - b.order);
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
    this.#edit((data) => {
      const orders = data.tasks.filter((t) => t.projectId === projectId).map((t) => t.order);
      task.order = Math.max(-1, ...orders) + 1;
      data.tasks.push(task);
    });
    return task;
  }

  /** Changes fields on tasks as one undo step. Subtasks follow their parent's project. */
  updateTasks(ids: Ids, patch: TaskPatch): void {
    const tasks = toList(ids)
      .map((id) => this.getTask(id))
      .filter((t) => t !== undefined);
    if (!tasks.length) return;
    this.#edit(() => {
      for (const task of tasks) {
        Object.assign(task, patch);
        if (patch.projectId) for (const sub of this.getSubtasks(task.id)) sub.projectId = patch.projectId;
      }
    });
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
      for (const task of tasks) {
        if (task.recurrence && task.due) {
          task.due = nextOccurrence(task.due, task.recurrence, today);
          results.push({ id: task.id, repeated: true, nextDue: task.due });
          continue;
        }
        task.completed = true;
        task.completedAt = now;
        for (const sub of this.getSubtasks(task.id)) {
          if (!sub.completed) Object.assign(sub, { completed: true, completedAt: now });
        }
        results.push({ id: task.id, repeated: false, nextDue: null });
      }
    });
    return results;
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
      }
    });
  }

  /** Deletes tasks in the Trash for good. Undo still works right after. */
  purgeTasks(ids: Ids): void {
    const idSet = new Set(toList(ids).filter((id) => this.getTask(id)?.deletedAt != null));
    if (!idSet.size) return;
    this.#edit((data) => {
      data.tasks = data.tasks.filter((t) => !idSet.has(t.id) && !(t.parentId && idSet.has(t.parentId)));
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
   * Removes tasks that have been in the Trash too long, with no undo step (PRD §3.2).
   * Returns whether anything was removed.
   */
  purgeExpired(now: number = this.#now()): boolean {
    const ids = expiredTaskIds(this.#data, now);
    if (!ids.size) return false;
    this.#data.tasks = this.#data.tasks.filter((t) => !ids.has(t.id));
    this.#emit('settings');
    return true;
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

  /** Deletes a project and moves its tasks to the Trash. The Inbox can't be deleted. */
  deleteProject(id: string, now: number = this.#now()): void {
    if (id === INBOX_ID || !this.getProject(id)) return;
    this.#edit((data) => {
      data.projects = data.projects.filter((p) => p.id !== id);
      for (const task of data.tasks) {
        if (task.projectId === id && task.deletedAt === null) task.deletedAt = now;
      }
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

  /** Removes a label from every task. */
  deleteLabel(label: string): void {
    this.#edit((data) => {
      for (const task of data.tasks) task.labels = task.labels.filter((l) => labelKey(l) !== labelKey(label));
    });
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
