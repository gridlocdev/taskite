/**
 * Reading and writing tasks.json on disk for the desktop app, the NAS server and the CLI (PRD §3.3, §3.4).
 * Saves are atomic (temp file, flush, rename, flush the folder) and refuse to overwrite a file that changed
 * since it was read.
 */
import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readFile, realpath, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { copyFileName, type CopyLabel } from '@taskite/core';

/** What a read found: the text and its version, or nulls when there is no file yet. */
export interface DataFileRead {
  readonly text: string | null;
  readonly version: string | null;
}

export type WriteResult =
  | { readonly ok: true; readonly version: string }
  | { readonly ok: false; readonly reason: 'conflict'; readonly version: string | null };

/** The version of some file text: the SHA-256 of its UTF-8 bytes, in hex (PRD §3.4). */
export function versionOf(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function isMissing(e: unknown): boolean {
  return (e as NodeJS.ErrnoException).code === 'ENOENT';
}

export async function readDataFile(file: string): Promise<DataFileRead> {
  try {
    const text = await readFile(file, 'utf8');
    return { text, version: versionOf(text) };
  } catch (e) {
    if (isMissing(e)) return { text: null, version: null };
    throw e;
  }
}

/** The file a path really names: a symlink's target, so saving replaces the target and keeps the link. */
async function realFile(file: string): Promise<string> {
  try {
    return await realpath(file);
  } catch (e) {
    if (isMissing(e)) return file;
    throw e;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Windows refuses a rename while another program (a virus scanner, a sync client) has the file open. */
async function renameRetrying(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await rename(from, to);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      const busy = code === 'EPERM' || code === 'EBUSY' || code === 'EACCES';
      if (process.platform !== 'win32' || !busy || attempt >= 6) throw e;
      await sleep(20 * 2 ** attempt);
    }
  }
}

/**
 * Writes `text` to `file` atomically, creating the folder if needed. A symlinked file keeps its link: the
 * text replaces the file the link points at.
 */
export async function writeAtomic(file: string, text: string): Promise<void> {
  const target = await realFile(file);
  const dir = path.dirname(target);
  await mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(target)}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    const handle = await open(tmp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o644);
    try {
      await handle.writeFile(text, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await renameRetrying(tmp, target);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
  await syncFolder(dir);
}

/** Flushes a folder so a rename in it survives a crash. Windows can't open folders; skip it there. */
async function syncFolder(dir: string): Promise<void> {
  if (process.platform === 'win32') return;
  const handle = await open(dir, 'r').catch(() => null);
  if (!handle) return;
  await handle.sync().catch(() => undefined);
  await handle.close();
}

/** A lock older than this was left by a process that died mid-save; a save takes milliseconds. */
export const STALE_LOCK_MS = 10_000;

/**
 * Holds `<file>.lock` (created exclusively) while `task` runs, so the desktop app, the server and the CLI
 * never check the version and write at the same time (PRD §3.4). Waits for another holder, and takes over a
 * lock left by a crash.
 */
async function withFileLock<T>(file: string, task: () => Promise<T>): Promise<T> {
  const target = await realFile(file);
  const lock = path.join(path.dirname(target), `.${path.basename(target)}.lock`);
  await mkdir(path.dirname(lock), { recursive: true });
  for (;;) {
    try {
      const handle = await open(lock, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o644);
      await handle.close();
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      const held = await stat(lock).catch(() => null);
      if (held && Date.now() - held.mtimeMs > STALE_LOCK_MS) await rm(lock, { force: true });
      else await sleep(15);
    }
  }
  try {
    return await task();
  } finally {
    await rm(lock, { force: true });
  }
}

/** One queue per file, so saves from one process never overlap. */
const queues = new Map<string, Promise<unknown>>();

function serialized<T>(file: string, task: () => Promise<T>): Promise<T> {
  const key = path.resolve(file);
  const run = (queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(task);
  queues.set(key, run);
  void run.finally(() => {
    if (queues.get(key) === run) queues.delete(key);
  });
  return run;
}

/**
 * Saves `text` if the file on disk still has version `expected` (null: there must be no file yet).
 * Otherwise nothing is written and the result says there was a conflict.
 */
export function writeDataFile(file: string, text: string, expected: string | null): Promise<WriteResult> {
  return serialized(file, () =>
    withFileLock(file, async () => {
      const current = await readDataFile(file);
      if (current.version !== expected) return { ok: false, reason: 'conflict', version: current.version };
      await writeAtomic(file, text);
      return { ok: true, version: versionOf(text) };
    }),
  );
}

/** Writes `text` next to `file` as a dated copy that never replaces another file. Returns the copy's path. */
export async function writeCopy(
  file: string,
  text: string,
  label: CopyLabel,
  now: Date = new Date(),
): Promise<string> {
  const dir = path.dirname(file);
  await mkdir(dir, { recursive: true });
  for (let n = 1; ; n++) {
    const target = path.join(dir, copyFileName(label, now, n));
    try {
      const handle = await open(target, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o644);
      try {
        await handle.writeFile(text, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      return target;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
  }
}
