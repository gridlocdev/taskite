/**
 * Workspaces on disk (PRD §14.1): `workspaces.json` next to the main data file, every other workspace in
 * `workspaces/<id>/`, and deleted ones in `workspaces/.deleted/<id>-<epoch ms>/`. Every path is built from an
 * id the core checks first, so a bad id never reaches the file system.
 */
import { mkdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  MAIN_WORKSPACE_ID,
  WORKSPACES_FILE,
  deletedWorkspaceDir,
  isAttachmentId,
  workspaceDataPath,
} from '@taskite/core';
import { syncFolder } from './dataFile.ts';

/** `workspaces.json`, next to the main data file. */
export function workspaceListFile(mainFile: string): string {
  return path.join(path.dirname(mainFile), WORKSPACES_FILE);
}

/** A workspace's data file: `mainFile` itself for `main`, else `workspaces/<id>/tasks.json` beside it. */
export function workspaceFile(mainFile: string, id: string): string {
  const relative = workspaceDataPath(id);
  return id === MAIN_WORKSPACE_ID ? mainFile : path.join(path.dirname(mainFile), relative);
}

function folders(mainFile: string, id: string, stamp: number): { live: string; deleted: string } {
  if (!isAttachmentId(id)) throw new Error(`Not a workspace that can be deleted: ${id}`);
  if (!Number.isSafeInteger(stamp) || stamp < 0) throw new Error(`Not a time: ${stamp}`);
  const root = path.dirname(mainFile);
  return {
    live: path.dirname(workspaceFile(mainFile, id)),
    deleted: path.join(root, deletedWorkspaceDir(id, stamp)),
  };
}

async function exists(p: string): Promise<boolean> {
  return (await stat(p).catch(() => null)) !== null;
}

/** Moves `from` to `to` if `from` exists and `to` doesn't; otherwise leaves both alone. */
async function moveFolder(from: string, to: string): Promise<void> {
  if (!(await exists(from)) || (await exists(to))) return;
  await mkdir(path.dirname(to), { recursive: true });
  await rename(from, to);
  await syncFolder(path.dirname(to));
}

/** Moves a deleted workspace's folder under `workspaces/.deleted/` (PRD §14.3). A folder never made is fine. */
export async function deleteWorkspaceFolder(mainFile: string, id: string, stamp: number): Promise<void> {
  const { live, deleted } = folders(mainFile, id, stamp);
  await moveFolder(live, deleted);
}

/** Puts back the folder `deleteWorkspaceFolder` moved with the same `stamp` (Undo). */
export async function restoreWorkspaceFolder(mainFile: string, id: string, stamp: number): Promise<void> {
  const { live, deleted } = folders(mainFile, id, stamp);
  await moveFolder(deleted, live);
}
