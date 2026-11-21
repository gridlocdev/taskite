/**
 * The list of workspaces as the app keeps it (PRD §14): read from `workspaces.json`, changed one named edit at
 * a time, and saved with a version check. A save that conflicts reads the file again and applies the same edit
 * once more, because each edit is small and says exactly what it changes (PRD §14.3).
 */
import { signal } from '@preact/signals';
import {
  MAIN_WORKSPACE_ID,
  addWorkspace,
  defaultWorkspaceList,
  findWorkspace,
  parseWorkspaces,
  removeWorkspace,
  renameWorkspace,
  restoreWorkspace,
  serializeWorkspaces,
  type Workspace,
  type WorkspaceList,
} from '@taskite/core';
import { ConflictError, type WorkspaceStore } from '@taskite/ui';

/** Why the list can't be changed: a file that isn't JSON, or one from a newer Taskite. Null when it can. */
export type ListProblem = string | null;

/** What Delete Workspace did, so Undo can put it back (PRD §14.3). */
export interface DeletedWorkspace {
  readonly workspace: Workspace;
  readonly index: number;
  readonly stamp: number;
}

export const UNREADABLE_LIST =
  "Your list of workspaces (workspaces.json) couldn't be read, so workspaces can't be changed. The file was left as it is.";
export const NEWER_LIST =
  'Your list of workspaces was saved by a newer version of Taskite. Update Taskite to change workspaces; the file was left as it is.';

export class WorkspaceDirectory {
  readonly store: WorkspaceStore;
  readonly list = signal<WorkspaceList>(defaultWorkspaceList());
  /** Set when the file can't be read or is from a newer Taskite: the list shows `main` alone and can't change. */
  readonly problem = signal<ListProblem>(null);
  #version: string | null = null;
  readonly #now: () => number;
  readonly #newId: () => string;

  constructor(store: WorkspaceStore, opts: { now?: () => number; newId?: () => string } = {}) {
    this.store = store;
    this.#now = opts.now ?? Date.now;
    this.#newId = opts.newId ?? (() => crypto.randomUUID());
  }

  /** Reads `workspaces.json`. Returns whether the list changed. */
  async load(): Promise<boolean> {
    const { text, version } = await this.store.loadList();
    if (version !== null && version === this.#version) return false;
    this.#version = version;
    const parsed = parseWorkspaces(text);
    const before = serializeWorkspaces(this.list.peek());
    if (parsed.ok) {
      this.problem.value = null;
      this.list.value = parsed.list;
    } else {
      this.problem.value = parsed.reason === 'newer' ? NEWER_LIST : UNREADABLE_LIST;
      this.list.value = defaultWorkspaceList();
    }
    return serializeWorkspaces(this.list.peek()) !== before;
  }

  get workspaces(): readonly Workspace[] {
    return this.list.value.workspaces;
  }

  find(id: string): Workspace | undefined {
    return findWorkspace(this.list.peek(), id);
  }

  /** Applies `edit` to the list on disk and saves it; on a conflict reads it again and tries once more. */
  async #edit(edit: (list: WorkspaceList) => WorkspaceList): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      const problem = this.problem.peek();
      if (problem) throw new Error(problem);
      const current = this.list.peek();
      const next = edit(current);
      if (next === current) return;
      try {
        this.#version = await this.store.saveList(serializeWorkspaces(next), this.#version);
        this.list.value = next;
        return;
      } catch (e) {
        if (!(e instanceof ConflictError) || attempt > 0) throw e;
        await this.load();
      }
    }
  }

  /** Adds a workspace after the last one and returns it. Check the name with `workspaceNameProblem` first. */
  async add(name: string): Promise<Workspace> {
    const id = this.#newId();
    await this.#edit((list) => addWorkspace(list, id, name));
    const added = this.find(id);
    if (!added) throw new Error('The workspace was not added.');
    return added;
  }

  rename(id: string, name: string): Promise<void> {
    return this.#edit((list) => renameWorkspace(list, id, name));
  }

  /** Takes the workspace off the list, then moves its folder aside (PRD §14.3). Null when it isn't listed. */
  async remove(id: string): Promise<DeletedWorkspace | null> {
    const index = this.list.peek().workspaces.findIndex((w) => w.id === id);
    const workspace = this.list.peek().workspaces[index];
    if (!workspace || id === MAIN_WORKSPACE_ID) return null;
    const stamp = this.#now();
    await this.#edit((list) => removeWorkspace(list, id));
    await this.store.deleteFolder(id, stamp);
    return { workspace, index, stamp };
  }

  /** Undo for `remove`: the folder first, then the entry, so a listed workspace always has its files. */
  async restore(deleted: DeletedWorkspace): Promise<void> {
    await this.store.restoreFolder(deleted.workspace.id, deleted.stamp);
    await this.#edit((list) => restoreWorkspace(list, deleted.workspace, deleted.index));
  }
}

/** The recovery snapshot's key for a workspace (PRD §3.5, §14.1): `main` keeps the key from before workspaces. */
export function recoveryKey(id: string): string {
  return id === MAIN_WORKSPACE_ID ? 'taskite.unsaved' : `taskite.unsaved.${id}`;
}
