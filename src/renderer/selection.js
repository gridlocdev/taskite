// @ts-check
/**
 * Pure helpers for choosing tasks in a list with the keyboard and mouse.
 * `ids` is always the visible tasks in on-screen order.
 */

/**
 * The task `delta` rows away from `currentId`, clamped to the list. With no
 * current task, moving down picks the first and moving up the last.
 * @param {string[]} ids
 * @param {string|null} currentId
 * @param {number} delta
 * @returns {string|null}
 */
export function stepId(ids, currentId, delta) {
  if (!ids.length) return null;
  const index = currentId ? ids.indexOf(currentId) : -1;
  if (index === -1) return delta >= 0 ? ids[0] : ids[ids.length - 1];
  return ids[Math.min(ids.length - 1, Math.max(0, index + delta))];
}

/**
 * Every task from the anchor to the target, inclusive, in list order.
 * @param {string[]} ids
 * @param {string|null} anchorId
 * @param {string} targetId
 * @returns {string[]}
 */
export function rangeIds(ids, anchorId, targetId) {
  const to = ids.indexOf(targetId);
  if (to === -1) return [];
  const from = anchorId ? ids.indexOf(anchorId) : -1;
  if (from === -1) return [targetId];
  return ids.slice(Math.min(from, to), Math.max(from, to) + 1);
}
