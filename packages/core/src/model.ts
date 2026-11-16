/**
 * The data file (PRD §3.1): types, defaults, repair of older or hand-edited files, and the exact text
 * written to disk.
 */
import { RECURRENCES, isISODate, type Recurrence } from './dates.ts';
import type { Priority } from './parser.ts';

export interface Task {
  id: string;
  title: string;
  description: string;
  projectId: string;
  /** Set for subtasks (one level deep). */
  parentId: string | null;
  labels: string[];
  /** 1 = most urgent, 4 = normal. */
  priority: Priority;
  /** YYYY-MM-DD. */
  due: string | null;
  recurrence: Recurrence | null;
  completed: boolean;
  /** Epoch ms. */
  completedAt: number | null;
  /** Epoch ms. */
  createdAt: number;
  /** Position within its project. */
  order: number;
  /** Epoch ms when moved to the Trash. */
  deletedAt: number | null;
  /** The project section it sits in. Left out for tasks above the first section. */
  /**
   * The day of the month a monthly or yearly repeat falls on, kept only while a short month has pulled the
   * due date earlier (the 31st due on Feb 28), so the next check-off goes back to it (PRD §4.3).
   */
  repeatDay?: number;
  sectionId?: string;
}

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
} as const;

export type ProjectColor = keyof typeof PROJECT_COLORS;

export const PROJECT_COLOR_NAMES = Object.keys(PROJECT_COLORS) as ProjectColor[];

/** A named group of tasks inside a project (PRD §6). */
export interface ProjectSection {
  id: string;
  name: string;
}

export interface Project {
  id: string;
  name: string;
  color: ProjectColor;
  /** In display order. Left out of the file until the project gets one. */
  sections?: ProjectSection[];
  /** How the project shows. Left out for the list. */
  view?: 'board';
}

/** A screen the app can show, saved so it reopens there. */
export type SavedView =
  | { type: 'project'; id: string }
  | { type: 'today' }
  | { type: 'upcoming' }
  | { type: 'completed' }
  | { type: 'trash' }
  | { type: 'label'; name: string };

export type Theme = 'auto' | 'light' | 'dark';

export interface Settings {
  theme: Theme;
  lastView: SavedView | null;
  /** Views list checked-off tasks too. Left out of the file until it is first turned on. */
  showCompleted?: boolean;
}

export interface AppData {
  version: number;
  projects: Project[];
  tasks: Task[];
  settings: Settings;
  /**
   * Colours chosen for labels, keyed by the label in lower case. Left out of the file until a label gets
   * one, so files without coloured labels stay as 1.x wrote them.
   */
  labelColors?: Record<string, ProjectColor>;
}

export const FORMAT_VERSION = 1;
export const INBOX_ID = 'inbox';
/** Days a task stays in the Trash before it is removed for good (PRD §4.6). */
export const TRASH_DAYS = 30;
export const DAY_MS = 24 * 60 * 60 * 1000;
/** Longest project name (PRD §6). */
export const MAX_PROJECT_NAME = 80;

export function emptyData(): AppData {
  return {
    version: FORMAT_VERSION,
    projects: [{ id: INBOX_ID, name: 'Inbox', color: 'gray' }],
    tasks: [],
    settings: { theme: 'auto', lastView: null },
  };
}

type Loose = Record<string, unknown>;

function isObject(value: unknown): value is Loose {
  return typeof value === 'object' && value !== null;
}

function isColor(value: unknown): value is ProjectColor {
  return typeof value === 'string' && Object.hasOwn(PROJECT_COLORS, value);
}

function normalizeView(raw: unknown): SavedView | null {
  if (!isObject(raw)) return null;
  const type = raw['type'];
  if (type === 'today' || type === 'upcoming' || type === 'completed' || type === 'trash') return { type };
  if (type === 'project' && typeof raw['id'] === 'string') return { type, id: raw['id'] };
  if (type === 'label' && typeof raw['name'] === 'string') return { type, name: raw['name'] };
  return null;
}

/**
 * Fills in anything missing so older or hand-edited files load (PRD §3.2). Fields this version doesn't
 * know are kept as they are, so a file from a newer Taskite loses nothing when this one saves it.
 */
export function normalize(raw: unknown, now: number = Date.now()): AppData {
  const base = emptyData();
  if (!isObject(raw)) return base;
  const rawProjects = Array.isArray(raw['projects']) ? (raw['projects'] as unknown[]) : [];
  const projects: Project[] = rawProjects
    .filter((p): p is Loose => isObject(p) && Boolean(p['id']) && Boolean(p['name']))
    .map((p) => {
      const { sections: rawSections, view, ...rest } = p;
      const sections = Array.isArray(rawSections)
        ? (rawSections as unknown[])
            .filter((s): s is Loose => isObject(s) && Boolean(s['id']) && typeof s['name'] === 'string')
            .map((s) => ({ ...s, id: String(s['id']), name: s['name'] as string }))
        : [];
      return {
        ...rest,
        id: String(p['id']),
        name: String(p['name']),
        color: isColor(p['color']) ? p['color'] : 'gray',
        ...(sections.length ? { sections } : {}),
        ...(view === 'board' ? { view } : {}),
      };
    });
  if (!projects.some((p) => p.id === INBOX_ID)) projects.unshift(...base.projects);
  const projectIds = new Set(projects.map((p) => p.id));
  const sectionIds = new Set(projects.flatMap((p) => (p.sections ?? []).map((s) => `${p.id}/${s.id}`)));
  const rawTasks = Array.isArray(raw['tasks']) ? (raw['tasks'] as unknown[]) : [];
  const tasks: Task[] = rawTasks
    .filter((t): t is Loose => isObject(t) && Boolean(t['id']) && typeof t['title'] === 'string')
    .map(({ sectionId, repeatDay, ...t }, i) => {
      const projectId = projectIds.has(t['projectId'] as string) ? (t['projectId'] as string) : INBOX_ID;
      return {
        ...t,
        ...(typeof sectionId === 'string' && sectionIds.has(`${projectId}/${sectionId}`)
          ? { sectionId }
          : {}),
        ...(Number.isInteger(repeatDay) && (repeatDay as number) >= 1 && (repeatDay as number) <= 31
          ? { repeatDay: repeatDay as number }
          : {}),
        id: String(t['id']),
        title: t['title'] as string,
        description: typeof t['description'] === 'string' ? t['description'] : '',
        projectId,
        parentId: typeof t['parentId'] === 'string' ? t['parentId'] : null,
        labels: Array.isArray(t['labels'])
          ? (t['labels'] as unknown[]).filter((l) => typeof l === 'string')
          : [],
        priority: [1, 2, 3, 4].includes(t['priority'] as number) ? (t['priority'] as Priority) : 4,
        due: isISODate(t['due']) ? t['due'] : null,
        recurrence: RECURRENCES.includes(t['recurrence'] as Recurrence)
          ? (t['recurrence'] as Recurrence)
          : null,
        completed: Boolean(t['completed']),
        completedAt: typeof t['completedAt'] === 'number' ? t['completedAt'] : null,
        createdAt: typeof t['createdAt'] === 'number' ? t['createdAt'] : now,
        order: typeof t['order'] === 'number' ? t['order'] : i,
        deletedAt: typeof t['deletedAt'] === 'number' ? t['deletedAt'] : null,
      };
    });
  const settings = isObject(raw['settings']) ? raw['settings'] : {};
  const theme = settings['theme'];
  const labelColors: Record<string, ProjectColor> = {};
  if (isObject(raw['labelColors']))
    for (const [label, color] of Object.entries(raw['labelColors']))
      if (isColor(color)) labelColors[label.toLowerCase()] = color;
  const { labelColors: _rawColors, ...rest } = raw;
  return {
    ...rest,
    ...(Object.keys(labelColors).length ? { labelColors } : {}),
    version: FORMAT_VERSION,
    projects,
    tasks,
    settings: {
      ...settings,
      theme: theme === 'light' || theme === 'dark' ? theme : 'auto',
      lastView: normalizeView(settings['lastView']),
      ...('showCompleted' in settings ? { showCompleted: settings['showCompleted'] === true } : {}),
    },
  };
}

/** The message for a file from a newer Taskite. */
export const NEWER_FILE_MESSAGE =
  'Your tasks file was saved by a newer version of Taskite. Update Taskite to open it; the file was left as it is.';

/** The exact text written to tasks.json: two-space JSON, no trailing newline, as 1.x wrote it (PRD §3.1). */
export function serialize(data: AppData): string {
  return JSON.stringify(data, null, 2);
}

export type ParseResult =
  | { ok: true; data: AppData }
  | { ok: false; reason: 'corrupt' }
  | { ok: false; reason: 'newer'; version: number };

/**
 * Reads tasks.json text. Text that isn't JSON is reported, never thrown (PRD §3.2). So is a file whose
 * `version` is ahead of this Taskite's: reading half of a format it doesn't know and saving it back is how
 * a file gets quietly damaged.
 */
export function parseDataFile(text: string, now: number = Date.now()): ParseResult {
  let raw: unknown;
  try {
    // Some editors save a byte-order mark, which JSON.parse refuses.
    raw = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return { ok: false, reason: 'corrupt' };
  }
  // `[]` or `null` would otherwise load as an empty list and be saved over the file.
  if (!isObject(raw) || Array.isArray(raw)) return { ok: false, reason: 'corrupt' };
  const version = raw['version'];
  if (typeof version === 'number' && version > FORMAT_VERSION) return { ok: false, reason: 'newer', version };
  return { ok: true, data: normalize(raw, now) };
}

/** Task ids that have been in the Trash longer than TRASH_DAYS at `now`, with their subtasks. */
export function expiredTaskIds(data: AppData, now: number): Set<string> {
  const cutoff = now - TRASH_DAYS * DAY_MS;
  const ids = new Set(
    data.tasks.filter((t) => t.deletedAt !== null && t.deletedAt < cutoff).map((t) => t.id),
  );
  for (const t of data.tasks) if (t.parentId && ids.has(t.parentId) && t.deletedAt !== null) ids.add(t.id);
  return ids;
}
