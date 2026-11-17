import { attachmentIds, isAttachmentId } from './attachments.ts';
import { parseDataFile } from './model.ts';

/** The data file's name, wherever it lives (PRD §3.6). */
export const DATA_FILE = 'tasks.json';

/** The folder beside the data file that holds attached files, each named by its attachment id (PRD §4.8). */
export const ATTACHMENTS_DIR = 'attachments';

/** How old a file no task names must be before it is deleted, so a file just written for another window survives. */
export const UNUSED_FILE_MS = 86_400_000;

export type CopyLabel = 'copy' | 'corrupt';

/**
 * The name for a copy kept next to the data file: `tasks.copy-2026-11-15-090507.json` (a "Save a copy" from a
 * conflict, local time) or `tasks.corrupt-<epoch ms>.json` (a file that couldn't be read). `n` > 1 adds `-n`
 * when the first name is taken.
 */
export function copyFileName(label: CopyLabel, now: Date, n = 1): string {
  const p = (x: number) => String(x).padStart(2, '0');
  const stamp =
    label === 'corrupt'
      ? String(now.getTime())
      : `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `tasks.${label}-${stamp}${n > 1 ? `-${n}` : ''}.json`;
}

/**
 * The files in the attachments folder to delete (PRD §4.8): attachment ids that no task in `dataText` names,
 * the Trash included, last changed more than a day before `now`. Other names are never touched, and when the
 * data file is missing or can't be read, nothing is.
 */
export function unusedAttachmentFiles(
  dataText: string | null,
  files: readonly { readonly name: string; readonly modified: number }[],
  now: number,
): string[] {
  if (dataText === null) return [];
  const parsed = parseDataFile(dataText, now);
  if (!parsed.ok) return [];
  const keep = attachmentIds(parsed.data);
  return files
    .filter((f) => isAttachmentId(f.name) && !keep.has(f.name) && f.modified < now - UNUSED_FILE_MS)
    .map((f) => f.name);
}
