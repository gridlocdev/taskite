/**
 * The data half of the `taskiteNative` bridge on iOS (PRD §13): tasks.json and its attachments in the app's
 * Documents folder, with the desktop's file rules (PRD §3.3, §3.4). Versions are the SHA-256 of the text, a
 * save refuses a file that changed since it was read, and writes go through a temp file and a rename.
 */
import {
  ATTACHMENTS_DIR,
  MAX_ATTACHMENT_BYTES,
  copyFileName,
  isAttachmentId,
  unusedAttachmentFiles,
} from '@taskite/core';
import { sha256Hex, type NativeData } from '@taskite/ui';
import type { Files } from './files.ts';

const DATA_FILE = 'tasks.json';
/** Where the file is, for people: how to find it in the Files app. */
export const DATA_LOCATION = 'Files › On My iPhone › Taskite › tasks.json';

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

function attachmentPath(id: string): string {
  if (!isAttachmentId(id)) throw new Error(`Not an attachment id: ${id}`);
  return `${ATTACHMENTS_DIR}/${id}`;
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
  return {
    load: () =>
      queue(async () => {
        const text = await files.readText(DATA_FILE);
        return { text, version: await versionOf(text), path: DATA_LOCATION, legacy: false };
      }),

    save: (text, expected) =>
      queue(async () => {
        if ((await versionOf(await files.readText(DATA_FILE))) !== expected)
          return { ok: false, reason: 'conflict' } as const;
        await writeAtomic(files, DATA_FILE, text);
        return { ok: true, version: await sha256Hex(text) } as const;
      }),

    saveCopy: (text, label) =>
      queue(async () => {
        const at = now();
        for (let n = 1; ; n++) {
          const name = copyFileName(label, at, n);
          if (await files.exists(name)) continue;
          await writeAtomic(files, name, text);
          return name;
        }
      }),

    putFile: (id, bytes) =>
      queue(async () => {
        const path = attachmentPath(id);
        if (bytes.length > MAX_ATTACHMENT_BYTES) throw new Error('The file is too large to attach.');
        if (await files.exists(path)) return 'exists' as const;
        await writeAtomic(files, path, bytes);
        return 'written' as const;
      }),

    getFile: (id) => queue(() => files.readBytes(attachmentPath(id))),

    cleanFiles: () =>
      queue(async () => {
        const listed = await files.list(ATTACHMENTS_DIR);
        const unused = unusedAttachmentFiles(await files.readText(DATA_FILE), listed, now().getTime());
        for (const name of unused) await files.remove(`${ATTACHMENTS_DIR}/${name}`);
        return unused.length;
      }),
  };
}
