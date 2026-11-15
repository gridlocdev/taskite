/** The rules behind the dialogs' fields, kept out of the components so they can be tested. */
import { formatDue, parseQuickAdd } from '@taskite/core';

export interface DueText {
  readonly due: string | null;
  /** False when the text isn't a date the parser knows. */
  readonly ok: boolean;
}

/** What the due date field means: "tomorrow", "fri", "jan 5", "2026-12-01", or nothing / "none" for no date. */
export function parseDueText(text: string, today: string): DueText {
  const trimmed = text.trim().toLowerCase();
  if (!trimmed || trimmed === 'no date' || trimmed === 'none') return { due: null, ok: true };
  const parsed = parseQuickAdd(trimmed, today);
  return parsed.due && !parsed.title ? { due: parsed.due, ok: true } : { due: null, ok: false };
}

/** The line under the due date field. */
export function duePreview(text: string, today: string): string {
  const { due, ok } = parseDueText(text, today);
  if (!ok) return 'Not a date I understand yet.';
  return due ? `Due ${formatDue(due, today).toLowerCase()} (${due})` : 'No due date';
}

/** The labels field: comma-separated, "@" dropped, spaces become "-", no repeats ignoring case. */
export function parseLabels(text: string): string[] {
  const labels: string[] = [];
  for (const raw of text.split(',')) {
    const label = raw.trim().replace(/^@/, '').replace(/\s+/g, '-');
    if (label && !labels.some((l) => l.toLowerCase() === label.toLowerCase())) labels.push(label);
  }
  return labels;
}

/**
 * The order after dropping `dragged` rows onto `target` (before it, or after it when `after`). Rows keep
 * their order among themselves. Null when nothing would change place.
 */
export function dropOrder(
  ids: readonly string[],
  dragged: readonly string[],
  target: string,
  after: boolean,
): string[] | null {
  if (dragged.includes(target)) return null;
  const moving = ids.filter((id) => dragged.includes(id));
  const rest = ids.filter((id) => !dragged.includes(id));
  const at = rest.indexOf(target);
  if (at < 0 || !moving.length) return null;
  const next = [...rest.slice(0, at + (after ? 1 : 0)), ...moving, ...rest.slice(at + (after ? 1 : 0))];
  return next.every((id, i) => id === ids[i]) ? null : next;
}
