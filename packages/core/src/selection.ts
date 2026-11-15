/**
 * Pure helpers for choosing tasks with the keyboard and mouse (PRD §7). `ids` is always the visible
 * tasks in on-screen order.
 */

/** The task `delta` rows from `currentId`, clamped. With none, down picks the first and up the last. */
export function stepId(ids: readonly string[], currentId: string | null, delta: number): string | null {
  if (!ids.length) return null;
  const index = currentId ? ids.indexOf(currentId) : -1;
  if (index === -1) return (delta >= 0 ? ids[0] : ids[ids.length - 1]) ?? null;
  return ids[Math.min(ids.length - 1, Math.max(0, index + delta))] ?? null;
}

/** Every task from the anchor to the target, inclusive, in list order. */
export function rangeIds(ids: readonly string[], anchorId: string | null, targetId: string): string[] {
  const to = ids.indexOf(targetId);
  if (to === -1) return [];
  const from = anchorId ? ids.indexOf(anchorId) : -1;
  if (from === -1) return [targetId];
  return ids.slice(Math.min(from, to), Math.max(from, to) + 1);
}

/** After `gone` leave the list, the task to choose next: the next one below, else above (PRD §7). */
export function fallbackAfter(ids: readonly string[], gone: ReadonlySet<string>): string | null {
  const last = Math.max(-1, ...ids.map((id, i) => (gone.has(id) ? i : -1)));
  if (last === -1) return null;
  for (let i = last + 1; i < ids.length; i++) if (!gone.has(ids[i] ?? '')) return ids[i] ?? null;
  for (let i = last - 1; i >= 0; i--) if (!gone.has(ids[i] ?? '')) return ids[i] ?? null;
  return null;
}
