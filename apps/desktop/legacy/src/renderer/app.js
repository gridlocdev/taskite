// @ts-check
/**
 * Renderer entry point: draws the sidebar, task lists and dialogs, and wires
 * up user input. All data changes go through store.js. Every action a user
 * can take by keyboard, command menu, right-click or menu bar is one entry in
 * the command list (see "Commands" below).
 */
import * as store from './store.js';
import { INBOX_ID, PROJECT_COLORS, TRASH_DAYS } from './store.js';
import { parseQuickAdd } from './parser.js';
import { todayISO, addDays, diffDays, formatDue, formatDayHeading, toISODate } from './dates.js';
import { h, icon, hydrateIcons, $ } from './dom.js';
import { matchesChord, shortcutSteps, keyName, formatShortcut, toAccelerator, filterCommands } from './commands.js';
import { stepId, rangeIds } from './selection.js';

/** @typedef {import('./store.js').Task} Task */
/** @typedef {import('./store.js').Project} Project */
/** @typedef {import('./commands.js').Command} Command */

/**
 * The screen currently shown.
 * @typedef {import('./store.js').SavedView | {type: 'search', query: string}} View
 */

/** Bootstrap's JS is loaded as a classic script and exposes this global. */
const bootstrap = /** @type {any} */ (window).bootstrap;
/** The preload API, missing when the page is opened outside Electron. */
const api = /** @type {any} */ (window).api;

const IS_MAC = navigator.platform.startsWith('Mac');
const DAY_MS = 24 * 60 * 60 * 1000;
/** How long a checked-off task shows as done before it leaves the list. */
const COMPLETE_MS = 350;
/** Length of the slide-out when a task leaves the list. */
const LEAVE_MS = 180;
/** How long to wait for the second key of "G then I". */
const SEQUENCE_MS = 1500;
const RECENT_COMMANDS_KEY = 'taskite.recentCommands';
const MAX_RECENT_COMMANDS = 8;

/** @type {View} */
let view = { type: 'today' };
/** The view to return to when search is cleared. @type {View} */
let viewBeforeSearch = view;
/** Id of the task currently open in the editor. @type {string|null} */
let editingTaskId = null;
/** Id of the project open in the project editor, or null when adding. @type {string|null} */
let editingProjectId = null;
/** Id of the task being dragged. @type {string|null} */
let draggedId = null;
/** Which add row is open as the composer ('end' or 'day:YYYY-MM-DD'), or null. @type {string|null} */
let composerSlot = null;
/** True while the task list is being replaced, so the composer ignores its own blur. */
let renderingList = false;
/** Id of the task added last, so its row can slide in. @type {string|null} */
let justAddedId = null;
/** Tasks playing a leave animation; clicks on them are ignored. */
const leaving = new Set();

/** Chosen tasks, the end a Shift-range grows from, and the one with the keyboard focus. */
const selection = {
  /** @type {Set<string>} */
  ids: new Set(),
  /** @type {string|null} */
  anchor: null,
  /** @type {string|null} */
  active: null,
  /** Task to choose if the chosen ones leave the list. @type {string|null} */
  fallback: null,
};

const els = {
  navMain: /** @type {HTMLUListElement} */ ($('#nav-main')),
  navProjects: /** @type {HTMLUListElement} */ ($('#nav-projects')),
  navLabels: /** @type {HTMLUListElement} */ ($('#nav-labels')),
  labelsHeading: /** @type {HTMLElement} */ ($('#labels-heading')),
  search: /** @type {HTMLInputElement} */ ($('#search')),
  title: /** @type {HTMLElement} */ ($('#view-title')),
  viewMenu: /** @type {HTMLElement} */ ($('#view-menu')),
  viewMenuItems: /** @type {HTMLUListElement} */ ($('#view-menu-items')),
  addTaskBtn: /** @type {HTMLButtonElement} */ ($('#btn-add-task')),
  list: /** @type {HTMLElement} */ ($('#task-list')),
  themeBtn: /** @type {HTMLButtonElement} */ ($('#btn-theme')),
  toasts: /** @type {HTMLElement} */ ($('#toasts')),
  contextMenu: /** @type {HTMLUListElement} */ ($('#context-menu')),
};

const modals = {
  task: bootstrap.Modal.getOrCreateInstance($('#task-modal')),
  project: bootstrap.Modal.getOrCreateInstance($('#project-modal')),
  confirm: bootstrap.Modal.getOrCreateInstance($('#confirm-modal')),
  shortcuts: bootstrap.Modal.getOrCreateInstance($('#shortcuts-modal')),
  palette: bootstrap.Modal.getOrCreateInstance($('#palette-modal')),
  due: bootstrap.Modal.getOrCreateInstance($('#due-modal')),
};

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Sorts by due date (no date last), then priority, then manual order.
 * @param {Task} a
 * @param {Task} b
 */
function byDueThenPriority(a, b) {
  if (a.due !== b.due) {
    if (!a.due) return 1;
    if (!b.due) return -1;
    return a.due < b.due ? -1 : 1;
  }
  return a.priority - b.priority || a.order - b.order;
}

/** @param {Task} a @param {Task} b */
function byPriority(a, b) {
  return a.priority - b.priority || a.order - b.order;
}

/** @returns {Task[]} All tasks not yet done and not in the Trash. */
function activeTasks() {
  return store.liveTasks().filter((t) => !t.completed);
}

/** @returns {Task[]} Trashed tasks to list: top-level ones, and subtasks whose parent wasn't trashed. */
function trashList() {
  return store.trashedTasks().filter((t) => !t.parentId || store.getTask(t.parentId)?.deletedAt === null);
}

/**
 * @param {Task} task
 * @param {string} label
 */
function hasLabel(task, label) {
  return task.labels.some((l) => l.toLowerCase() === label.toLowerCase());
}

/** @param {View} a @param {View} b */
function sameView(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** @param {View} next */
function setView(next) {
  view = next;
  if (next.type !== 'search') {
    viewBeforeSearch = next;
    els.search.value = '';
    store.rememberView(next);
  }
  composerSlot = null;
  clearSelection();
  render();
  /** @type {HTMLElement} */ ($('.content')).scrollTop = 0;
}

/** @param {number} n @param {string} word */
function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/**
 * Shows a short message at the bottom of the window, optionally with a button.
 * @param {string} message
 * @param {{undo?: boolean, action?: {label: string, run: () => void}, persist?: boolean}} [options]
 * @returns {{hide: () => void}}
 */
function toast(message, { undo = false, action, persist = false } = {}) {
  const act = undo ? { label: 'Undo', run: () => store.undo() } : action;
  const btn = act
    ? h('button', { type: 'button', class: 'btn btn-sm btn-link text-danger p-0 ms-3 fw-semibold' }, act.label)
    : null;
  const el = h('div', { class: 'toast align-items-center', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' },
    h('div', { class: 'd-flex align-items-center' },
      h('div', { class: 'toast-body flex-grow-1' }, message, btn),
      h('button', { type: 'button', class: 'btn-close me-2', 'data-bs-dismiss': 'toast', 'aria-label': 'Close' })));
  els.toasts.append(el);
  const instance = bootstrap.Toast.getOrCreateInstance(el, { delay: 5000, autohide: !persist });
  btn?.addEventListener('click', () => {
    act?.run();
    instance.hide();
  });
  el.addEventListener('hidden.bs.toast', () => el.remove());
  instance.show();
  return { hide: () => instance.hide() };
}

/**
 * Asks the user to confirm something destructive.
 * @param {string} title
 * @param {string} body
 * @param {string} okLabel
 * @returns {Promise<boolean>}
 */
function confirmAction(title, body, okLabel = 'Delete') {
  $('#confirm-title').textContent = title;
  $('#confirm-body').textContent = body;
  const ok = /** @type {HTMLButtonElement} */ ($('#confirm-ok'));
  ok.textContent = okLabel;
  return new Promise((resolve) => {
    let confirmed = false;
    const onOk = () => {
      confirmed = true;
      modals.confirm.hide();
    };
    ok.addEventListener('click', onOk, { once: true });
    $('#confirm-modal').addEventListener('hidden.bs.modal', () => {
      ok.removeEventListener('click', onOk);
      resolve(confirmed);
    }, { once: true });
    modals.confirm.show();
  });
}

/** @returns {boolean} Whether any dialog is open. */
function modalOpen() {
  return document.querySelector('.modal.show') !== null;
}

/** @param {number} ms */
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Adds a class to the rows of these tasks and waits for its animation.
 * @param {string[]} ids
 * @param {string} cls
 * @param {number} ms
 */
async function animateRows(ids, cls, ms) {
  const rows = ids.map(rowFor).filter((r) => r !== null);
  if (!rows.length || reduceMotion.matches) return;
  ids.forEach((id) => leaving.add(id));
  rows.forEach((r) => r.classList.add(cls));
  await wait(ms);
  ids.forEach((id) => leaving.delete(id));
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/** @returns {string[]} Ids of the task rows on screen, top to bottom. */
function visibleIds() {
  return [...els.list.querySelectorAll('.task-row[data-id]')].map((el) => /** @type {HTMLElement} */ (el).dataset.id ?? '');
}

/**
 * @param {string} id
 * @returns {HTMLElement|null}
 */
function rowFor(id) {
  return els.list.querySelector(`.task-row[data-id="${CSS.escape(id)}"]`);
}

/** @returns {string[]} Chosen task ids in on-screen order. */
function selectedIds() {
  return visibleIds().filter((id) => selection.ids.has(id));
}

/** @returns {Task[]} */
function selectedTasks() {
  return selectedIds().map((id) => store.getTask(id)).filter((t) => t !== undefined);
}

function hasSelection() {
  return selection.ids.size > 0;
}

/** @param {string} id */
function selectOnly(id) {
  selection.ids = new Set([id]);
  selection.anchor = id;
  selection.active = id;
  applySelection();
}

/** @param {string} id */
function toggleSelected(id) {
  if (selection.ids.has(id)) selection.ids.delete(id);
  else selection.ids.add(id);
  selection.anchor = id;
  selection.active = id;
  applySelection();
}

/** @param {string} id */
function selectRangeTo(id) {
  selection.ids = new Set(rangeIds(visibleIds(), selection.anchor, id));
  if (!selection.anchor) selection.anchor = id;
  selection.active = id;
  applySelection();
}

function clearSelection() {
  selection.ids.clear();
  selection.anchor = null;
  selection.active = null;
  selection.fallback = null;
  applySelection();
}

/** @param {number} delta */
function moveSelection(delta) {
  const id = stepId(visibleIds(), selection.active, delta);
  if (!id) return;
  selectOnly(id);
  focusActive();
}

/** @param {number} delta */
function extendSelection(delta) {
  const id = stepId(visibleIds(), selection.active, delta);
  if (!id) return;
  selectRangeTo(id);
  focusActive();
}

function selectAll() {
  const ids = visibleIds();
  if (!ids.length) return;
  selection.ids = new Set(ids);
  selection.anchor = ids[0];
  selection.active = ids[ids.length - 1];
  applySelection();
}

function focusActive() {
  const row = selection.active ? rowFor(selection.active) : null;
  if (!row) return;
  row.focus({ preventScroll: true });
  row.scrollIntoView({ block: 'nearest' });
}

/**
 * Picks the task to choose once `ids` leave the list: the next one below them, else the one above.
 * @param {string[]} ids
 */
function setFallbackAfter(ids) {
  const visible = visibleIds();
  const gone = new Set(ids);
  const last = Math.max(...ids.map((id) => visible.indexOf(id)));
  selection.fallback = visible.slice(last + 1).find((id) => !gone.has(id))
    ?? visible.slice(0, last).reverse().find((id) => !gone.has(id))
    ?? null;
}

/** Marks chosen rows after a render, and drops tasks that are no longer on screen. */
function applySelection() {
  const visible = new Set(visibleIds());
  for (const id of [...selection.ids]) if (!visible.has(id)) selection.ids.delete(id);
  if (!selection.ids.size && selection.fallback && visible.has(selection.fallback)) {
    selection.ids.add(selection.fallback);
    selection.anchor = selection.fallback;
    selection.active = selection.fallback;
  }
  selection.fallback = null;
  if (selection.active && !visible.has(selection.active)) selection.active = [...selection.ids].at(-1) ?? null;
  els.list.querySelectorAll('.task-row[data-id]').forEach((el) => {
    const row = /** @type {HTMLElement} */ (el);
    const id = row.dataset.id ?? '';
    const chosen = selection.ids.has(id);
    row.classList.toggle('selected', chosen);
    row.setAttribute('aria-selected', String(chosen));
    row.tabIndex = id === selection.active || (!selection.active && row === els.list.querySelector('.task-row[data-id]')) ? 0 : -1;
  });
}

// ---------------------------------------------------------------------------
// Task actions. Each works on the chosen tasks.
// ---------------------------------------------------------------------------

/** @param {Task} task */
function toggleTask(task) {
  if (leaving.has(task.id)) return;
  if (task.completed) {
    store.reopenTasks(task.id);
    return;
  }
  completeIds([task.id]);
}

/** Checks off the chosen tasks, or reopens them if they are all done already. */
function toggleSelected_() {
  const tasks = selectedTasks();
  if (!tasks.length) return;
  if (tasks.every((t) => t.completed)) {
    store.reopenTasks(tasks.map((t) => t.id));
    return;
  }
  completeIds(tasks.filter((t) => !t.completed).map((t) => t.id));
}

/**
 * @param {string[]} ids
 */
async function completeIds(ids) {
  ids = ids.filter((id) => !leaving.has(id));
  if (!ids.length) return;
  const willLeave = view.type !== 'search' && view.type !== 'completed';
  if (willLeave) setFallbackAfter(ids);
  await animateRows(ids, 'completing', COMPLETE_MS);
  const results = store.completeTasks(ids);
  if (results.length === 1) {
    const [result] = results;
    const task = store.getTask(result.id);
    if (result.repeated && result.nextDue) {
      toast(`Nice! "${task?.title}" is next due ${formatDue(result.nextDue).toLowerCase()}.`, { undo: true });
    } else {
      toast('Task completed.', { undo: true });
    }
  } else if (results.length > 1) {
    toast(`${plural(results.length, 'task')} completed.`, { undo: true });
  }
}

/**
 * Moves tasks to the Trash.
 * @param {string[]} ids
 */
async function trashIds(ids) {
  ids = ids.filter((id) => !leaving.has(id));
  if (!ids.length) return;
  const first = store.getTask(ids[0]);
  setFallbackAfter(ids);
  await animateRows(ids, 'leaving', LEAVE_MS);
  store.deleteTasks(ids);
  toast(ids.length === 1 ? `Moved "${first?.title}" to the Trash.` : `Moved ${plural(ids.length, 'task')} to the Trash.`, { undo: true });
}

/** @param {Task} task */
function removeTask(task) {
  trashIds([task.id]);
}

/** @param {string[]} ids */
async function restoreIds(ids) {
  if (!ids.length) return;
  setFallbackAfter(ids);
  await animateRows(ids, 'leaving', LEAVE_MS);
  store.restoreTasks(ids);
  toast(ids.length === 1 ? 'Task restored.' : `${plural(ids.length, 'task')} restored.`, { undo: true });
}

/** @param {string[]} ids */
async function purgeIds(ids) {
  if (!ids.length) return;
  setFallbackAfter(ids);
  await animateRows(ids, 'leaving', LEAVE_MS);
  store.purgeTasks(ids);
  toast(ids.length === 1 ? 'Deleted for good.' : `${plural(ids.length, 'task')} deleted for good.`, { undo: true });
}

/** @param {1|2|3|4} priority */
function setPriority(priority) {
  const ids = selectedIds();
  if (ids.length) store.updateTask(ids, { priority });
}

/** @param {string} projectId */
function moveSelectedTo(projectId) {
  const ids = selectedTasks().filter((t) => !t.parentId).map((t) => t.id);
  if (!ids.length) return;
  if (view.type === 'project' && view.id !== projectId) setFallbackAfter(ids);
  store.updateTask(ids, { projectId });
  toast(`Moved ${ids.length === 1 ? 'task' : plural(ids.length, 'task')} to ${store.getProject(projectId)?.name}.`, { undo: true });
}

/**
 * Finds or creates the project named in Quick Add.
 * @param {string} name
 * @returns {Project}
 */
function resolveProject(name) {
  const existing = store.findProjectByName(name);
  if (existing) return existing;
  const colors = Object.keys(PROJECT_COLORS).filter((c) => c !== 'gray');
  const color = colors[store.getData().projects.length % colors.length];
  const project = store.addProject(name.replace(/[_-]+/g, ' '), color);
  toast(`Created new project "${project.name}".`);
  return project;
}

/**
 * What a draft will become: the parsed text plus defaults from where it's
 * being added (the view's project or label, or the day section's date).
 * @param {string} text
 * @param {string} slot
 */
function resolveDraft(text, slot) {
  const parsed = parseQuickAdd(text);
  const slotDue = slot.startsWith('day:') ? slot.slice(4) : view.type === 'today' ? todayISO() : null;
  const labels = [...parsed.labels];
  if (view.type === 'label' && !labels.some((l) => l.toLowerCase() === /** @type {{name: string}} */ (view).name.toLowerCase())) {
    labels.push(view.name);
  }
  return {
    title: parsed.title,
    projectName: parsed.projectName,
    projectId: view.type === 'project' ? view.id : INBOX_ID,
    due: parsed.due ?? slotDue,
    recurrence: parsed.recurrence,
    priority: parsed.priority ?? 4,
    labels,
  };
}

/**
 * Adds a task from the inline composer.
 * @param {string} text
 * @param {string} slot
 * @returns {boolean} Whether a task was added.
 */
function addTaskFromDraft(text, slot) {
  const { projectName, ...fields } = resolveDraft(text, slot);
  if (!fields.title) return false;
  if (projectName) fields.projectId = resolveProject(projectName).id;
  justAddedId = store.addTask(fields).id;
  return true;
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

/**
 * @param {{label: string, icon?: SVGElement|HTMLElement, count?: number, active: boolean, onClick: () => void,
 *   onDrop?: (taskId: string) => void}} item
 * @returns {HTMLLIElement}
 */
function navItem({ label, icon: iconEl, count, active, onClick, onDrop }) {
  const link = h('a', { href: '#', class: `nav-link${active ? ' active' : ''}`, 'aria-current': active ? 'page' : null },
    iconEl, h('span', { class: 'nav-name' }, label),
    count ? h('span', { class: 'nav-count' }, String(count)) : null);
  link.addEventListener('click', (e) => {
    e.preventDefault();
    onClick();
  });
  if (onDrop) {
    link.addEventListener('dragover', (e) => {
      if (!draggedId) return;
      e.preventDefault();
      link.classList.add('drop-target');
    });
    link.addEventListener('dragleave', () => link.classList.remove('drop-target'));
    link.addEventListener('drop', (e) => {
      e.preventDefault();
      link.classList.remove('drop-target');
      if (draggedId) onDrop(draggedId);
    });
  }
  return h('li', { class: 'nav-item' }, link);
}

/** @param {string} color */
function projectDot(color) {
  const dot = h('span', { class: 'project-dot' });
  dot.style.backgroundColor = PROJECT_COLORS[color] ?? PROJECT_COLORS.gray;
  return dot;
}

function renderSidebar() {
  const data = store.getData();
  const today = todayISO();
  const active = activeTasks();
  const countIn = (/** @type {string} */ projectId) => active.filter((t) => t.projectId === projectId).length;
  const moveTo = (/** @type {string} */ projectId) => (/** @type {string} */ id) => {
    store.updateTask(id, { projectId });
    toast(`Moved to ${store.getProject(projectId)?.name}.`, { undo: true });
  };

  els.navMain.replaceChildren(
    navItem({
      label: 'Inbox', icon: icon('inbox'), count: countIn(INBOX_ID),
      active: sameView(view, { type: 'project', id: INBOX_ID }),
      onClick: () => setView({ type: 'project', id: INBOX_ID }),
      onDrop: moveTo(INBOX_ID),
    }),
    navItem({
      label: 'Today', icon: icon('today'), count: active.filter((t) => t.due && t.due <= today).length,
      active: view.type === 'today',
      onClick: () => setView({ type: 'today' }),
      onDrop: (id) => {
        store.updateTask(id, { due: today });
        toast('Scheduled for today.', { undo: true });
      },
    }),
    navItem({
      label: 'Upcoming', icon: icon('calendar'),
      active: view.type === 'upcoming',
      onClick: () => setView({ type: 'upcoming' }),
    }),
    navItem({
      label: 'Completed', icon: icon('done'),
      active: view.type === 'completed',
      onClick: () => setView({ type: 'completed' }),
    }),
    navItem({
      label: 'Trash', icon: icon('trash'), count: trashList().length,
      active: view.type === 'trash',
      onClick: () => setView({ type: 'trash' }),
      onDrop: (id) => trashIds([id]),
    }),
  );

  els.navProjects.replaceChildren(...data.projects
    .filter((p) => p.id !== INBOX_ID)
    .map((p) => navItem({
      label: p.name, icon: projectDot(p.color), count: countIn(p.id),
      active: sameView(view, { type: 'project', id: p.id }),
      onClick: () => setView({ type: 'project', id: p.id }),
      onDrop: moveTo(p.id),
    })));
  if (data.projects.length === 1) {
    els.navProjects.append(h('li', { class: 'small text-body-secondary px-2 py-1' }, 'No projects yet. Click + to add one.'));
  }

  const labels = store.getLabels();
  els.labelsHeading.hidden = labels.length === 0;
  els.navLabels.replaceChildren(...labels.map((name) => navItem({
    label: name, icon: icon('tag'),
    count: active.filter((t) => hasLabel(t, name)).length,
    active: view.type === 'label' && view.name.toLowerCase() === name.toLowerCase(),
    onClick: () => setView({ type: 'label', name }),
    onDrop: (id) => {
      const task = store.getTask(id);
      if (task && !hasLabel(task, name)) store.updateTask(id, { labels: [...task.labels, name] });
    },
  })));
}

// ---------------------------------------------------------------------------
// Task list
// ---------------------------------------------------------------------------

/**
 * The small line under a task's title: date, subtasks, labels, parent, project.
 * Also used by the composer to preview a draft exactly as it will look.
 * @param {Pick<Task, 'id'|'due'|'recurrence'|'labels'|'projectId'|'parentId'|'completed'> & {deletedAt?: number|null}} task
 * @param {{showProject?: boolean, showParent?: boolean, isSubtask?: boolean}} options
 * @returns {HTMLDivElement}
 */
function taskMeta(task, { showProject = false, showParent = false, isSubtask = false }) {
  const today = todayISO();
  const subtasks = task.id ? store.getSubtasks(task.id) : [];
  const meta = h('div', { class: 'task-meta' });

  if (task.deletedAt) {
    const days = Math.floor((Date.now() - task.deletedAt) / DAY_MS);
    const left = Math.max(0, TRASH_DAYS - days);
    meta.append(h('span', { class: 'trash-age' }, icon('trash'),
      `Deleted ${days === 0 ? 'today' : `${plural(days, 'day')} ago`} · ${left === 0 ? 'goes today' : `${plural(left, 'day')} left`}`));
  }
  if (task.due) {
    const diff = diffDays(today, task.due);
    let cls = '';
    if (!task.completed && !task.deletedAt) cls = diff < 0 ? 'due-overdue' : diff === 0 ? 'due-today' : diff < 7 ? 'due-soon' : '';
    meta.append(h('span', { class: cls, title: task.due }, icon('calendar'), formatDue(task.due, today),
      task.recurrence ? icon('repeat') : null));
  }
  if (subtasks.length && !isSubtask) {
    const done = subtasks.filter((s) => s.completed).length;
    meta.append(h('span', { title: 'Subtasks done' }, icon('subtasks'), `${done}/${subtasks.length}`));
  }
  for (const label of task.labels) meta.append(h('span', { class: 'label' }, icon('tag'), label));
  if (showParent && task.parentId) {
    const parent = store.getTask(task.parentId);
    if (parent) meta.append(h('span', { title: 'Subtask of' }, icon('parent'), parent.title));
  }
  if (showProject) {
    const project = store.getProject(task.projectId);
    if (project) meta.append(h('span', {}, projectDot(project.color), project.name));
  }
  return meta;
}

/**
 * @param {Task} task
 * @param {{showProject?: boolean, showParent?: boolean, isSubtask?: boolean, draggable?: boolean}} options
 * @returns {HTMLElement}
 */
function taskRow(task, { showProject = false, showParent = false, isSubtask = false, draggable = false }) {
  const trashed = task.deletedAt !== null;
  const meta = taskMeta(task, { showProject, showParent, isSubtask });

  const check = trashed
    ? h('span', { class: `task-check prio-${task.priority}`, 'aria-hidden': 'true' })
    : h('button', {
      type: 'button',
      class: `task-check prio-${task.priority}${task.completed ? ' checked' : ''}`,
      'aria-label': task.completed ? `Mark "${task.title}" not done` : `Complete "${task.title}"`,
      title: task.completed ? 'Mark as not done' : 'Complete',
      tabindex: '-1',
      onclick: () => toggleTask(task),
    }, icon('check'));

  const firstLine = task.description.split('\n')[0];
  const body = h('div', { class: 'task-body' },
    h('div', { class: 'task-title' }, task.title),
    firstLine ? h('div', { class: 'task-desc' }, firstLine) : null,
    meta.childElementCount ? meta : null);

  const button = (/** @type {string} */ title, /** @type {import('./dom.js').IconName} */ name, /** @type {() => void} */ onclick) =>
    h('button', { type: 'button', class: 'btn btn-icon', title, 'aria-label': title, tabindex: '-1', onclick }, icon(name));
  const actions = trashed
    ? h('div', { class: 'task-actions' },
      button('Restore', 'restore', () => restoreIds([task.id])),
      button('Delete forever', 'trash', () => purgeIds([task.id])))
    : h('div', { class: 'task-actions' },
      button('Edit', 'edit', () => openTaskModal(task.id)),
      button('Move to Trash', 'trash', () => removeTask(task)));

  const row = h('div', {
    class: `task-row${isSubtask ? ' subtask' : ''}${task.completed ? ' is-completed' : ''}${task.id === justAddedId ? ' entering' : ''}`,
    'data-id': task.id,
    role: 'option',
    tabindex: '-1',
    draggable: draggable ? 'true' : null,
  }, check, body, actions);

  row.addEventListener('click', (e) => {
    if (/** @type {HTMLElement} */ (e.target).closest('button')) return;
    if (IS_MAC ? e.metaKey : e.ctrlKey) {
      toggleSelected(task.id);
    } else if (e.shiftKey) {
      selectRangeTo(task.id);
    } else {
      selectOnly(task.id);
      if (!trashed) openTaskModal(task.id);
    }
  });
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!selection.ids.has(task.id)) selectOnly(task.id);
    row.focus({ preventScroll: true });
    openContextMenu(e.clientX, e.clientY);
  });

  if (draggable) attachDragHandlers(row, task.id);
  return row;
}

/**
 * Drag-to-reorder within a project list.
 * @param {HTMLElement} row
 * @param {string} id
 */
function attachDragHandlers(row, id) {
  row.addEventListener('dragstart', (e) => {
    draggedId = id;
    row.classList.add('dragging');
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
    }
  });
  row.addEventListener('dragend', () => {
    draggedId = null;
    row.classList.remove('dragging');
    els.list.querySelectorAll('.drop-before, .drop-after').forEach((el) => el.classList.remove('drop-before', 'drop-after'));
  });
  row.addEventListener('dragover', (e) => {
    if (!draggedId || draggedId === id) return;
    e.preventDefault();
    const rect = row.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    row.classList.toggle('drop-after', after);
    row.classList.toggle('drop-before', !after);
  });
  row.addEventListener('dragleave', () => row.classList.remove('drop-before', 'drop-after'));
  row.addEventListener('drop', (e) => {
    e.preventDefault();
    const after = row.classList.contains('drop-after');
    row.classList.remove('drop-before', 'drop-after');
    if (!draggedId || draggedId === id) return;
    const ids = [...els.list.querySelectorAll('.task-row[draggable]')]
      .map((el) => /** @type {HTMLElement} */ (el).dataset.id ?? '')
      .filter((x) => x && x !== draggedId);
    const index = ids.indexOf(id) + (after ? 1 : 0);
    ids.splice(index, 0, draggedId);
    store.reorderTasks(ids);
  });
}

/**
 * @param {string} text
 * @param {number} [count]
 * @param {string} [extraClass]
 */
function sectionHeading(text, count, extraClass = '') {
  return h('div', { class: `section-heading ${extraClass}` }, text,
    count !== undefined ? h('span', { class: 'count' }, String(count)) : null);
}

/**
 * @param {string} emoji
 * @param {string} title
 * @param {string} hint
 */
function emptyState(emoji, title, hint) {
  return h('div', { class: 'empty-state' },
    h('div', { class: 'big' }, emoji),
    h('div', { class: 'fw-semibold mb-1' }, title),
    h('div', { class: 'small' }, hint));
}

/**
 * The project/Inbox view: tasks in manual order with subtasks underneath.
 * @param {string} projectId
 * @returns {Node[]}
 */
function renderProjectView(projectId) {
  const tasks = activeTasks()
    .filter((t) => t.projectId === projectId && !t.parentId)
    .sort((a, b) => a.order - b.order);
  /** @type {Node[]} */
  const rows = [];
  for (const task of tasks) {
    rows.push(taskRow(task, { draggable: true }));
    for (const sub of store.getSubtasks(task.id).filter((s) => !s.completed)) {
      rows.push(taskRow(sub, { isSubtask: true }));
    }
  }
  rows.push(addSlot('end'));
  if (!tasks.length && composerSlot === null) rows.push(emptyState('🎉', 'All clear!', 'Nothing left to do here.'));
  return rows;
}

/** @returns {Node[]} */
function renderTodayView() {
  const today = todayISO();
  const due = activeTasks().filter((t) => t.due && t.due <= today);
  const overdue = due.filter((t) => /** @type {string} */ (t.due) < today).sort(byDueThenPriority);
  const todays = due.filter((t) => t.due === today).sort(byPriority);
  const row = (/** @type {Task} */ t) => taskRow(t, { showProject: true, showParent: true });

  /** @type {Node[]} */
  const out = [];
  if (overdue.length) {
    out.push(sectionHeading('Overdue', overdue.length, 'overdue'), ...overdue.map(row),
      sectionHeading(formatDayHeading(today, today), todays.length));
  }
  out.push(...todays.map(row), addSlot('end'));
  if (!due.length && composerSlot === null) out.push(emptyState('☀️', 'Nothing due today', 'Enjoy your day!'));
  return out;
}

/** @returns {Node[]} */
function renderUpcomingView() {
  const today = todayISO();
  const active = activeTasks().filter((t) => t.due);
  const row = (/** @type {Task} */ t) => taskRow(t, { showProject: true, showParent: true });
  /** @type {Node[]} */
  const out = [];

  const overdue = active.filter((t) => /** @type {string} */ (t.due) < today).sort(byDueThenPriority);
  if (overdue.length) out.push(sectionHeading('Overdue', overdue.length, 'overdue'), ...overdue.map(row));

  for (let i = 0; i < 7; i++) {
    const day = addDays(today, i);
    const tasks = active.filter((t) => t.due === day).sort(byPriority);
    out.push(sectionHeading(formatDayHeading(day, today), tasks.length || undefined), ...tasks.map(row),
      addSlot(`day:${day}`));
  }

  const lastDay = addDays(today, 6);
  const later = active.filter((t) => /** @type {string} */ (t.due) > lastDay).sort(byDueThenPriority);
  if (later.length) out.push(sectionHeading('Later', later.length), ...later.map(row));
  return out;
}

/**
 * @param {string} name
 * @returns {Node[]}
 */
function renderLabelView(name) {
  const tasks = activeTasks().filter((t) => hasLabel(t, name)).sort(byDueThenPriority);
  return [
    ...tasks.map((t) => taskRow(t, { showProject: true, showParent: true })),
    addSlot('end'),
    !tasks.length && composerSlot === null
      ? emptyState('🏷️', `No open tasks with @${name}`, 'Tasks you add here get this label automatically.')
      : null,
  ].filter((n) => n !== null);
}

/** @returns {Node[]} */
function renderCompletedView() {
  const done = store.liveTasks()
    .filter((t) => t.completed)
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
  if (!done.length) return [emptyState('✅', 'No completed tasks yet', 'Tasks you check off will show up here.')];
  const today = todayISO();
  /** @type {Node[]} */
  const out = [];
  let currentDay = '';
  for (const task of done) {
    const day = toISODate(new Date(task.completedAt ?? task.createdAt));
    if (day !== currentDay) {
      currentDay = day;
      out.push(sectionHeading(formatDayHeading(day, today)));
    }
    out.push(taskRow(task, { showProject: true, showParent: true }));
  }
  return out;
}

/** @returns {Node[]} */
function renderTrashView() {
  const tasks = trashList();
  if (!tasks.length) return [emptyState('🗑️', 'The Trash is empty', `Deleted tasks stay here for ${TRASH_DAYS} days.`)];
  return [
    h('p', { class: 'small text-body-secondary mb-2' }, `Tasks in the Trash are deleted for good after ${TRASH_DAYS} days.`),
    ...tasks.map((t) => taskRow(t, { showProject: true, showParent: true })),
  ];
}

/**
 * @param {string} query
 * @returns {Node[]}
 */
function renderSearchView(query) {
  const q = query.toLowerCase();
  const matches = store.liveTasks()
    .filter((t) => t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)
      || t.labels.some((l) => l.toLowerCase().includes(q)))
    .sort((a, b) => Number(a.completed) - Number(b.completed) || byDueThenPriority(a, b));
  if (!matches.length) return [emptyState('🔍', 'No matches', `Nothing found for "${query}".`)];
  return matches.map((t) => taskRow(t, { showProject: true, showParent: true }));
}

/** @returns {string} Title for the current view. */
function viewTitle() {
  switch (view.type) {
    case 'project': return store.getProject(view.id)?.name ?? 'Inbox';
    case 'today': return 'Today';
    case 'upcoming': return 'Upcoming';
    case 'completed': return 'Completed';
    case 'trash': return 'Trash';
    case 'label': return `@${view.name}`;
    case 'search': return `Search: ${view.query}`;
  }
}

/**
 * @param {string} label
 * @param {() => void} onClick
 * @param {boolean} [danger]
 */
function menuItem(label, onClick, danger = false) {
  return h('li', {}, h('button', { type: 'button', class: `dropdown-item${danger ? ' text-danger' : ''}`, onclick: onClick }, label));
}

function renderViewMenu() {
  /** @type {HTMLLIElement[]} */
  const items = [];
  if (view.type === 'project' && view.id !== INBOX_ID) {
    const project = store.getProject(view.id);
    if (project) {
      items.push(
        menuItem('Edit project', () => openProjectModal(project.id)),
        menuItem('Delete project', () => deleteProjectFlow(project), true));
    }
  } else if (view.type === 'completed' && store.liveTasks().some((t) => t.completed)) {
    items.push(menuItem('Move all completed tasks to the Trash', () => {
      store.clearCompleted();
      toast('Completed tasks moved to the Trash.', { undo: true });
    }, true));
  } else if (view.type === 'trash' && trashList().length) {
    items.push(menuItem('Empty the Trash', emptyTrashFlow, true));
  } else if (view.type === 'label') {
    const name = view.name;
    items.push(menuItem('Remove label from all tasks', () => {
      store.deleteLabel(name);
      setView({ type: 'project', id: INBOX_ID });
      toast(`Removed @${name}.`, { undo: true });
    }, true));
  }
  els.viewMenu.hidden = items.length === 0;
  els.viewMenuItems.replaceChildren(...items);
}

/** @param {Project} project */
async function deleteProjectFlow(project) {
  const count = store.liveTasks().filter((t) => t.projectId === project.id).length;
  const ok = await confirmAction(`Delete "${project.name}"?`,
    count ? `Its ${plural(count, 'task')} will go to the Trash.` : 'This project has no tasks.');
  if (!ok) return;
  store.deleteProject(project.id);
  setView({ type: 'project', id: INBOX_ID });
  toast(`Deleted project "${project.name}".`, { undo: true });
}

async function emptyTrashFlow() {
  const count = trashList().length;
  if (!count) return;
  const ok = await confirmAction('Empty the Trash?', `${plural(count, 'task')} will be deleted for good. You can still undo right after.`, 'Empty Trash');
  if (!ok) return;
  store.emptyTrash();
  toast('Trash emptied.', { undo: true });
}

function renderMain() {
  // Fall back to the Inbox if the current project or label no longer exists.
  if (view.type === 'project' && !store.getProject(view.id)) view = { type: 'project', id: INBOX_ID };
  if (view.type === 'label' && !store.getLabels().some((l) => l.toLowerCase() === /** @type {{name: string}} */ (view).name.toLowerCase())) {
    view = { type: 'project', id: INBOX_ID };
  }

  els.title.textContent = viewTitle();
  document.title = `${viewTitle()} – Taskite`;
  renderViewMenu();

  /** @type {Node[]} */
  let nodes;
  switch (view.type) {
    case 'project': nodes = renderProjectView(view.id); break;
    case 'today': nodes = renderTodayView(); break;
    case 'upcoming': nodes = renderUpcomingView(); break;
    case 'label': nodes = renderLabelView(view.name); break;
    case 'completed': nodes = renderCompletedView(); break;
    case 'trash': nodes = renderTrashView(); break;
    case 'search': nodes = renderSearchView(view.query); break;
  }
  // Re-rendering replaces the rows; keep the cursor in the composer or on the chosen task.
  const hadComposerFocus = document.activeElement === composerInput;
  const hadRowFocus = els.list.contains(document.activeElement) && document.activeElement !== composerInput;
  renderingList = true;
  els.list.replaceChildren(...nodes);
  renderingList = false;
  justAddedId = null;
  applySelection();
  if (hadComposerFocus && composerRow.isConnected) composerInput.focus();
  else if (hadRowFocus || (document.activeElement === document.body && selection.active)) focusActive();
}

function render() {
  renderSidebar();
  renderMain();
  if (editingTaskId) renderSubtaskEditor();
}

// ---------------------------------------------------------------------------
// Adding tasks: a quiet "+ Add task" row that turns into an inline composer
// shaped exactly like a task row, so committing a task causes no layout jump.
// ---------------------------------------------------------------------------

const composerInput = h('input', {
  type: 'text',
  class: 'composer-input',
  placeholder: 'Task name — try “tomorrow p1 #Work @phone”',
  'aria-label': 'New task',
  autocomplete: 'off',
});
const composerCheck = h('span', { class: 'task-check prio-4', 'aria-hidden': 'true' });
const composerMeta = h('div', { class: 'task-meta' });
const composerRow = h('div', { class: 'task-row composer' },
  composerCheck,
  h('div', { class: 'task-body' }, composerInput, composerMeta),
  h('div', { class: 'composer-hint', 'aria-hidden': 'true' }, h('kbd', {}, '↵'), ' add  ', h('kbd', {}, 'esc'), ' close'));

/** Updates the composer's circle color and meta line to show what the draft will become. */
function updateComposerPreview() {
  if (composerSlot === null) return;
  const draft = resolveDraft(composerInput.value, composerSlot);
  composerCheck.className = `task-check prio-${draft.priority}`;
  const existing = draft.projectName ? store.findProjectByName(draft.projectName) : undefined;
  const meta = taskMeta(
    { id: '', due: draft.due, recurrence: draft.recurrence, labels: draft.labels,
      projectId: existing?.id ?? draft.projectId, parentId: null, completed: false },
    { showProject: view.type !== 'project' || Boolean(draft.projectName) });
  if (draft.projectName && !existing) meta.append(h('span', {}, projectDot('gray'), `${draft.projectName} (new)`));
  composerMeta.replaceChildren(...meta.childNodes);
  composerMeta.hidden = composerMeta.childElementCount === 0;
}

/**
 * The add row for a spot in the list, or the open composer if it belongs here.
 * @param {string} slot 'end', or 'day:YYYY-MM-DD' for a day in Upcoming.
 * @returns {HTMLElement}
 */
function addSlot(slot) {
  if (composerSlot === slot) {
    updateComposerPreview();
    return composerRow;
  }
  return h('button', { type: 'button', class: 'task-row add-row', tabindex: '-1', onclick: () => openComposer(slot) },
    h('span', { class: 'add-row-icon' }, icon('plus')),
    h('span', {}, 'Add task'));
}

/** @param {string} slot */
function openComposer(slot) {
  composerSlot = slot;
  clearSelection();
  renderMain();
  composerInput.focus();
  composerRow.scrollIntoView({ block: 'nearest' });
}

/** Closes the composer. Any text typed stays in it for next time. */
function closeComposer() {
  if (composerSlot === null) return;
  composerSlot = null;
  renderMain();
}

/** Opens the composer from anywhere: shortcut, menu or sidebar button. */
function startNewTask() {
  if (modalOpen()) return;
  if (view.type === 'search') setView(viewBeforeSearch);
  if (view.type === 'completed' || view.type === 'trash') setView({ type: 'project', id: INBOX_ID });
  openComposer(view.type === 'upcoming' ? `day:${todayISO()}` : 'end');
}

composerInput.addEventListener('input', updateComposerPreview);
composerInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.isComposing) {
    e.preventDefault();
    const text = composerInput.value;
    // Enter on an empty row means "I'm done adding".
    if (!text.trim() || composerSlot === null) {
      closeComposer();
      return;
    }
    composerInput.value = '';
    // Keep the text if it was only shortcuts with no task name.
    if (!addTaskFromDraft(text, composerSlot)) {
      composerInput.value = text;
      updateComposerPreview();
    }
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeComposer();
  }
});
// Clicking away from an empty composer quietly closes it. This swaps the row in
// place rather than re-rendering, so whatever was clicked still gets the click.
composerInput.addEventListener('blur', () => {
  if (renderingList || composerSlot === null || composerInput.value.trim() || !document.hasFocus()) return;
  const slot = composerSlot;
  composerSlot = null;
  if (composerRow.isConnected) composerRow.replaceWith(addSlot(slot));
});
els.addTaskBtn.addEventListener('click', startNewTask);

// ---------------------------------------------------------------------------
// Task editor
// ---------------------------------------------------------------------------

const taskForm = {
  title: /** @type {HTMLInputElement} */ ($('#task-title')),
  description: /** @type {HTMLTextAreaElement} */ ($('#task-description')),
  due: /** @type {HTMLInputElement} */ ($('#task-due')),
  recurrence: /** @type {HTMLSelectElement} */ ($('#task-recurrence')),
  priority: /** @type {HTMLSelectElement} */ ($('#task-priority')),
  project: /** @type {HTMLSelectElement} */ ($('#task-project')),
  projectGroup: /** @type {HTMLElement} */ ($('#task-project-group')),
  labels: /** @type {HTMLInputElement} */ ($('#task-labels')),
  subtasksSection: /** @type {HTMLElement} */ ($('#subtasks-section')),
  subtaskList: /** @type {HTMLElement} */ ($('#subtask-list')),
  subtaskInput: /** @type {HTMLInputElement} */ ($('#subtask-input')),
};

/** @param {string} id */
function openTaskModal(id) {
  const task = store.getTask(id);
  if (!task || task.deletedAt !== null) return;
  editingTaskId = id;
  $('#task-modal-title').textContent = task.parentId ? 'Edit subtask' : 'Edit task';
  taskForm.title.value = task.title;
  taskForm.description.value = task.description;
  taskForm.due.value = task.due ?? '';
  taskForm.recurrence.value = task.recurrence ?? '';
  taskForm.priority.value = String(task.priority);
  taskForm.project.replaceChildren(...store.getData().projects.map((p) =>
    h('option', { value: p.id, selected: p.id === task.projectId }, p.name)));
  taskForm.labels.value = task.labels.join(', ');
  // Subtasks follow their parent's project and can't have their own subtasks.
  taskForm.projectGroup.hidden = Boolean(task.parentId);
  taskForm.subtasksSection.hidden = Boolean(task.parentId);
  taskForm.subtaskInput.value = '';
  renderSubtaskEditor();
  modals.task.show();
}

function renderSubtaskEditor() {
  if (!editingTaskId) return;
  const subtasks = store.getSubtasks(editingTaskId);
  taskForm.subtaskList.replaceChildren(...subtasks.map((sub) =>
    h('div', { class: `subtask-item${sub.completed ? ' is-completed' : ''}` },
      h('button', {
        type: 'button',
        class: `task-check prio-${sub.priority}${sub.completed ? ' checked' : ''}`,
        'aria-label': sub.completed ? 'Mark not done' : 'Complete',
        onclick: () => (sub.completed ? store.reopenTasks(sub.id) : store.completeTasks(sub.id)),
      }, icon('check')),
      h('span', {}, sub.title, sub.due ? h('small', { class: 'text-body-secondary ms-2' }, formatDue(sub.due)) : null),
      h('button', { type: 'button', class: 'btn btn-icon', title: 'Delete subtask', 'aria-label': 'Delete subtask', onclick: () => store.deleteTasks(sub.id) }, icon('trash')))));
}

function addSubtaskFromInput() {
  if (!editingTaskId) return;
  const parsed = parseQuickAdd(taskForm.subtaskInput.value);
  if (!parsed.title) return;
  store.addTask({
    title: parsed.title,
    parentId: editingTaskId,
    due: parsed.due,
    recurrence: parsed.recurrence,
    priority: parsed.priority ?? 4,
    labels: parsed.labels,
  });
  taskForm.subtaskInput.value = '';
}

$('#subtask-add').addEventListener('click', addSubtaskFromInput);
taskForm.subtaskInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addSubtaskFromInput();
  }
});

$('#task-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!editingTaskId) return;
  const task = store.getTask(editingTaskId);
  if (!task) return;
  const title = taskForm.title.value.trim();
  if (!title) return;
  const recurrence = /** @type {import('./dates.js').Recurrence|null} */ (taskForm.recurrence.value || null);
  // A repeating task needs a start date; default to today.
  const due = taskForm.due.value || (recurrence ? todayISO() : null);
  /** @type {string[]} */
  const labels = [];
  for (const raw of taskForm.labels.value.split(',')) {
    const label = raw.trim().replace(/^@/, '').replace(/\s+/g, '-');
    if (label && !labels.some((l) => l.toLowerCase() === label.toLowerCase())) labels.push(label);
  }
  store.updateTask(task.id, {
    title,
    description: taskForm.description.value.trim(),
    due,
    recurrence,
    priority: /** @type {1|2|3|4} */ (Number(taskForm.priority.value)),
    labels,
    ...(task.parentId ? {} : { projectId: taskForm.project.value }),
  });
  modals.task.hide();
});

$('#task-delete').addEventListener('click', () => {
  const task = editingTaskId ? store.getTask(editingTaskId) : undefined;
  modals.task.hide();
  if (task) removeTask(task);
});

$('#task-modal').addEventListener('shown.bs.modal', () => taskForm.title.focus());
$('#task-modal').addEventListener('hidden.bs.modal', () => {
  editingTaskId = null;
  focusActive();
});

// ---------------------------------------------------------------------------
// Due date dialog: type a date the same way as in Quick Add.
// ---------------------------------------------------------------------------

const dueInput = /** @type {HTMLInputElement} */ ($('#due-input'));
const duePreview = /** @type {HTMLElement} */ ($('#due-preview'));
/** Tasks the open due date dialog will change. @type {string[]} */
let dueTargets = [];

/**
 * @param {string} text
 * @returns {{due: string|null, ok: boolean}} ok is false when the text isn't a date.
 */
function parseDueText(text) {
  const trimmed = text.trim().toLowerCase();
  if (!trimmed || trimmed === 'no date' || trimmed === 'none') return { due: null, ok: true };
  const parsed = parseQuickAdd(trimmed);
  return parsed.due && !parsed.title ? { due: parsed.due, ok: true } : { due: null, ok: false };
}

function updateDuePreview() {
  const { due, ok } = parseDueText(dueInput.value);
  duePreview.classList.toggle('text-danger', !ok);
  duePreview.textContent = !ok ? 'Not a date I understand yet.' : due ? `Due ${formatDue(due).toLowerCase()} (${due})` : 'No due date';
}

function openDueDialog() {
  dueTargets = selectedIds();
  if (!dueTargets.length) return;
  const dues = new Set(dueTargets.map((id) => store.getTask(id)?.due ?? null));
  const [only] = dues;
  dueInput.value = dues.size === 1 && only ? only : '';
  $('#due-modal-title').textContent = dueTargets.length === 1 ? 'Due date' : `Due date for ${plural(dueTargets.length, 'task')}`;
  updateDuePreview();
  modals.due.show();
}

/** @param {string|null} due */
function applyDue(due) {
  if (!dueTargets.length) return;
  // A repeating task can't be without a date, so clearing the date stops it repeating.
  store.updateTask(dueTargets, due ? { due } : { due: null, recurrence: null });
  modals.due.hide();
}

dueInput.addEventListener('input', updateDuePreview);
$('#due-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const { due, ok } = parseDueText(dueInput.value);
  if (ok) applyDue(due);
});
$('#due-quick').addEventListener('click', (e) => {
  const btn = /** @type {HTMLElement} */ (e.target).closest('[data-due]');
  if (!btn) return;
  const { due } = parseDueText(/** @type {HTMLElement} */ (btn).dataset.due ?? '');
  applyDue(due);
});
$('#due-modal').addEventListener('shown.bs.modal', () => dueInput.select());
$('#due-modal').addEventListener('hidden.bs.modal', focusActive);

// ---------------------------------------------------------------------------
// Project editor
// ---------------------------------------------------------------------------

const projectName = /** @type {HTMLInputElement} */ ($('#project-name'));
const projectColors = /** @type {HTMLElement} */ ($('#project-colors'));
let selectedColor = 'blue';

function renderColorSwatches() {
  projectColors.replaceChildren(...Object.entries(PROJECT_COLORS).map(([name, hex]) => {
    const swatch = h('button', {
      type: 'button',
      class: `color-swatch${name === selectedColor ? ' selected' : ''}`,
      title: name,
      'aria-label': name,
      'aria-pressed': String(name === selectedColor),
      onclick: () => {
        selectedColor = name;
        renderColorSwatches();
      },
    });
    swatch.style.backgroundColor = hex;
    return swatch;
  }));
}

/** @param {string|null} id Project to edit, or null to add a new one. */
function openProjectModal(id) {
  if (modalOpen()) return;
  const project = id ? store.getProject(id) : undefined;
  editingProjectId = project ? project.id : null;
  $('#project-modal-title').textContent = project ? 'Edit project' : 'Add project';
  projectName.value = project?.name ?? '';
  selectedColor = project?.color ?? 'blue';
  renderColorSwatches();
  modals.project.show();
}

$('#project-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = projectName.value.trim();
  if (!name) return;
  if (editingProjectId) {
    store.updateProject(editingProjectId, { name, color: selectedColor });
  } else {
    const project = store.addProject(name, selectedColor);
    setView({ type: 'project', id: project.id });
  }
  modals.project.hide();
});

$('#project-modal').addEventListener('shown.bs.modal', () => projectName.focus());
$('#btn-add-project').addEventListener('click', () => openProjectModal(null));

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

function applyTheme() {
  const { theme } = store.getData().settings;
  const resolved = theme === 'auto' ? (darkQuery.matches ? 'dark' : 'light') : theme;
  document.documentElement.setAttribute('data-bs-theme', resolved);
  const names = { auto: 'Match system', light: 'Light', dark: 'Dark' };
  els.themeBtn.title = `Theme: ${names[theme]} (click to change)`;
  els.themeBtn.replaceChildren(icon(theme === 'auto' ? 'auto' : theme === 'dark' ? 'moon' : 'sun'));
}

function cycleTheme() {
  /** @type {Record<string, 'auto'|'light'|'dark'>} */
  const next = { auto: 'light', light: 'dark', dark: 'auto' };
  store.updateSettings({ theme: next[store.getData().settings.theme] });
  applyTheme();
}

darkQuery.addEventListener('change', applyTheme);
els.themeBtn.addEventListener('click', cycleTheme);

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

els.search.addEventListener('input', () => {
  const query = els.search.value.trim();
  if (query) {
    view = { type: 'search', query };
    clearSelection();
    render();
  } else {
    setView(viewBeforeSearch);
  }
});

els.search.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    els.search.value = '';
    els.search.blur();
    setView(viewBeforeSearch);
  } else if (e.key === 'ArrowDown' || e.key === 'Enter') {
    // Jump from the search box into the results.
    e.preventDefault();
    moveSelection(1);
  }
});

function focusSearch() {
  if (modalOpen()) return;
  els.search.focus();
  els.search.select();
}

// ---------------------------------------------------------------------------
// Commands: one list for the keyboard, the command menu, right-click menus,
// the menu bar and the Keyboard Shortcuts window.
// ---------------------------------------------------------------------------

const inTrash = () => view.type === 'trash';
const canActOnTasks = () => hasSelection() && !inTrash();

/** @returns {Command[]} */
function commandList() {
  const doneView = view.type === 'completed';
  return [
    // File
    { id: 'task.new', title: 'New task', group: 'File', keys: ['q', 'n', 'mod+n'], anywhere: true, run: startNewTask },
    { id: 'project.new', title: 'New project…', group: 'File', run: () => openProjectModal(null) },

    // Task
    { id: 'task.complete', title: doneView ? 'Mark not done' : 'Complete', group: 'Task', keys: ['space'], context: true,
      enabled: canActOnTasks, run: toggleSelected_ },
    { id: 'task.edit', title: 'Edit…', group: 'Task', keys: ['enter'], context: true,
      enabled: () => canActOnTasks() && selection.ids.size === 1, run: () => { if (selection.active) openTaskModal(selection.active); } },
    { id: 'task.due', title: 'Set due date…', group: 'Task', keys: ['d'], context: true, enabled: canActOnTasks, run: openDueDialog },
    { id: 'task.priority1', title: 'Priority 1 (urgent)', group: 'Task', keys: ['1'], context: true, enabled: canActOnTasks, run: () => setPriority(1) },
    { id: 'task.priority2', title: 'Priority 2 (high)', group: 'Task', keys: ['2'], context: true, enabled: canActOnTasks, run: () => setPriority(2) },
    { id: 'task.priority3', title: 'Priority 3 (medium)', group: 'Task', keys: ['3'], context: true, enabled: canActOnTasks, run: () => setPriority(3) },
    { id: 'task.priority4', title: 'Priority 4 (normal)', group: 'Task', keys: ['4'], context: true, enabled: canActOnTasks, run: () => setPriority(4) },
    { id: 'task.move', title: 'Move to project…', group: 'Task', keys: ['m'], context: true,
      enabled: () => canActOnTasks() && selectedTasks().some((t) => !t.parentId), run: () => openPalette('Move to ') },
    { id: 'task.delete', title: 'Move to Trash', group: 'Task', keys: ['backspace', 'delete'], context: true, danger: true,
      enabled: canActOnTasks, run: () => trashIds(selectedIds()) },
    { id: 'task.restore', title: 'Restore', group: 'Task', keys: ['r'], context: true,
      enabled: () => inTrash() && hasSelection(), run: () => restoreIds(selectedIds()) },
    { id: 'task.purge', title: 'Delete forever', group: 'Task', keys: ['backspace', 'delete'], context: true, danger: true,
      enabled: () => inTrash() && hasSelection(), run: () => purgeIds(selectedIds()) },
    { id: 'trash.empty', title: 'Empty the Trash…', group: 'Task', enabled: () => trashList().length > 0, run: emptyTrashFlow },

    // Edit
    { id: 'edit.undo', title: 'Undo', group: 'Edit', keys: ['mod+z'], enabled: store.canUndo, run: () => store.undo() },
    { id: 'edit.redo', title: 'Redo', group: 'Edit', keys: ['mod+shift+z', 'mod+y'], enabled: store.canRedo, run: () => store.redo() },

    // Select
    { id: 'select.next', title: 'Next task', group: 'Select', keys: ['arrowdown', 'j'], run: () => moveSelection(1) },
    { id: 'select.prev', title: 'Previous task', group: 'Select', keys: ['arrowup', 'k'], run: () => moveSelection(-1) },
    { id: 'select.extendDown', title: 'Add the task below', group: 'Select', keys: ['shift+arrowdown', 'shift+j'], run: () => extendSelection(1) },
    { id: 'select.extendUp', title: 'Add the task above', group: 'Select', keys: ['shift+arrowup', 'shift+k'], run: () => extendSelection(-1) },
    { id: 'select.all', title: 'Select all tasks', group: 'Select', keys: ['mod+a'], run: selectAll },
    { id: 'select.clear', title: 'Clear selection', group: 'Select', keys: ['escape'], palette: false, enabled: hasSelection,
      run: () => {
        clearSelection();
        /** @type {HTMLElement|null} */ (document.activeElement)?.blur();
      } },

    // Go
    { id: 'go.inbox', title: 'Go to Inbox', group: 'Go', keys: ['g i'], run: () => setView({ type: 'project', id: INBOX_ID }) },
    { id: 'go.today', title: 'Go to Today', group: 'Go', keys: ['g t'], run: () => setView({ type: 'today' }) },
    { id: 'go.upcoming', title: 'Go to Upcoming', group: 'Go', keys: ['g u'], run: () => setView({ type: 'upcoming' }) },
    { id: 'go.completed', title: 'Go to Completed', group: 'Go', keys: ['g c'], run: () => setView({ type: 'completed' }) },
    { id: 'go.trash', title: 'Go to Trash', group: 'Go', keys: ['g x'], run: () => setView({ type: 'trash' }) },
    { id: 'go.search', title: 'Search', group: 'Go', keys: ['/', 'mod+f'], anywhere: true, run: focusSearch },

    // View
    { id: 'view.theme', title: 'Switch light/dark', group: 'View', run: cycleTheme },

    // Help
    { id: 'help.commands', title: 'Command menu', group: 'Help', keys: ['mod+k', 'mod+p'], anywhere: true, run: togglePalette },
    { id: 'help.shortcuts', title: 'Keyboard shortcuts', group: 'Help', keys: ['?', 'mod+/'], anywhere: true, run: showShortcuts },
  ];
}

/** Commands only the command menu lists: one per project and label. @returns {Command[]} */
function placeCommands() {
  const projects = store.getData().projects;
  const canMove = canActOnTasks() && selectedTasks().some((t) => !t.parentId);
  return [
    ...projects.filter((p) => p.id !== INBOX_ID).map((p) => ({
      id: `go.project.${p.id}`, title: `Go to ${p.name}`, group: 'Go',
      run: () => setView({ type: 'project', id: p.id }),
    })),
    ...store.getLabels().map((name) => ({
      id: `go.label.${name}`, title: `Go to @${name}`, group: 'Go',
      run: () => setView({ type: 'label', name }),
    })),
    ...(canMove ? projects.map((p) => ({
      id: `move.${p.id}`, title: `Move to ${p.name}`, group: 'Task',
      run: () => moveSelectedTo(p.id),
    })) : []),
  ];
}

/** @param {Command} c */
function isEnabled(c) {
  return c.enabled ? c.enabled() : true;
}

/**
 * Runs a command by id if it can run now. Used by the menu bar.
 * @param {string} id
 */
function runCommand(id) {
  const command = [...commandList(), ...placeCommands()].find((c) => c.id === id);
  if (command && isEnabled(command)) command.run();
}

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

/** First key of a two-key shortcut, while waiting for the second. @type {string|null} */
let pendingKey = null;
/** @type {ReturnType<typeof setTimeout>|undefined} */
let pendingTimer;

/**
 * Whether a key that also presses buttons (Space, Enter) should go to a
 * command rather than to the focused button or link.
 */
function focusAllowsListKeys() {
  const el = document.activeElement;
  return !el || el === document.body || el.matches('.task-row');
}

document.addEventListener('keydown', (e) => {
  if (e.isComposing || e.defaultPrevented) return;
  const target = /** @type {HTMLElement} */ (e.target);
  const typing = target.matches('input, textarea, select, [contenteditable]');
  const blocked = typing || modalOpen();
  const commands = commandList();

  if (pendingKey !== null) {
    const sequence = `${pendingKey} ${keyName(e.key)}`;
    pendingKey = null;
    clearTimeout(pendingTimer);
    const command = commands.find((c) => c.keys?.includes(sequence) && isEnabled(c));
    if (command && !blocked) {
      e.preventDefault();
      command.run();
      return;
    }
  }

  let startsSequence = false;
  for (const command of commands) {
    for (const shortcut of command.keys ?? []) {
      const steps = shortcutSteps(shortcut);
      if (!matchesChord(e, steps[0], IS_MAC)) continue;
      const usesMod = steps[0].includes('mod+');
      if (blocked && !(command.anywhere && usesMod)) continue;
      if (steps.length > 1) {
        startsSequence = true;
        continue;
      }
      if (!isEnabled(command)) continue;
      if ((shortcut === 'space' || shortcut === 'enter') && !focusAllowsListKeys()) continue;
      e.preventDefault();
      command.run();
      return;
    }
  }
  if (startsSequence) {
    e.preventDefault();
    pendingKey = keyName(e.key);
    pendingTimer = setTimeout(() => { pendingKey = null; }, SEQUENCE_MS);
  }
});

// ---------------------------------------------------------------------------
// Keyboard Shortcuts window, built from the command list
// ---------------------------------------------------------------------------

/** Keys that aren't commands but are worth knowing. */
const EXTRA_SHORTCUTS = [
  { group: 'File', title: 'Save the task and start the next one', keys: 'enter' },
  { group: 'File', title: 'Stop adding (on an empty row)', keys: 'enter' },
  { group: 'Select', title: 'Add or remove a task', keys: IS_MAC ? '⌘-click' : 'Ctrl-click' },
  { group: 'Select', title: 'Select a range', keys: 'Shift-click' },
  { group: 'Help', title: 'Close a window, stop adding, or clear search', keys: 'escape' },
];

/** Order of groups in the shortcuts window and menu bar. */
const GROUP_ORDER = ['File', 'Task', 'Select', 'Edit', 'Go', 'View', 'Help'];
/** @type {Record<string, string>} */
const GROUP_TITLES = { File: 'Adding', Task: 'Tasks', Select: 'Choosing tasks', Edit: 'Undo', Go: 'Going places', View: 'View', Help: 'Help' };

/**
 * @param {string} shortcut
 * @returns {HTMLElement}
 */
function shortcutKeys(shortcut) {
  const wrap = h('span', { class: 'shortcut-keys' });
  if (shortcut.includes('-click')) {
    wrap.append(h('kbd', {}, shortcut));
    return wrap;
  }
  formatShortcut(shortcut, IS_MAC).forEach((caps, i) => {
    if (i > 0) wrap.append(h('span', { class: 'then' }, 'then'));
    caps.forEach((cap) => wrap.append(h('kbd', {}, cap)));
  });
  return wrap;
}

function renderShortcuts() {
  /** @type {Map<string, {title: string, keys: string}[]>} */
  const groups = new Map(GROUP_ORDER.map((g) => [g, []]));
  for (const c of commandList()) {
    if (!c.keys?.length) continue;
    groups.get(c.group)?.push({ title: c.id === 'task.complete' ? 'Complete or reopen' : c.title, keys: c.keys[0] });
  }
  for (const extra of EXTRA_SHORTCUTS) groups.get(extra.group)?.push(extra);
  $('#shortcuts-body').replaceChildren(...[...groups].filter(([, rows]) => rows.length).map(([group, rows]) =>
    h('section', { class: 'shortcut-group' },
      h('h3', { class: 'fs-6 fw-semibold mb-2' }, GROUP_TITLES[group] ?? group),
      h('dl', { class: 'shortcut-list mb-0' }, ...rows.flatMap((row) => [
        h('dt', {}, row.title),
        h('dd', {}, shortcutKeys(row.keys)),
      ])))));
}

function showShortcuts() {
  if (document.querySelector('#shortcuts-modal.show')) {
    modals.shortcuts.hide();
    return;
  }
  if (modalOpen()) return;
  renderShortcuts();
  modals.shortcuts.show();
}

$('#btn-shortcuts').addEventListener('click', showShortcuts);

// ---------------------------------------------------------------------------
// Command menu (⌘K)
// ---------------------------------------------------------------------------

const paletteInput = /** @type {HTMLInputElement} */ ($('#palette-input'));
const paletteList = /** @type {HTMLUListElement} */ ($('#palette-list'));
/** @type {Command[]} */
let paletteItems = [];
let paletteIndex = 0;

/** @returns {string[]} Titles of recently used commands, most recent first. */
function recentCommands() {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_COMMANDS_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** @param {string} title */
function rememberCommand(title) {
  try {
    const next = [title, ...recentCommands().filter((t) => t !== title)].slice(0, MAX_RECENT_COMMANDS);
    localStorage.setItem(RECENT_COMMANDS_KEY, JSON.stringify(next));
  } catch {
    // Storage can be unavailable; the menu works without it.
  }
}

function renderPalette() {
  const all = [...commandList(), ...placeCommands()].filter((c) => c.palette !== false && isEnabled(c));
  paletteItems = filterCommands(all, paletteInput.value, recentCommands());
  paletteIndex = Math.min(paletteIndex, Math.max(0, paletteItems.length - 1));
  if (!paletteItems.length) {
    paletteList.replaceChildren(h('li', { class: 'palette-empty' }, 'No matching commands'));
    paletteInput.removeAttribute('aria-activedescendant');
    return;
  }
  paletteList.replaceChildren(...paletteItems.map((c, i) => h('li', {
    id: `palette-item-${i}`,
    class: `palette-item${i === paletteIndex ? ' active' : ''}`,
    role: 'option',
    'aria-selected': String(i === paletteIndex),
    onmousemove: () => {
      if (paletteIndex === i) return;
      paletteIndex = i;
      renderPalette();
    },
    onclick: () => runPaletteItem(i),
  },
  h('span', { class: 'palette-title' }, c.title),
  h('span', { class: 'palette-group' }, GROUP_TITLES[c.group] ?? c.group),
  c.keys?.length ? shortcutKeys(c.keys[0]) : null)));
  paletteInput.setAttribute('aria-activedescendant', `palette-item-${paletteIndex}`);
  paletteList.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
}

/** @param {number} i */
function runPaletteItem(i) {
  const command = paletteItems[i];
  if (!command) return;
  rememberCommand(command.title);
  // Run once the menu has closed, so dialogs the command opens can show.
  $('#palette-modal').addEventListener('hidden.bs.modal', () => command.run(), { once: true });
  modals.palette.hide();
}

/** @param {string} [query] */
function openPalette(query = '') {
  if (modalOpen()) return;
  paletteInput.value = query;
  paletteIndex = 0;
  renderPalette();
  modals.palette.show();
}

function togglePalette() {
  if (document.querySelector('#palette-modal.show')) modals.palette.hide();
  else openPalette();
}

paletteInput.addEventListener('input', () => {
  paletteIndex = 0;
  renderPalette();
});
paletteInput.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const n = paletteItems.length;
    if (!n) return;
    paletteIndex = (paletteIndex + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
    renderPalette();
  } else if (e.key === 'Enter' && !e.isComposing) {
    e.preventDefault();
    runPaletteItem(paletteIndex);
  }
});
$('#palette-modal').addEventListener('shown.bs.modal', () => {
  paletteInput.focus();
  paletteInput.setSelectionRange(paletteInput.value.length, paletteInput.value.length);
});
$('#palette-modal').addEventListener('hidden.bs.modal', focusActive);

// ---------------------------------------------------------------------------
// Right-click menu on tasks
// ---------------------------------------------------------------------------

/** Order of commands in the right-click menu; '-' is a divider. */
const CONTEXT_ORDER = ['task.complete', 'task.edit', 'task.due', '-',
  'task.priority1', 'task.priority2', 'task.priority3', 'task.priority4', '-',
  'task.move', '-', 'task.restore', 'task.delete', 'task.purge'];

/**
 * @param {number} x
 * @param {number} y
 */
function openContextMenu(x, y) {
  const byId = new Map(commandList().map((c) => [c.id, c]));
  /** @type {HTMLLIElement[]} */
  const items = [];
  if (selection.ids.size > 1) {
    items.push(h('li', {}, h('h6', { class: 'dropdown-header' }, `${selection.ids.size} tasks selected`)));
  }
  for (const id of CONTEXT_ORDER) {
    if (id === '-') {
      if (items.length && !items[items.length - 1].querySelector('hr')) items.push(h('li', {}, h('hr', { class: 'dropdown-divider' })));
      continue;
    }
    const c = byId.get(id);
    if (!c || !isEnabled(c)) continue;
    items.push(h('li', {}, h('button', {
      type: 'button',
      class: `dropdown-item d-flex align-items-center gap-3${c.danger ? ' text-danger' : ''}`,
      role: 'menuitem',
      onclick: () => {
        closeContextMenu();
        c.run();
      },
    }, h('span', { class: 'flex-grow-1' }, c.title), c.keys?.length ? shortcutKeys(c.keys[0]) : null)));
  }
  while (items.length && items[items.length - 1].querySelector('hr')) items.pop();
  if (!items.length) return;

  const menu = els.contextMenu;
  menu.replaceChildren(...items);
  menu.classList.add('show');
  const { innerWidth, innerHeight } = window;
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, innerWidth - rect.width - 4)}px`;
  menu.style.top = `${Math.min(y, innerHeight - rect.height - 4)}px`;
  /** @type {HTMLElement|null} */ (menu.querySelector('button'))?.focus();
}

function closeContextMenu() {
  if (!els.contextMenu.classList.contains('show')) return;
  els.contextMenu.classList.remove('show');
  focusActive();
}

els.contextMenu.addEventListener('keydown', (e) => {
  // Keys inside the menu belong to the menu, not to the task list.
  e.stopPropagation();
  const buttons = /** @type {HTMLButtonElement[]} */ ([...els.contextMenu.querySelectorAll('button')]);
  const index = buttons.indexOf(/** @type {HTMLButtonElement} */ (document.activeElement));
  if (e.key === 'Escape' || e.key === 'Tab') {
    e.preventDefault();
    closeContextMenu();
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const next = (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }
});
document.addEventListener('mousedown', (e) => {
  if (!els.contextMenu.contains(/** @type {Node} */ (e.target))) closeContextMenu();
});
window.addEventListener('blur', closeContextMenu);
$('.content').addEventListener('scroll', closeContextMenu);

// ---------------------------------------------------------------------------
// Menu bar
// ---------------------------------------------------------------------------

/** Sends the command list to the main process, which builds the menu bar from it. */
function sendMenu() {
  if (!api?.setMenu) return;
  const entries = commandList()
    .filter((c) => GROUP_ORDER.includes(c.group) && c.group !== 'Edit' && c.id !== 'select.clear')
    .map((c) => ({
      id: c.id,
      title: c.id === 'task.complete' ? 'Complete or reopen' : c.title,
      group: c.group,
      accelerator: c.keys?.length ? toAccelerator(c.keys[0]) : null,
    }));
  api.setMenu(entries);
}

// ---------------------------------------------------------------------------
// Saving problems
// ---------------------------------------------------------------------------

/** @type {{hide: () => void}|null} */
let saveErrorToast = null;

store.onSaveStatus((status) => {
  saveErrorToast?.hide();
  saveErrorToast = null;
  if (status.ok) {
    toast('Saved.');
    return;
  }
  saveErrorToast = toast("Couldn't save your tasks. Check there is free disk space.", {
    persist: true,
    action: { label: 'Try again', run: () => store.save() },
  });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

/** Re-render at midnight so "Today" stays correct if the app is left open. */
function scheduleMidnightRefresh() {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
  setTimeout(() => {
    render();
    scheduleMidnightRefresh();
  }, midnight.getTime() - now.getTime());
}

async function start() {
  hydrateIcons();
  await store.init(api);
  const saved = store.getData().settings.lastView;
  if (saved) {
    view = saved;
    viewBeforeSearch = saved;
  }
  store.subscribe(render);
  api.onMenuCommand(runCommand);
  sendMenu();
  applyTheme();
  render();
  scheduleMidnightRefresh();
}

start().catch((err) => {
  console.error(err);
  els.list.replaceChildren(h('div', { class: 'alert alert-danger' }, `Couldn't load your tasks: ${err.message}`));
});
