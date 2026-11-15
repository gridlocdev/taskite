/** The rules behind the dialogs' fields, kept out of the components so they can be tested. */
import { formatDue, parseDueText, type TaskPatch } from '@taskite/core';

export { parseDueText };

/** The line under the due date field. */
export function duePreview(text: string, today: string): string {
  const { due, ok } = parseDueText(text, today);
  if (!ok) return 'Not a date I understand yet.';
  return due ? `Due ${formatDue(due, today).toLowerCase()} (${due})` : 'No due date';
}

/** The labels field: comma-separated, "@" dropped, spaces become "-", no repeats ignoring case. */
/** The task editor's text fields, as typed (PRD §9.1). */
export interface EditorFields {
  readonly title: string;
  readonly description: string;
  readonly due: string;
  readonly labels: string;
}

/**
 * What the editor saves: only the fields typed since `start` (the values when it opened, or when it last
 * saved). A field left alone is never sent, so it can't write an old copy over a change made elsewhere
 * while the editor was open. An empty name isn't saved.
 */
export function editorPatch(start: EditorFields, now: EditorFields): TaskPatch {
  const patch: TaskPatch = {};
  const title = now.title.trim();
  if (title && title !== start.title.trim()) patch.title = title;
  if (now.description.trim() !== start.description.trim()) patch.description = now.description.trim();
  if (now.due !== start.due) patch.due = now.due || null;
  if (JSON.stringify(parseLabels(now.labels)) !== JSON.stringify(parseLabels(start.labels)))
    patch.labels = parseLabels(now.labels);
  return patch;
}

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

/**
 * The order after moving the chosen rows one place up (-1) or down (1) (PRD §4.5). Top-level tasks pass
 * their neighbours with their subtasks along; a subtask chosen with no top-level task moves its parent.
 * When every chosen row is a subtask of one parent, they move among their siblings instead. Rows already
 * at the edge stay, and so do chosen rows packed against them. Null when nothing would move.
 */
export function stepOrder(
  ids: readonly string[],
  parentOf: (id: string) => string | null,
  chosen: readonly string[],
  delta: 1 | -1,
): string[] | null {
  if (!chosen.length) return null;
  const parents = new Set(chosen.map(parentOf));
  const [onlyParent] = parents;
  if (parents.size === 1 && onlyParent) {
    // Subtasks of one parent: reorder the siblings, and put them back in the siblings' places.
    const siblings = ids.filter((id) => parentOf(id) === onlyParent);
    const moved = stepUnits(
      siblings.map((id) => [id]),
      (unit) => chosen.includes(unit[0]!),
      delta,
    );
    if (!moved) return null;
    const next = moved.flat();
    let i = 0;
    return ids.map((id) => (parentOf(id) === onlyParent ? next[i++]! : id));
  }
  // Top-level tasks, each with its subtasks.
  const groups: string[][] = [];
  const groupOf = new Map<string, string[]>();
  for (const id of ids) {
    const parent = parentOf(id);
    const home = parent ? groupOf.get(parent) : undefined;
    if (home) home.push(id);
    else {
      const group = [id];
      groups.push(group);
      groupOf.set(id, group);
    }
  }
  const moving = new Set(chosen.map((id) => (groupOf.has(id) ? id : (parentOf(id) ?? id))));
  const moved = stepUnits(groups, (group) => moving.has(group[0]!), delta);
  return moved ? moved.flat() : null;
}

/** Each chosen unit swaps with the unchosen neighbour on its `delta` side. Null when nothing moves. */
function stepUnits<T>(units: readonly T[], chosen: (unit: T) => boolean, delta: 1 | -1): T[] | null {
  const next = [...units];
  let changed = false;
  const order = delta < 0 ? next.keys() : [...next.keys()].reverse();
  for (const i of order) {
    const j = i + delta;
    if (j < 0 || j >= next.length) continue;
    if (chosen(next[i]!) && !chosen(next[j]!)) {
      [next[i], next[j]] = [next[j]!, next[i]!];
      changed = true;
    }
  }
  return changed ? next : null;
}
