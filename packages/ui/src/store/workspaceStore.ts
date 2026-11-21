/**
 * Where the workspaces live (PRD §14): `workspaces.json`, and a `TaskStore` per workspace. Every platform has
 * one adapter with the same contract, checked by `test/storeContract.test.ts`.
 */
import { isWorkspaceId } from '@taskite/core';
import type { StoredFile, TaskStore } from './taskStore.ts';

export interface WorkspaceStore {
  readonly kind: TaskStore['kind'];
  /** `workspaces.json`, or null text when there is none yet. */
  loadList(): Promise<StoredFile>;
  /** Saves `workspaces.json` if it still has version `expected`; returns the new version. Throws ConflictError. */
  saveList(text: string, expected: string | null): Promise<string>;
  /** The store for one workspace's data file. Throws on an id that isn't `main` or a UUID. */
  open(id: string): TaskStore;
  /** Moves a workspace's folder to `workspaces/.deleted/<id>-<stamp>/` (PRD §14.3); `main` can't be. */
  deleteFolder(id: string, stamp: number): Promise<void>;
  /** Moves back the folder `deleteFolder` moved with the same stamp (Undo). */
  restoreFolder(id: string, stamp: number): Promise<void>;
}

/** `id` when it can name a workspace; throws otherwise, so a bad id never reaches a file or a URL. */
export function checkedWorkspace(id: string): string {
  if (!isWorkspaceId(id)) throw new Error(`Not a workspace id: ${id}`);
  return id;
}

/** Which workspace this device last had open (PRD §14.1). */
export interface OpenWorkspaceMemory {
  get(): string | null;
  /** Returns false when the device wouldn't keep it; the app then opens on the first workspace next time. */
  set(id: string): boolean;
}

/** `localStorage`, under `taskite.workspace`. */
export function localWorkspaceMemory(key = 'taskite.workspace'): OpenWorkspaceMemory {
  return {
    get: () => {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set: (id) => {
      try {
        localStorage.setItem(key, id);
        return true;
      } catch {
        return false;
      }
    },
  };
}

export function memoryWorkspaceMemory(id: string | null = null): OpenWorkspaceMemory & { id: string | null } {
  const m = {
    id,
    get: () => m.id,
    set: (next: string) => {
      m.id = next;
      return true;
    },
  };
  return m;
}
