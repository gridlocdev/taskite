/**
 * Files attached to tasks (PRD §4.8). The data file keeps only what the app shows about each one; the bytes
 * are in `attachments/<id>` beside it, so an id is always a UUID: it is also the file's name.
 */
import type { AppData } from './model.ts';

export interface Attachment {
  /** A UUID, and the name of the file in `attachments/`. */
  id: string;
  /** The file's name when it was attached. */
  name: string;
  /** Bytes. */
  size: number;
  /** The MIME type, or "" when it isn't known. */
  type: string;
}

/** The largest file that can be attached (PRD §4.8). */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Whether `id` can name an attachment's file: a UUID in lower case, nothing that could be a path. */
export function isAttachmentId(id: unknown): id is string {
  return typeof id === 'string' && UUID.test(id);
}

/**
 * Attachments as read from a file or handed to the engine: entries without a UUID id or a name are dropped,
 * and so are repeats of an id already in `taken` or earlier in the list. A size that isn't a whole number
 * of bytes reads as 0, a type that isn't text as "". Fields Taskite doesn't know are kept.
 */
export function cleanAttachments(raw: unknown, taken: Set<string> = new Set()): Attachment[] {
  if (!Array.isArray(raw)) return [];
  const kept: Attachment[] = [];
  for (const a of raw as unknown[]) {
    if (typeof a !== 'object' || a === null) continue;
    const { id, name, size, type } = a as Record<string, unknown>;
    if (!isAttachmentId(id) || typeof name !== 'string' || !name.trim() || taken.has(id)) continue;
    taken.add(id);
    kept.push({
      ...(a as object),
      id,
      name,
      size: Number.isSafeInteger(size) && (size as number) >= 0 ? (size as number) : 0,
      type: typeof type === 'string' ? type : '',
    });
  }
  return kept;
}

/** Every attachment id a task names, the Trash included: the files that must be kept (PRD §4.8). */
export function attachmentIds(data: AppData): Set<string> {
  return new Set(data.tasks.flatMap((t) => (t.attachments ?? []).map((a) => a.id)));
}

/** A file size as people read it: "800 B", "1.5 KB", "12 MB". */
export function formatSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = bytes;
  let u = 0;
  while (n >= 1024 && u < units.length - 1) {
    n /= 1024;
    u++;
  }
  const shown = u === 0 || n >= 10 ? Math.round(n) : Math.round(n * 10) / 10;
  return `${shown} ${units[u]}`;
}
