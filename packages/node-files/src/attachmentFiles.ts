/**
 * Attached files on disk, in the `attachments` folder beside tasks.json (PRD §4.8), for the desktop app, the
 * NAS server and the CLI. Each is written once under its id and never changed.
 */
import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { link, mkdir, open, readFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { ATTACHMENTS_DIR, MAX_ATTACHMENT_BYTES, isAttachmentId, unusedAttachmentFiles } from '@taskite/core';
import { readDataFile, syncFolder } from './dataFile.ts';

/** The attachments folder for a data file. */
export function attachmentsDir(dataFile: string): string {
  return path.join(path.dirname(dataFile), ATTACHMENTS_DIR);
}

/** Where an attachment's bytes are. Throws for an id that isn't a UUID, so no id can reach outside the folder. */
export function attachmentPath(dataFile: string, id: string): string {
  if (!isAttachmentId(id)) throw new Error(`Not an attachment id: ${id}`);
  return path.join(attachmentsDir(dataFile), id);
}

export type AttachmentWrite = 'written' | 'exists';

/**
 * Writes an attachment's bytes once: to a temp file, flushed, then linked in under its id, which fails if the
 * id is taken, so two writers can't both win and a half-written file is never seen under the id.
 */
export async function writeAttachment(
  dataFile: string,
  id: string,
  bytes: Uint8Array,
): Promise<AttachmentWrite> {
  const target = attachmentPath(dataFile, id);
  if (bytes.length > MAX_ATTACHMENT_BYTES) throw new Error('The file is too large to attach.');
  const dir = path.dirname(target);
  await mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${id}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    const handle = await open(tmp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o644);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await link(tmp, target);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') return 'exists';
      throw e;
    }
  } finally {
    await rm(tmp, { force: true });
  }
  await syncFolder(dir);
  return 'written';
}

/** An attachment's bytes, or null when there is no such file. */
export async function readAttachment(dataFile: string, id: string): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await readFile(attachmentPath(dataFile, id)));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

/**
 * Deletes the attached files no task in the data file names that are over a day old (`unusedAttachmentFiles`).
 * Returns how many.
 */
export async function removeUnusedAttachments(dataFile: string, now: number = Date.now()): Promise<number> {
  const dir = attachmentsDir(dataFile);
  const names = await readdir(dir).catch((e: unknown) => {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  });
  const listed: { name: string; modified: number }[] = [];
  for (const name of names) {
    const s = await stat(path.join(dir, name)).catch(() => null);
    if (s?.isFile()) listed.push({ name, modified: s.mtimeMs });
  }
  const unused = unusedAttachmentFiles((await readDataFile(dataFile)).text, listed, now);
  for (const name of unused) await rm(path.join(dir, name), { force: true });
  return unused.length;
}
