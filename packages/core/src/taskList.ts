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
  type ProjectSection,
  type ProjectColor,
  type SavedView,
  type Settings,
  type Task,
} from './model.ts';

/** How many steps Undo can go back (PRD §4.7). */
export const MAX_HISTORY = 100;

/** `edit`: an undo step, an undo or a redo. `settings`: saved but not an undo step. `load`: new data replaced it all. */
/** `load` and `outside` came from the file, so there is nothing to save. */
export type ChangeKind = 'edit' | 'settings' | 'load' | 'outside';

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

export class TaskList {
  #data: AppData;
  #undo: AppData[] = [];
  #redo: AppData[] = [];
  #listeners = new Set<(kind: ChangeKind) => void>();
  #now: () => number;
  #newId: () => string;
  #batching = false;
  #batchChanged = false;
  #step = 0;

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
    this.#undo = [structuredClone(this.#data)];
    this.#redo = [];
    this.#data = { ...data, settings: this.#data.settings };
    this.#emit('outside');
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

  /**
   * Goes up with every change to the tasks, undo and redo included (not settings). A notice that offers
   * Undo remembers it, so its Undo only ever takes back the change it announced.
   */
  get step(): number {
    return this.#step;
  }

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
    const sectionId = parent ? parent.sectionId : fields.sectionId;
    if (sectionId && this.getSection(projectId, sectionId)) task.sectionId = sectionId;
    this.#edit((data) => {
      const orders = data.tasks.filter((t) => t.projectId === projectId).map((t) => t.order);
      task.order = Math.max(-1, ...orders) + 1;
      data.tasks.push(task);
    });
    return task;
  }

  /**
   * Changes fields on tasks as one undo step. Subtasks follow their parent's project and section. A task
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
      for (const task of tasks) {
        const moved = fields.projectId !== undefined && fields.projectId !== task.projectId;
        Object.assign(task, fields);
        if (setsSection || moved) {
          if (sectionId && this.getSection(task.projectId, sectionId)) task.sectionId = sectionId;
          else delete task.sectionId;
        }
        if (!setsSection && fields.projectId === undefined) continue;
        // Subtasks in the Trash move too, so a restored one comes back beside its parent.
        for (const sub of this.#data.tasks.filter((t) => t.parentId === task.id)) {
          sub.projectId = task.projectId;
          if (task.sectionId) sub.sectionId = task.sectionId;
          else delete sub.sectionId;
        }
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
        if (task.sectionId && !this.getSection(task.projectId, task.sectionId)) delete task.sectionId;
      }
      // A subtask always sits in its parent's project and section (PRD §6).
      for (const task of toRestore) {
        const parent = task.parentId ? this.getTask(task.parentId) : undefined;
        if (!parent) continue;
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
   * Removes tasks that have been in the Trash too long, with no undo step (PRD §3.2).
   * Returns whether anything was removed.
   */
  purgeExpired(now: number = this.#now()): boolean {
    const ids = expiredTaskIds(this.#data, now);
    if (!ids.size) return false;
    this.#data.tasks = this.#data.tasks.filter((t) => !ids.has(t.id));
    for (const t of this.#data.tasks) if (t.parentId && ids.has(t.parentId)) t.parentId = null;
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
    });
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
