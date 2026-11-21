/**
 * The data half of the `taskiteNative` bridge on iOS (PRD §13): tasks.json and its attachments in the app's
 * Documents folder, with the desktop's file rules (PRD §3.3, §3.4). Versions are the SHA-256 of the text, a
 * save refuses a file that changed since it was read, and writes go through a temp file and a rename.
 */
import {
  ATTACHMENTS_DIR,
  MAIN_WORKSPACE_ID,
  MAX_ATTACHMENT_BYTES,
  WORKSPACES_FILE,
  copyFileName,
  deletedWorkspaceDir,
  isAttachmentId,
  unusedAttachmentFiles,
  workspaceDir,
} from '@taskite/core';
import { sha256Hex, type NativeData } from '@taskite/ui';
import type { Files } from './files.ts';

const DATA_FILE = 'tasks.json';
/** Where the file is, for people: how to find it in the Files app. */
export const DATA_LOCATION = 'Files › On My iPhone › Taskite › tasks.json';

/** A path inside a workspace's folder (PRD §14.1); `workspaceDir` refuses an id that isn't one. */
function inWorkspace(workspace: string, name: string): string {
  const dir = workspaceDir(workspace);
  return dir ? `${dir}/${name}` : name;
}

function locationOf(workspace: string): string {
  return workspace === MAIN_WORKSPACE_ID
    ? DATA_LOCATION
    : `Files › On My iPhone › Taskite › ${inWorkspace(workspace, DATA_FILE).replaceAll('/', ' › ')}`;
}

/** Runs file work one task at a time, so a version check and its write never interleave with another save. */
function serial(): <T>(task: () => Promise<T>) => Promise<T> {
  let last: Promise<unknown> = Promise.resolve();
  return (task) => {
    // The task runs after the one before it either way; that one's failure went to its own caller.
    const run = last.then(task, task);
    last = run;
    return run;
  };
}

function attachmentPath(workspace: string, id: string): string {
  if (!isAttachmentId(id)) throw new Error(`Not an attachment id: ${id}`);
  return inWorkspace(workspace, `${ATTACHMENTS_DIR}/${id}`);
}

/** Writes through a temp file beside `path` and a rename, so `path` never holds half a file. */
async function writeAtomic(files: Files, path: string, data: string | Uint8Array): Promise<void> {
  const slash = path.lastIndexOf('/');
  const tmp = `${path.slice(0, slash + 1)}.${path.slice(slash + 1)}.${crypto.randomUUID()}.tmp`;
  await files.write(tmp, data);
  try {
    await files.rename(tmp, path);
  } catch (e) {
    if (await files.exists(tmp)) await files.remove(tmp);
    throw e;
  }
}

export function documentsData(files: Files, now: () => Date = () => new Date()): NativeData {
  const queue = serial();
  const versionOf = async (text: string | null) => (text === null ? null : await sha256Hex(text));
  const save = async (path: string, text: string, expected: string | null) => {
    if ((await versionOf(await files.readText(path))) !== expected)
      return { ok: false, reason: 'conflict' } as const;
    await writeAtomic(files, path, text);
    return { ok: true, version: await sha256Hex(text) } as const;
  };
  const move = async (from: string, to: string) => {
    if (!(await files.exists(from)) || (await files.exists(to))) return;
    await files.rename(from, to);
  };
  const folders = (workspace: string, stamp: number) => {
    if (!isAttachmentId(workspace)) throw new Error(`Not a workspace that can be deleted: ${workspace}`);
    return { live: workspaceDir(workspace), deleted: deletedWorkspaceDir(workspace, stamp) };
  };
  return {
    load: (workspace) =>
      queue(async () => {
        const text = await files.readText(inWorkspace(workspace, DATA_FILE));
        return { text, version: await versionOf(text), path: locationOf(workspace), legacy: false };
      }),

    save: (workspace, text, expected) => queue(() => save(inWorkspace(workspace, DATA_FILE), text, expected)),

    saveCopy: (workspace, text, label) =>
      queue(async () => {
        const at = now();
        for (let n = 1; ; n++) {
          const name = inWorkspace(workspace, copyFileName(label, at, n));
          if (await files.exists(name)) continue;
          await writeAtomic(files, name, text);
          return name.slice(name.lastIndexOf('/') + 1);
        }
      }),

    putFile: (workspace, id, bytes) =>
      queue(async () => {
        const path = attachmentPath(workspace, id);
        if (bytes.length > MAX_ATTACHMENT_BYTES) throw new Error('The file is too large to attach.');
        if (await files.exists(path)) return 'exists' as const;
        await writeAtomic(files, path, bytes);
        return 'written' as const;
      }),

    getFile: (workspace, id) => queue(() => files.readBytes(attachmentPath(workspace, id))),

    cleanFiles: (workspace) =>
      queue(async () => {
        const dir = inWorkspace(workspace, ATTACHMENTS_DIR);
        const listed = await files.list(dir);
        const data = await files.readText(inWorkspace(workspace, DATA_FILE));
        const unused = unusedAttachmentFiles(data, listed, now().getTime());
        for (const name of unused) await files.remove(`${dir}/${name}`);
        return unused.length;
      }),

    loadWorkspaces: () =>
      queue(async () => {
        const text = await files.readText(WORKSPACES_FILE);
        return { text, version: await versionOf(text) };
      }),

    saveWorkspaces: (text, expected) => queue(() => save(WORKSPACES_FILE, text, expected)),

    deleteWorkspace: (workspace, stamp) =>
      queue(async () => {
        const { live, deleted } = folders(workspace, stamp);
        await move(live, deleted);
      }),

    restoreWorkspace: (workspace, stamp) =>
      queue(async () => {
        const { live, deleted } = folders(workspace, stamp);
        await move(deleted, live);
      }),
  };
}
