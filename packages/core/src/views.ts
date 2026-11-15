/**
 * What each view lists (PRD §5): pure functions from the task list to sections of rows, so the UI only
 * draws them.
 */
import { addDays, formatDayHeading, toISODate } from './dates.ts';
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
  /** Where an Add task row goes after this section: `end`, or `day:YYYY-MM-DD` in Upcoming. */
  addSlot: string | null;
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

/** The sections a view lists, in order (PRD §5.2). `view` should already be resolved. */
export function viewContent(list: TaskList, view: View, today: string): ViewContent {
  const active = list.activeTasks();
  switch (view.type) {
    case 'project': {
      const tasks = active
        .filter((t) => t.projectId === view.id && !t.parentId)
        .sort((a, b) => a.order - b.order);
      const rows: Row[] = [];
      for (const task of tasks) {
        rows.push({ task, isSubtask: false });
        for (const sub of list.getSubtasks(task.id))
          if (!sub.completed) rows.push({ task: sub, isSubtask: true });
      }
      return {
        sections: [{ key: 'tasks', heading: null, count: null, tone: null, rows, addSlot: 'end' }],
        empty: tasks.length ? null : { title: 'All clear!', hint: 'Nothing left to do here.' },
        note: null,
        showContext: false,
      };
    }
    case 'today': {
      const due = active.filter((t) => t.due !== null && t.due <= today);
      const overdue = due.filter((t) => (t.due ?? '') < today).sort(byDueThenPriority);
      const todays = due.filter((t) => t.due === today).sort(byPriority);
      const sections: Section[] = [];
      if (overdue.length) sections.push(section('overdue', 'Overdue', overdue, { tone: 'overdue' }));
      sections.push(
        section('today', overdue.length ? formatDayHeading(today, today) : null, todays, { addSlot: 'end' }),
      );
      return {
        sections,
        empty: due.length ? null : { title: 'Nothing due today', hint: 'Enjoy your day!' },
        note: null,
        showContext: true,
      };
    }
    case 'upcoming': {
      const dated = active.filter((t) => t.due !== null);
      const sections: Section[] = [];
      const overdue = dated.filter((t) => (t.due ?? '') < today).sort(byDueThenPriority);
      if (overdue.length) sections.push(section('overdue', 'Overdue', overdue, { tone: 'overdue' }));
      for (let i = 0; i < 7; i++) {
        const day = addDays(today, i);
        const tasks = dated.filter((t) => t.due === day).sort(byPriority);
        sections.push(
          section(`day:${day}`, formatDayHeading(day, today), tasks, {
            count: tasks.length || null,
            addSlot: `day:${day}`,
          }),
        );
      }
      const lastDay = addDays(today, 6);
      const later = dated.filter((t) => (t.due ?? '') > lastDay).sort(byDueThenPriority);
      if (later.length) sections.push(section('later', 'Later', later));
      return { sections, empty: null, note: null, showContext: true };
    }
    case 'label': {
      const tasks = active.filter((t) => hasLabel(t, view.name)).sort(byDueThenPriority);
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
      const done = list
        .liveTasks()
        .filter((t) => t.completed)
        .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
      const sections: Section[] = [];
      for (const task of done) {
        const day = toISODate(new Date(task.completedAt ?? task.createdAt));
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
    const { title, due, recurrence, priority, labels } = draft;
    const task = list.addTask({ title, projectId, due, recurrence, priority, labels });
    return { task, createdProject };
  });
}
