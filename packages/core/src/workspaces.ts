/**
 * The list of workspaces (PRD §14): `workspaces.json` next to `tasks.json`. Each workspace is its own data file;
 * the first, `main`, is `tasks.json` itself, so a file from before workspaces is the only workspace. Edits
 * return a new list, or the same list when nothing changes.
 */
import { isAttachmentId } from './attachments.ts';
import { DATA_FILE } from './files.ts';

/** The list's file name, next to the data file. */
export const WORKSPACES_FILE = 'workspaces.json';

/** The folder next to the data file that holds every workspace but `main`. */
export const WORKSPACES_DIR = 'workspaces';

/** The id of the first workspace, whose data file is `tasks.json` itself. It can't be deleted. */
export const MAIN_WORKSPACE_ID = 'main';

/** The name `main` gets when the list has no entry for it. */
export const DEFAULT_WORKSPACE_NAME = 'Tasks';

export const MAX_WORKSPACE_NAME = 80;

/** The newest `workspaces.json` format this Taskite reads. */
export const WORKSPACES_FORMAT_VERSION = 1;

export interface Workspace {
  /** `main`, or a UUID: also the folder name under `workspaces/`. */
  id: string;
  name: string;
}

export interface WorkspaceList {
  version: number;
  /** In switcher order; `main` is always there. */
  workspaces: Workspace[];
}

export type WorkspaceParseResult =
  | { ok: true; list: WorkspaceList }
  | { ok: false; reason: 'corrupt' }
  | { ok: false; reason: 'newer'; version: number };

type Loose = Record<string, unknown>;

function isObject(value: unknown): value is Loose {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether `id` can name a workspace: `main`, or a lower-case UUID, never anything that could be a path. */
export function isWorkspaceId(id: unknown): id is string {
  return id === MAIN_WORKSPACE_ID || isAttachmentId(id);
}

/** The list when there is no `workspaces.json`: `main` alone. */
export function defaultWorkspaceList(): WorkspaceList {
  return {
    version: WORKSPACES_FORMAT_VERSION,
    workspaces: [{ id: MAIN_WORKSPACE_ID, name: DEFAULT_WORKSPACE_NAME }],
  };
}

/**
 * Repairs a list read from a file (PRD §14.1): entries without a workspace id or a name, and repeats of an id,
 * are dropped; a missing `main` is put first; fields Taskite doesn't know are kept.
 */
export function normalizeWorkspaces(raw: Loose): WorkspaceList {
  const seen = new Set<string>();
  const workspaces: Workspace[] = [];
  for (const w of Array.isArray(raw['workspaces']) ? (raw['workspaces'] as unknown[]) : []) {
    if (!isObject(w)) continue;
    const { id, name } = w;
    if (!isWorkspaceId(id) || typeof name !== 'string' || !name.trim() || seen.has(id)) continue;
    seen.add(id);
    workspaces.push({ ...w, id, name });
  }
  if (!seen.has(MAIN_WORKSPACE_ID))
    workspaces.unshift({ id: MAIN_WORKSPACE_ID, name: DEFAULT_WORKSPACE_NAME });
  return { ...raw, version: WORKSPACES_FORMAT_VERSION, workspaces };
}

/**
 * Reads `workspaces.json` text; null (no file) is the default list. Text that isn't a JSON object is reported,
 * never thrown, and so is a list from a newer Taskite (PRD §3.2).
 */
export function parseWorkspaces(text: string | null): WorkspaceParseResult {
  if (text === null) return { ok: true, list: defaultWorkspaceList() };
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return { ok: false, reason: 'corrupt' };
  }
  if (!isObject(raw)) return { ok: false, reason: 'corrupt' };
  const version = raw['version'];
  if (typeof version === 'number' && version > WORKSPACES_FORMAT_VERSION)
    return { ok: false, reason: 'newer', version };
  return { ok: true, list: normalizeWorkspaces(raw) };
}

/** The exact text written to `workspaces.json`: two-space JSON, like the data file. */
export function serializeWorkspaces(list: WorkspaceList): string {
  return JSON.stringify(list, null, 2);
}

/** The workspace with `id`, if the list has it. */
export function findWorkspace(list: WorkspaceList, id: string): Workspace | undefined {
  return list.workspaces.find((w) => w.id === id);
}

/** The workspace named `name`, ignoring case and spaces at the ends (as the CLI's `--workspace`). */
export function findWorkspaceByName(list: WorkspaceList, name: string): Workspace | undefined {
  const key = name.trim().toLowerCase();
  return list.workspaces.find((w) => w.name.trim().toLowerCase() === key);
}

/**
 * Why `name` can't be a workspace's name, or null when it can (PRD §14.3): required, at most 80 characters,
 * and no other workspace may have it, ignoring case. `selfId` is the workspace being renamed.
 */
export function workspaceNameProblem(list: WorkspaceList, name: string, selfId?: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Give the workspace a name.';
  if (trimmed.length > MAX_WORKSPACE_NAME)
    return `A workspace name can be at most ${MAX_WORKSPACE_NAME} characters.`;
  const other = findWorkspaceByName(list, trimmed);
  if (other && other.id !== selfId) return `There's already a workspace called ${other.name}.`;
  return null;
}

function checkName(list: WorkspaceList, name: string, selfId?: string): string {
  const problem = workspaceNameProblem(list, name, selfId);
  if (problem) throw new Error(problem);
  return name.trim();
}

/** Adds a workspace after the last one. Throws on a name `workspaceNameProblem` refuses or an id that's taken. */
export function addWorkspace(list: WorkspaceList, id: string, name: string): WorkspaceList {
  if (!isAttachmentId(id) || findWorkspace(list, id)) throw new Error(`Not a new workspace id: ${id}`);
  return { ...list, workspaces: [...list.workspaces, { id, name: checkName(list, name) }] };
}

/** Renames a workspace; the same list when the name doesn't change or there is no such workspace. */
export function renameWorkspace(list: WorkspaceList, id: string, name: string): WorkspaceList {
  const current = findWorkspace(list, id);
  if (!current) return list;
  const trimmed = checkName(list, name, id);
  if (trimmed === current.name) return list;
  return { ...list, workspaces: list.workspaces.map((w) => (w.id === id ? { ...w, name: trimmed } : w)) };
}

/** Takes a workspace off the list; the same list when there is no such workspace. `main` can't be removed. */
export function removeWorkspace(list: WorkspaceList, id: string): WorkspaceList {
  if (id === MAIN_WORKSPACE_ID) throw new Error('The first workspace cannot be deleted.');
  if (!findWorkspace(list, id)) return list;
  return { ...list, workspaces: list.workspaces.filter((w) => w.id !== id) };
}

/**
 * Puts a removed workspace back at `index` (its old place, for Undo), or last when the list is shorter. The
 * same list when it's already there.
 */
export function restoreWorkspace(list: WorkspaceList, workspace: Workspace, index: number): WorkspaceList {
  if (!isAttachmentId(workspace.id) || findWorkspace(list, workspace.id)) return list;
  const workspaces = [...list.workspaces];
  workspaces.splice(Math.max(1, Math.min(index, workspaces.length)), 0, workspace);
  return { ...list, workspaces };
}

/**
 * A workspace's folder relative to the folder that holds `tasks.json`: "" for `main`, else `workspaces/<id>`.
 * Throws on an id `isWorkspaceId` refuses, so a bad id never becomes a path.
 */
export function workspaceDir(id: string): string {
  if (!isWorkspaceId(id)) throw new Error(`Not a workspace id: ${id}`);
  return id === MAIN_WORKSPACE_ID ? '' : `${WORKSPACES_DIR}/${id}`;
}

/** A workspace's data file relative to the folder that holds `tasks.json` (PRD §14.1). */
export function workspaceDataPath(id: string): string {
  const dir = workspaceDir(id);
  return dir ? `${dir}/${DATA_FILE}` : DATA_FILE;
}

/** Where a deleted workspace's folder goes, relative to the folder that holds `tasks.json` (PRD §14.3). */
export function deletedWorkspaceDir(id: string, now: number): string {
  if (!isAttachmentId(id)) throw new Error(`Not a workspace that can be deleted: ${id}`);
  return `${WORKSPACES_DIR}/.deleted/${id}-${now}`;
}
