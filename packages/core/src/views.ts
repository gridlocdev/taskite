/**
 * What each view lists (PRD §5): pure functions from the task list to sections of rows, so the UI only
 * draws them.
 */
import type { AutomationAction, AutomationRun, SectionAutomation } from './automations.ts';
import { addDays, firstDayOfWeek, formatDayHeading, parseISODate, startOfWeek, toISODate } from './dates.ts';
import { DAY_MS, INBOX_ID, TRASH_DAYS, type Project, type SavedView, type Task } from './model.ts';
import { parseQuickAdd, type Priority } from './parser.ts';
import { hasLabel, type TaskList } from './taskList.ts';
import type { Recurrence } from './dates.ts';

/** Every view, including Search, which isn't saved. */
export type View = SavedView | { type: 'search'; query: string };

export interface Row {
  task: Task;
  /** Drawn indented under its parent (project views). */
  isSubtask: boolean;
}

export interface Section {
  key: string;
  /** Heading above the rows, if any. */
  heading: string | null;
  /** Count shown next to the heading. */
  count: number | null;
  /** `overdue` headings are red. */
  tone: 'overdue' | null;
  rows: Row[];
  /**
   * Where an Add task row goes after this section: `end`, `day:YYYY-MM-DD` in Upcoming, or
   * `section:<id>` under a project section.
   */
  addSlot: string | null;
  /** The project section these rows sit in, for its menu. */
  sectionId?: string;
}

export interface Empty {
  title: string;
  hint: string;
}

export interface ViewContent {
  sections: Section[];
  /** Shown when the view has no tasks (and no open composer). */
  empty: Empty | null;
  /** A line above the list (the Trash). */
  note: string | null;
  /** Rows show their project and parent outside project views. */
  showContext: boolean;
  /** A project shown as a board: one column per section. */
  board?: boolean;
}

/** Sorts by due date (no date last), then priority, then manual order. */
export function byDueThenPriority(a: Task, b: Task): number {
  if (a.due !== b.due) {
    if (!a.due) return 1;
    if (!b.due) return -1;
    return a.due < b.due ? -1 : 1;
  }
  return a.priority - b.priority || a.order - b.order;
}

export function byPriority(a: Task, b: Task): number {
  return a.priority - b.priority || a.order - b.order;
}

export function sameView(a: View, b: View): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function section(
  key: string,
  heading: string | null,
  tasks: Task[],
  extra: Partial<Pick<Section, 'count' | 'tone' | 'addSlot'>> = {},
): Section {
  return {
    key,
    heading,
    count: extra.count === undefined ? (heading ? tasks.length : null) : extra.count,
    tone: extra.tone ?? null,
    rows: tasks.map((task) => ({ task, isSubtask: false })),
    addSlot: extra.addSlot ?? null,
  };
}

/** A project or label view whose project or label is gone falls back to the Inbox (PRD §5.1). */
export function resolveView(list: TaskList, view: View): View {
  if (view.type === 'project' && !list.getProject(view.id)) return { type: 'project', id: INBOX_ID };
  if (view.type === 'label' && !list.getLabels().some((l) => l.toLowerCase() === view.name.toLowerCase())) {
    return { type: 'project', id: INBOX_ID };
  }
  return view;
}

export function viewTitle(list: TaskList, view: View): string {
  switch (view.type) {
    case 'project':
      return list.getProject(view.id)?.name ?? 'Inbox';
    case 'today':
      return 'Today';
    case 'upcoming':
      return 'Upcoming';
    case 'completed':
      return 'Completed';
    case 'trash':
      return 'Trash';
    case 'label':
      return `@${view.name}`;
    case 'search':
      return `Search: ${view.query}`;
  }
}

/** Tasks matching a search: title, description or a label contains the text (PRD §5.4). */
export function searchTasks(list: TaskList, query: string): Task[] {
  const q = query.toLowerCase();
  return list
    .liveTasks()
    .filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.labels.some((l) => l.toLowerCase().includes(q)),
    )
    .sort((a, b) => Number(a.completed) - Number(b.completed) || byDueThenPriority(a, b));
}

/** "Nov 16 – 22", or "Nov 30 – Dec 6" across a month. */
function formatRange(from: string, to: string): string {
  const a = parseISODate(from);
  const b = parseISODate(to);
  const start = a.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const end =
    a.getMonth() === b.getMonth()
      ? String(b.getDate())
      : b.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${start} – ${end}`;
}

export interface ViewOptions {
  /** Where Upcoming's weeks begin (0 = Sunday); defaults to the locale's. */
  weekStart?: number;
  /**
   * Lists checked-off tasks too, after the open ones in each section: in a project or label all of them,
   * in Today those due or checked off today, in Upcoming those due today or later.
   */
  showCompleted?: boolean;
}

/** Open tasks first, then checked-off ones, each kept in the order given. */
function openFirst(tasks: Task[]): Task[] {
  return [...tasks.filter((t) => !t.completed), ...tasks.filter((t) => t.completed)];
}

/** The sections a view lists, in order (PRD §5.2). `view` should already be resolved. */
export function viewContent(list: TaskList, view: View, today: string, opts: ViewOptions = {}): ViewContent {
  const { weekStart = firstDayOfWeek(), showCompleted = false } = opts;
  const active = list.activeTasks();
  // Checked-off tasks that aren't in the Trash, for views that show them.
  const done = showCompleted ? list.liveTasks().filter((t) => t.completed) : [];
  switch (view.type) {
    case 'project': {
      const project = list.getProject(view.id);
      const projectSections = project?.sections ?? [];
      const board = project?.view === 'board';
      // A board always shows its checked-off cards, at the bottom of their column (PRD §6).
      const finished = board && !showCompleted ? list.liveTasks().filter((t) => t.completed) : done;
      const tasks = openFirst(
        [...active, ...finished]
          .filter((t) => t.projectId === view.id && !t.parentId)
          .sort((a, b) => a.order - b.order),
      );
      const rowsIn = (sectionId: string | undefined): Row[] => {
        const rows: Row[] = [];
        for (const task of tasks) {
          if (task.sectionId !== sectionId) continue;
          rows.push({ task, isSubtask: false });
          // A board card counts its subtasks instead of listing them.
          if (board) continue;
          for (const sub of list.getSubtasks(task.id))
            if (showCompleted || !sub.completed) rows.push({ task: sub, isSubtask: true });
        }
        return rows;
      };
      const loose = rowsIn(undefined);
      const sections: Section[] = [];
      // A board shows the unsectioned column only while it holds tasks or is the only one.
      if (!board || loose.length || !projectSections.length)
        sections.push({
          key: 'tasks',
          heading: board ? 'No section' : null,
          count: board ? loose.filter((r) => !r.isSubtask).length : null,
          tone: null,
          rows: loose,
          addSlot: 'end',
        });
      for (const ps of projectSections) {
        const rows = rowsIn(ps.id);
        sections.push({
          key: `section:${ps.id}`,
          heading: ps.name,
          count: rows.filter((r) => !r.isSubtask).length,
          tone: null,
          rows,
          addSlot: `section:${ps.id}`,
          sectionId: ps.id,
        });
      }
      return {
        sections,
        empty:
          tasks.length || projectSections.length
            ? null
            : { title: 'All clear!', hint: 'Nothing left to do here.' },
        note: null,
        showContext: false,
        board,
      };
    }
    case 'today': {
      const due = active.filter((t) => t.due !== null && t.due <= today);
      const overdue = due.filter((t) => (t.due ?? '') < today).sort(byDueThenPriority);
      const doneToday = done.filter(
        (t) => t.due === today || (t.completedAt !== null && toISODate(new Date(t.completedAt)) === today),
      );
      const todays = [...due.filter((t) => t.due === today).sort(byPriority), ...doneToday.sort(byPriority)];
      const sections: Section[] = [];
      if (overdue.length) sections.push(section('overdue', 'Overdue', overdue, { tone: 'overdue' }));
      sections.push(
        section('today', overdue.length ? formatDayHeading(today, today) : null, todays, { addSlot: 'end' }),
      );
      return {
        sections,
        empty:
          due.length || doneToday.length ? null : { title: 'Nothing due today', hint: 'Enjoy your day!' },
        note: null,
        showContext: true,
      };
    }
    case 'upcoming': {
      const dated = active.filter((t) => t.due !== null);
      const sections: Section[] = [];
      const overdue = dated.filter((t) => (t.due ?? '') < today).sort(byDueThenPriority);
      // Checked-off tasks join the days ahead; a past one isn't overdue.
      dated.push(...done.filter((t) => t.due !== null && t.due >= today));
      if (overdue.length) sections.push(section('overdue', 'Overdue', overdue, { tone: 'overdue' }));
      // The rest of this calendar week a day at a time, then next week together, then Later.
      const nextWeek = addDays(startOfWeek(today, weekStart), 7);
      for (let day = today; day < nextWeek; day = addDays(day, 1)) {
        const tasks = openFirst(dated.filter((t) => t.due === day).sort(byPriority));
        sections.push(
          section(`day:${day}`, formatDayHeading(day, today), tasks, {
            count: tasks.length || null,
            addSlot: `day:${day}`,
          }),
        );
      }
      const weekAfter = addDays(nextWeek, 7);
      const next = openFirst(
        dated.filter((t) => (t.due ?? '') >= nextWeek && (t.due ?? '') < weekAfter).sort(byDueThenPriority),
      );
      sections.push(
        section('next-week', `Next Week · ${formatRange(nextWeek, addDays(weekAfter, -1))}`, next, {
          count: next.length || null,
          addSlot: `day:${nextWeek}`,
        }),
      );
      const later = openFirst(dated.filter((t) => (t.due ?? '') >= weekAfter).sort(byDueThenPriority));
      if (later.length) sections.push(section('later', 'Later', later));
      return { sections, empty: null, note: null, showContext: true };
    }
    case 'label': {
      const tasks = openFirst(
        [...active, ...done].filter((t) => hasLabel(t, view.name)).sort(byDueThenPriority),
      );
      return {
        sections: [section('tasks', null, tasks, { addSlot: 'end' })],
        empty: tasks.length
          ? null
          : {
              title: `No open tasks with @${view.name}`,
              hint: 'Tasks you add here get this label automatically.',
            },
        note: null,
        showContext: true,
      };
    }
    case 'completed': {
      // Sorted by the same time the day heading uses, so a day's tasks are always together.
      const at = (t: Task) => t.completedAt ?? t.createdAt;
      const done = list
        .liveTasks()
        .filter((t) => t.completed)
        .sort((a, b) => at(b) - at(a));
      const sections: Section[] = [];
      for (const task of done) {
        const day = toISODate(new Date(at(task)));
        const last = sections[sections.length - 1];
        if (last?.key === day) last.rows.push({ task, isSubtask: false });
        else sections.push({ ...section(day, formatDayHeading(day, today), [task]), count: null });
      }
      return {
        sections,
        empty: done.length
          ? null
          : { title: 'No completed tasks yet', hint: 'Tasks you check off will show up here.' },
        note: null,
        showContext: true,
      };
    }
    case 'trash': {
      const tasks = list.trashList();
      return {
        sections: tasks.length ? [section('trash', null, tasks)] : [],
        empty: tasks.length
          ? null
          : { title: 'The Trash is empty', hint: `Deleted tasks stay here for ${TRASH_DAYS} days.` },
        note: tasks.length ? `Tasks in the Trash are deleted for good after ${TRASH_DAYS} days.` : null,
        showContext: true,
      };
    }
    case 'search': {
      const tasks = searchTasks(list, view.query);
      return {
        sections: tasks.length ? [section('results', null, tasks)] : [],
        empty: tasks.length ? null : { title: 'No matches', hint: `Nothing found for "${view.query}".` },
        note: null,
        showContext: true,
      };
    }
  }
}

/** The ids of every row a view shows, in order. */
export function visibleIds(content: ViewContent): string[] {
  return content.sections.flatMap((s) => s.rows.map((r) => r.task.id));
}

export interface SidebarCounts {
  inbox: number;
  today: number;
  trash: number;
  projects: Map<string, number>;
  labels: Map<string, number>;
}

/** The counts the sidebar shows (PRD §5.1). */
export function sidebarCounts(list: TaskList, today: string): SidebarCounts {
  const active = list.activeTasks();
  const projects = new Map<string, number>();
  for (const t of active) projects.set(t.projectId, (projects.get(t.projectId) ?? 0) + 1);
  const labels = new Map<string, number>();
  for (const name of list.getLabels()) labels.set(name, active.filter((t) => hasLabel(t, name)).length);
  return {
    inbox: projects.get(INBOX_ID) ?? 0,
    today: active.filter((t) => t.due !== null && t.due <= today).length,
    trash: list.trashList().length,
    projects,
    labels,
  };
}

/** "Deleted 3 days ago · 27 days left" (PRD §4.6). */
export function trashAge(deletedAt: number, now: number): string {
  const days = Math.floor((now - deletedAt) / DAY_MS);
  const left = Math.max(0, TRASH_DAYS - days);
  return `Deleted ${days === 0 ? 'today' : `${plural(days, 'day')} ago`} · ${left === 0 ? 'goes today' : `${plural(left, 'day')} left`}`;
}

/** How a due date is coloured: overdue red, today green, this week purple (PRD §5.2). */
export function dueTone(due: string, today: string): 'overdue' | 'today' | 'soon' | null {
  if (due < today) return 'overdue';
  if (due === today) return 'today';
  return due <= addDays(today, 6) ? 'soon' : null;
}

/** What Quick Add text will become where it's typed: parsed text plus defaults from the view (PRD §4.1). */
export interface Draft {
  title: string;
  /** A "#Name" that may not exist yet. */
  projectName: string | null;
  projectId: string;
  due: string | null;
  recurrence: Recurrence | null;
  priority: Priority;
  labels: string[];
  /** The project section an Add task row under it adds to. */
  sectionId?: string;
}

export function resolveDraft(text: string, view: View, slot: string, today: string): Draft {
  const parsed = parseQuickAdd(text, today);
  const slotDue = slot.startsWith('day:') ? slot.slice(4) : view.type === 'today' ? today : null;
  const labels = [...parsed.labels];
  if (view.type === 'label' && !labels.some((l) => l.toLowerCase() === view.name.toLowerCase())) {
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
    ...(view.type === 'project' && slot.startsWith('section:') ? { sectionId: slot.slice(8) } : {}),
  };
}

/** The name a "#Name" project gets when Quick Add creates it: "-" and "_" become spaces. */
export function projectNameFromTag(tag: string): string {
  return tag.replace(/[_-]+/g, ' ');
}

export interface AddedDraft {
  task: Task | null;
  /** The project "#Name" created, if it didn't exist. */
  createdProject: Project | null;
}

/**
 * Adds the task a draft describes, creating its "#Name" project if needed, as one undo step. Text with
 * no title adds nothing (PRD §4.1).
 */
export function addDraft(list: TaskList, draft: Draft): AddedDraft {
  if (!draft.title) return { task: null, createdProject: null };
  return list.batch(() => {
    let projectId = draft.projectId;
    let createdProject: Project | null = null;
    if (draft.projectName) {
      const existing = list.findProjectByName(draft.projectName);
      if (existing) projectId = existing.id;
      else {
        createdProject = list.addProject(projectNameFromTag(draft.projectName), list.nextProjectColor());
        projectId = createdProject.id;
      }
    }
    const { title, due, recurrence, priority, labels, sectionId } = draft;
    const task = list.addTask({
      title,
      projectId,
      due,
      recurrence,
      priority,
      labels,
      ...(sectionId ? { sectionId } : {}),
    });
    return { task, createdProject };
  });
}

/** What one action did, for `n` tasks (PRD §6.1): "completed it", "added @x to 2 tasks". */
function describeAction(list: TaskList, run: AutomationRun, n: number): string {
  const action: AutomationAction = run.action;
  const them = n === 1 ? 'it' : plural(n, 'task');
  const to = n === 1 ? '' : ` to ${plural(n, 'task')}`;
  if ('complete' in action) return `${action.complete ? 'completed' : 'reopened'} ${them}`;
  if ('priority' in action) return `set ${them} to priority ${action.priority}`;
  if ('addLabel' in action) return `added @${action.addLabel}${to}`;
  if ('removeLabel' in action)
    return `removed @${action.removeLabel}${n === 1 ? '' : ` from ${plural(n, 'task')}`}`;
  if ('due' in action) {
    const due = action.due;
    if (due === null) return n === 1 ? 'removed its date' : `removed the date from ${plural(n, 'task')}`;
    const when =
      due === 'today'
        ? 'today'
        : due === 'tomorrow'
          ? 'tomorrow'
          : due === 'nextWeek'
            ? 'next week'
            : `in ${plural(Number(due.slice(1)), 'day')}`;
    return `made ${them} due ${when}`;
  }
  return `moved ${them} to ${placeName(list, action.moveTo, run.projectId)}`;
}

/** Where a move goes: the section alone when it is in `from`'s project, else "Project › Section", or the project. */
function placeName(
  list: TaskList,
  to: { readonly projectId: string; readonly sectionId: string | null },
  from: string,
): string {
  const project = list.getProject(to.projectId);
  const section = to.sectionId ? list.getSection(to.projectId, to.sectionId) : undefined;
  if (!section) return project?.name ?? '';
  return to.projectId === from ? section.name : `${project?.name ?? ''} › ${section.name}`;
}

/**
 * What automations did in an edit, in the order they ran, each action once with how many tasks it changed:
 * "completed it, added @shipped" (PRD §6.1). Empty when none ran.
 */
export function describeAutomations(list: TaskList, runs: readonly AutomationRun[]): string {
  const groups = new Map<string, { run: AutomationRun; tasks: Set<string> }>();
  for (const run of runs) {
    const key = JSON.stringify(run.action);
    const group = groups.get(key) ?? { run, tasks: new Set<string>() };
    group.tasks.add(run.taskId);
    groups.set(key, group);
  }
  return [...groups.values()].map((g) => describeAction(list, g.run, g.tasks.size)).join(', ');
}

/**
 * One rule as a line, for the heading's ⚡ hover (PRD §6.1): "When a task enters: complete it, add @shipped".
 * Moves name the section alone when it is in `projectId`, else the project too.
 */
export function describeRule(list: TaskList, projectId: string, rule: SectionAutomation): string {
  const when = {
    enter: 'When a task enters',
    leave: 'When a task leaves',
    complete: 'When a task is completed',
  }[rule.on];
  return `${when}: ${rule.do.map((action) => ruleAction(list, projectId, action)).join(', ')}`;
}

function ruleAction(list: TaskList, projectId: string, action: AutomationAction): string {
  if ('complete' in action) return action.complete ? 'complete it' : 'reopen it';
  if ('priority' in action) return `set priority ${action.priority}`;
  if ('addLabel' in action) return `add @${action.addLabel}`;
  if ('removeLabel' in action) return `remove @${action.removeLabel}`;
  if ('due' in action) {
    const due = action.due;
    if (due === null) return 'remove its date';
    if (due === 'nextWeek') return 'make it due next week';
    if (due === 'today' || due === 'tomorrow') return `make it due ${due}`;
    return `make it due in ${plural(Number(due.slice(1)), 'day')}`;
  }
  return `move it to ${placeName(list, action.moveTo, projectId)}`;
}
