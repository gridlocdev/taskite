/** The data file's name, wherever it lives (PRD §3.6). */
export const DATA_FILE = 'tasks.json';

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
