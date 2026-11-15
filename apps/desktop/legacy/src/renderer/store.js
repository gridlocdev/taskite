// @ts-check
/**
 * App state: projects, tasks and settings. Every change is saved right away
 * through the storage adapter and announced to subscribers.
 */
import { nextOccurrence, todayISO } from './dates.js';

/** @typedef {import('./dates.js').Recurrence} Recurrence */

/**
 * @typedef {Object} Task
 * @property {string} id
 * @property {string} title
 * @property {string} description
 * @property {string} projectId
 * @property {string|null} parentId Set for subtasks.
 * @property {string[]} labels
 * @property {1|2|3|4} priority 1 = most urgent, 4 = normal.
 * @property {string|null} due YYYY-MM-DD.
 * @property {Recurrence|null} recurrence
 * @property {boolean} completed
 * @property {number|null} completedAt Epoch ms.
 * @property {number} createdAt Epoch ms.
 * @property {number} order Position within its project.
 * @property {number|null} deletedAt Epoch ms when moved to the Trash, or null.
 */

/**
 * @typedef {Object} Project
 * @property {string} id
 * @property {string} name
 * @property {string} color A key of PROJECT_COLORS.
 */

/**
 * A screen the app can show, saved so the app reopens where you left it.
 * @typedef {{type: 'project', id: string}
 *   | {type: 'today'} | {type: 'upcoming'} | {type: 'completed'} | {type: 'trash'}
 *   | {type: 'label', name: string}} SavedView
 */

/**
 * @typedef {Object} Settings
 * @property {'auto'|'light'|'dark'} theme
 * @property {SavedView|null} lastView
 */

/**
 * @typedef {Object} AppData
 * @property {number} version
 * @property {Project[]} projects
 * @property {Task[]} tasks
 * @property {Settings} settings
 */

/**
 * @typedef {Object} StorageAdapter
 * @property {() => Promise<unknown>} load
 * @property {(data: AppData) => Promise<void>} save
 */

/**
 * @typedef {{ok: true} | {ok: false, error: unknown}} SaveStatus
 */

export const INBOX_ID = 'inbox';
/** Days a task stays in the Trash before it is removed for good. */
export const TRASH_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
/** How many steps Undo can go back. */
const MAX_HISTORY = 100;
/** Attempts per save before telling the user, and the wait before each retry. */
const SAVE_ATTEMPTS = 3;
const SAVE_RETRY_MS = 300;

/** @type {Record<string, string>} */
export const PROJECT_COLORS = {
  gray: '#808080',
  red: '#db4035',
  orange: '#ff9933',
  yellow: '#e0b100',
  green: '#299438',
  teal: '#158fad',
  blue: '#4073ff',
  purple: '#884dff',
  magenta: '#af38eb',
  pink: '#e05194',
};

/** @type {AppData} */
let data = emptyData();
/** @type {StorageAdapter|null} */
let storage = null;
/** @type {Set<() => void>} */
const listeners = new Set();
/** @type {Set<(status: SaveStatus) => void>} */
const saveListeners = new Set();
/** States before each undoable change, oldest first. @type {AppData[]} */
let undoStack = [];
/** States undone, most recent last. @type {AppData[]} */
let redoStack = [];
/** Whether the last save failed for good, so a later success can clear the warning. */
let saveFailed = false;
/** Wait between save retries. Tests set it to 0. */
let retryDelayMs = SAVE_RETRY_MS;

/** @returns {AppData} */
function emptyData() {
  return {
    version: 1,
    projects: [{ id: INBOX_ID, name: 'Inbox', color: 'gray' }],
    tasks: [],
    settings: { theme: 'auto', lastView: null },
  };
}

/** @returns {string} */
function newId() {
  return crypto.randomUUID();
}

/**
 * @param {any} raw
 * @returns {SavedView|null}
 */
function normalizeView(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (['today', 'upcoming', 'completed', 'trash'].includes(raw.type)) return { type: raw.type };
  if (raw.type === 'project' && typeof raw.id === 'string') return { type: 'project', id: raw.id };
  if (raw.type === 'label' && typeof raw.name === 'string') return { type: 'label', name: raw.name };
  return null;
}

/**
 * Fills in anything missing from saved data so older or hand-edited files load.
 * @param {any} raw
 * @returns {AppData}
 */
export function normalize(raw) {
  const base = emptyData();
  if (!raw || typeof raw !== 'object') return base;
  const projects = Array.isArray(raw.projects) ? raw.projects.filter((p) => p && p.id && p.name) : [];
  if (!projects.some((p) => p.id === INBOX_ID)) projects.unshift(base.projects[0]);
  const projectIds = new Set(projects.map((p) => p.id));
  const tasks = (Array.isArray(raw.tasks) ? raw.tasks : [])
    .filter((t) => t && t.id && typeof t.title === 'string')
    .map((t, i) => ({
      id: t.id,
      title: t.title,
      description: t.description ?? '',
      projectId: projectIds.has(t.projectId) ? t.projectId : INBOX_ID,
      parentId: t.parentId ?? null,
      labels: Array.isArray(t.labels) ? t.labels : [],
      priority: [1, 2, 3, 4].includes(t.priority) ? t.priority : 4,
      due: t.due ?? null,
      recurrence: t.recurrence ?? null,
      completed: Boolean(t.completed),
      completedAt: t.completedAt ?? null,
      createdAt: t.createdAt ?? Date.now(),
      order: typeof t.order === 'number' ? t.order : i,
      deletedAt: typeof t.deletedAt === 'number' ? t.deletedAt : null,
    }));
  return {
    version: 1,
    projects: projects.map((p) => ({ id: p.id, name: p.name, color: PROJECT_COLORS[p.color] ? p.color : 'gray' })),
    tasks,
    settings: {
      theme: ['auto', 'light', 'dark'].includes(raw.settings?.theme) ? raw.settings.theme : 'auto',
      lastView: normalizeView(raw.settings?.lastView),
    },
  };
}

/**
 * Loads saved data and empties out Trash older than TRASH_DAYS. Call once at startup.
 * @param {StorageAdapter} adapter
 * @param {{now?: number, retryDelayMs?: number}} [options]
 * @returns {Promise<void>}
 */
export async function init(adapter, { now = Date.now(), retryDelayMs: delay = SAVE_RETRY_MS } = {}) {
  storage = adapter;
  retryDelayMs = delay;
  data = normalize(await adapter.load());
  undoStack = [];
  redoStack = [];
  saveFailed = false;
  const cutoff = now - TRASH_DAYS * DAY_MS;
  const expired = data.tasks.filter((t) => t.deletedAt !== null && t.deletedAt < cutoff);
  if (expired.length) {
    removeTasks(new Set(expired.map((t) => t.id)));
    save();
  }
}

/** @returns {AppData} The live state. Treat it as read-only; use the functions below to change it. */
export function getData() {
  return data;
}

/**
 * @param {() => void} fn Called after every change.
 * @returns {() => void} Unsubscribe function.
 */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * @param {(status: SaveStatus) => void} fn Called when saving fails for good, and when it works again after that.
 * @returns {() => void} Unsubscribe function.
 */
export function onSaveStatus(fn) {
  saveListeners.add(fn);
  return () => saveListeners.delete(fn);
}

/** @param {number} ms */
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Saves the current state, retrying a few times before reporting a failure.
 * @returns {Promise<boolean>} Whether it was saved.
 */
export async function save() {
  if (!storage) return false;
  let lastError;
  for (let attempt = 1; attempt <= SAVE_ATTEMPTS; attempt++) {
    try {
      await storage.save(data);
      if (saveFailed) {
        saveFailed = false;
        saveListeners.forEach((fn) => fn({ ok: true }));
      }
      return true;
    } catch (err) {
      lastError = err;
      if (attempt < SAVE_ATTEMPTS) await wait(retryDelayMs * attempt);
    }
  }
  console.error('Save failed', lastError);
  saveFailed = true;
  saveListeners.forEach((fn) => fn({ ok: false, error: lastError }));
  return false;
}

/**
 * Saves and notifies. Pass `before` (a snapshot) to make the change undoable.
 * @param {AppData|null} [before]
 */
function commit(before = null) {
  if (before) {
    undoStack.push(before);
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack = [];
  }
  save();
  listeners.forEach((fn) => fn());
}

/** @returns {AppData} A deep copy for undo. */
function snapshot() {
  return structuredClone(data);
}

/**
 * Restores a snapshot but keeps the current settings, so Undo never flips the theme or view.
 * @param {AppData} state
 */
function restoreState(state) {
  data = { ...state, settings: data.settings };
}

/** @returns {boolean} Whether there is something to undo. */
export function canUndo() {
  return undoStack.length > 0;
}

/** @returns {boolean} Whether there is something to redo. */
export function canRedo() {
  return redoStack.length > 0;
}

/** Goes back one change. */
export function undo() {
  const previous = undoStack.pop();
  if (!previous) return;
  redoStack.push(snapshot());
  restoreState(previous);
  commit();
}

/** Re-applies the last change that was undone. */
export function redo() {
  const next = redoStack.pop();
  if (!next) return;
  undoStack.push(snapshot());
  restoreState(next);
  commit();
}

// ---------- Tasks ----------

/**
 * @param {string} id
 * @returns {Task|undefined}
 */
export function getTask(id) {
  return data.tasks.find((t) => t.id === id);
}

/** @returns {Task[]} Every task that isn't in the Trash. */
export function liveTasks() {
  return data.tasks.filter((t) => t.deletedAt === null);
}

/** @returns {Task[]} Every task in the Trash, most recently deleted first. */
export function trashedTasks() {
  return data.tasks.filter((t) => t.deletedAt !== null).sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));
}

/**
 * @param {string} parentId
 * @returns {Task[]} Subtasks not in the Trash, in order.
 */
export function getSubtasks(parentId) {
  return data.tasks.filter((t) => t.parentId === parentId && t.deletedAt === null).sort((a, b) => a.order - b.order);
}

/**
 * @param {Partial<Task> & {title: string}} fields
 * @returns {Task}
 */
export function addTask(fields) {
  const before = snapshot();
  const parent = fields.parentId ? getTask(fields.parentId) : undefined;
  const projectId = parent?.projectId ?? fields.projectId ?? INBOX_ID;
  const maxOrder = Math.max(-1, ...data.tasks.filter((t) => t.projectId === projectId).map((t) => t.order));
  /** @type {Task} */
  const task = {
    id: newId(),
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
    createdAt: Date.now(),
    order: maxOrder + 1,
    deletedAt: null,
  };
  data.tasks.push(task);
  commit(before);
  return task;
}

/**
 * Changes fields on one or more tasks as a single undo step.
 * @param {string|string[]} ids
 * @param {Partial<Omit<Task, 'id'>>} patch
 */
export function updateTask(ids, patch) {
  const tasks = toList(ids).map(getTask).filter((t) => t !== undefined);
  if (!tasks.length) return;
  const before = snapshot();
  for (const task of tasks) {
    Object.assign(task, patch);
    // Subtasks always live in their parent's project.
    if (patch.projectId) {
      for (const sub of getSubtasks(task.id)) sub.projectId = patch.projectId;
    }
  }
  commit(before);
}

/**
 * @param {string|string[]} ids
 * @returns {string[]}
 */
function toList(ids) {
  return Array.isArray(ids) ? ids : [ids];
}

/**
 * @typedef {{id: string, repeated: boolean, nextDue: string|null}} CompleteResult
 */

/**
 * Checks tasks off as one undo step. A repeating task moves to its next date instead.
 * @param {string|string[]} ids
 * @param {string} [today]
 * @returns {CompleteResult[]}
 */
export function completeTasks(ids, today = todayISO()) {
  const tasks = toList(ids).map(getTask).filter((t) => t !== undefined && !t.completed);
  if (!tasks.length) return [];
  const before = snapshot();
  const now = Date.now();
  /** @type {CompleteResult[]} */
  const results = [];
  for (const task of /** @type {Task[]} */ (tasks)) {
    if (task.recurrence && task.due) {
      task.due = nextOccurrence(task.due, task.recurrence, today);
      results.push({ id: task.id, repeated: true, nextDue: task.due });
      continue;
    }
    task.completed = true;
    task.completedAt = now;
    for (const sub of getSubtasks(task.id)) {
      if (!sub.completed) Object.assign(sub, { completed: true, completedAt: now });
    }
    results.push({ id: task.id, repeated: false, nextDue: null });
  }
  commit(before);
  return results;
}

/**
 * Checks one task off. A repeating task moves to its next date instead.
 * @param {string} id
 * @param {string} [today]
 * @returns {{repeated: boolean, nextDue: string|null}}
 */
export function completeTask(id, today = todayISO()) {
  const [result] = completeTasks(id, today);
  return result ? { repeated: result.repeated, nextDue: result.nextDue } : { repeated: false, nextDue: null };
}

/**
 * Un-checks completed tasks (and their parents, so they show up again).
 * @param {string|string[]} ids
 */
export function reopenTasks(ids) {
  const tasks = toList(ids).map(getTask).filter((t) => t !== undefined && t.completed);
  if (!tasks.length) return;
  const before = snapshot();
  for (const task of /** @type {Task[]} */ (tasks)) {
    task.completed = false;
    task.completedAt = null;
    const parent = task.parentId ? getTask(task.parentId) : undefined;
    if (parent?.completed) Object.assign(parent, { completed: false, completedAt: null });
  }
  commit(before);
}

/** @param {string} id */
export function reopenTask(id) {
  reopenTasks(id);
}

/**
 * Moves tasks and their subtasks to the Trash.
 * @param {string|string[]} ids
 * @param {number} [now]
 */
export function deleteTasks(ids, now = Date.now()) {
  const idSet = new Set(toList(ids));
  const tasks = data.tasks.filter((t) => t.deletedAt === null && (idSet.has(t.id) || (t.parentId && idSet.has(t.parentId))));
  if (!tasks.length) return;
  const before = snapshot();
  for (const task of tasks) task.deletedAt = now;
  commit(before);
}

/** @param {string} id */
export function deleteTask(id) {
  deleteTasks(id);
}

/**
 * Takes tasks out of the Trash, with the subtasks deleted alongside them.
 * Restoring a subtask also restores its parent. A task whose project is gone goes to the Inbox.
 * @param {string|string[]} ids
 */
export function restoreTasks(ids) {
  /** @type {Set<Task>} */
  const toRestore = new Set();
  for (const id of toList(ids)) {
    const task = getTask(id);
    if (!task || task.deletedAt === null) continue;
    toRestore.add(task);
    for (const sub of data.tasks) {
      if (sub.parentId === task.id && sub.deletedAt === task.deletedAt) toRestore.add(sub);
    }
    const parent = task.parentId ? getTask(task.parentId) : undefined;
    if (parent && parent.deletedAt !== null) toRestore.add(parent);
  }
  if (!toRestore.size) return;
  const before = snapshot();
  for (const task of toRestore) {
    task.deletedAt = null;
    if (!getProject(task.projectId)) task.projectId = INBOX_ID;
  }
  commit(before);
}

/** @param {Set<string>} ids Removes these tasks and their subtasks from the data, with no undo step. */
function removeTasks(ids) {
  data.tasks = data.tasks.filter((t) => !ids.has(t.id) && !(t.parentId && ids.has(t.parentId)));
}

/**
 * Deletes tasks in the Trash for good (Undo still works right after).
 * @param {string|string[]} ids
 */
export function purgeTasks(ids) {
  const idSet = new Set(toList(ids).filter((id) => getTask(id)?.deletedAt != null));
  if (!idSet.size) return;
  const before = snapshot();
  removeTasks(idSet);
  commit(before);
}

/** Deletes everything in the Trash for good. */
export function emptyTrash() {
  purgeTasks(trashedTasks().map((t) => t.id));
}

/** Moves every completed task to the Trash. */
export function clearCompleted() {
  deleteTasks(liveTasks().filter((t) => t.completed).map((t) => t.id));
}

/**
 * Sets the order of tasks to match the given list of ids.
 * @param {string[]} orderedIds
 */
export function reorderTasks(orderedIds) {
  const before = snapshot();
  orderedIds.forEach((id, index) => {
    const task = getTask(id);
    if (task) task.order = index;
  });
  commit(before);
}

// ---------- Projects ----------

/**
 * @param {string} id
 * @returns {Project|undefined}
 */
export function getProject(id) {
  return data.projects.find((p) => p.id === id);
}

/**
 * Case- and space-insensitive lookup, used by Quick Add's "#Project".
 * @param {string} name
 * @returns {Project|undefined}
 */
export function findProjectByName(name) {
  const key = (/** @type {string} */ s) => s.toLowerCase().replace(/[\s_-]+/g, '');
  return data.projects.find((p) => key(p.name) === key(name));
}

/**
 * @param {string} name
 * @param {string} [color]
 * @returns {Project}
 */
export function addProject(name, color = 'blue') {
  const before = snapshot();
  /** @type {Project} */
  const project = { id: newId(), name: name.trim(), color };
  data.projects.push(project);
  commit(before);
  return project;
}

/**
 * @param {string} id
 * @param {Partial<Omit<Project, 'id'>>} patch
 */
export function updateProject(id, patch) {
  const project = getProject(id);
  if (!project) return;
  const before = snapshot();
  Object.assign(project, patch);
  commit(before);
}

/**
 * Deletes a project and moves its tasks to the Trash. The Inbox can't be deleted.
 * @param {string} id
 * @param {number} [now]
 */
export function deleteProject(id, now = Date.now()) {
  if (id === INBOX_ID || !getProject(id)) return;
  const before = snapshot();
  data.projects = data.projects.filter((p) => p.id !== id);
  for (const task of data.tasks) {
    if (task.projectId === id && task.deletedAt === null) task.deletedAt = now;
  }
  commit(before);
}

// ---------- Labels ----------

/** @returns {string[]} Every label in use outside the Trash, alphabetically, ignoring case duplicates. */
export function getLabels() {
  /** @type {Map<string, string>} */
  const seen = new Map();
  for (const task of liveTasks()) {
    for (const label of task.labels) {
      if (!seen.has(label.toLowerCase())) seen.set(label.toLowerCase(), label);
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/**
 * Removes a label from every task.
 * @param {string} label
 */
export function deleteLabel(label) {
  const before = snapshot();
  const key = label.toLowerCase();
  for (const task of data.tasks) task.labels = task.labels.filter((l) => l.toLowerCase() !== key);
  commit(before);
}

// ---------- Settings ----------

/**
 * Remembers the screen being shown so the app reopens on it. Saves without re-rendering.
 * @param {SavedView} view
 */
export function rememberView(view) {
  if (JSON.stringify(data.settings.lastView) === JSON.stringify(view)) return;
  data.settings.lastView = view;
  save();
}

/**
 * Settings changes are saved but are not undo steps.
 * @param {Partial<Settings>} patch
 */
export function updateSettings(patch) {
  Object.assign(data.settings, patch);
  save();
  listeners.forEach((fn) => fn());
}
