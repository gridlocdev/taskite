// @ts-check
/**
 * Date helpers. Due dates are stored as local "YYYY-MM-DD" strings so they
 * never shift because of time zones.
 */

/** @typedef {'daily'|'weekdays'|'weekly'|'monthly'|'yearly'} Recurrence */

export const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
export const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** @type {Record<Recurrence, string>} */
export const RECURRENCE_LABELS = {
  daily: 'Every day',
  weekdays: 'Every weekday',
  weekly: 'Every week',
  monthly: 'Every month',
  yearly: 'Every year',
};

/**
 * @param {Date} date
 * @returns {string} The date as local YYYY-MM-DD.
 */
export function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * @param {string} iso YYYY-MM-DD
 * @returns {Date} Local midnight of that day.
 */
export function parseISODate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/**
 * @param {Date} [now]
 * @returns {string} Today's date as YYYY-MM-DD.
 */
export function todayISO(now = new Date()) {
  return toISODate(now);
}

/**
 * @param {string} iso
 * @param {number} days
 * @returns {string}
 */
export function addDays(iso, days) {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

/**
 * Adds months, clamping to the last day of the month (Jan 31 + 1 → Feb 28/29).
 * @param {string} iso
 * @param {number} months
 * @returns {string}
 */
export function addMonths(iso, months) {
  const d = parseISODate(iso);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return toISODate(d);
}

/**
 * @param {string} from
 * @param {string} to
 * @returns {number} Whole days from `from` to `to` (negative if `to` is earlier).
 */
export function diffDays(from, to) {
  return Math.round((parseISODate(to).getTime() - parseISODate(from).getTime()) / 86400000);
}

/**
 * @param {string} iso
 * @returns {boolean} True for Monday–Friday.
 */
export function isWeekday(iso) {
  const day = parseISODate(iso).getDay();
  return day !== 0 && day !== 6;
}

/**
 * The next date that falls on the given weekday, strictly after `fromISO`.
 * @param {number} weekday 0 = Sunday … 6 = Saturday
 * @param {string} fromISO
 * @returns {string}
 */
export function nextWeekday(weekday, fromISO) {
  const current = parseISODate(fromISO).getDay();
  const delta = ((weekday - current + 7) % 7) || 7;
  return addDays(fromISO, delta);
}

/**
 * Moves a date forward by one step of the recurrence.
 * @param {string} iso
 * @param {Recurrence} recurrence
 * @returns {string}
 */
export function stepRecurrence(iso, recurrence) {
  switch (recurrence) {
    case 'daily': return addDays(iso, 1);
    case 'weekdays': {
      let next = addDays(iso, 1);
      while (!isWeekday(next)) next = addDays(next, 1);
      return next;
    }
    case 'weekly': return addDays(iso, 7);
    case 'monthly': return addMonths(iso, 1);
    case 'yearly': return addMonths(iso, 12);
    default: throw new Error(`Unknown recurrence: ${recurrence}`);
  }
}

/**
 * The next due date for a repeating task once it's checked off: step forward
 * from its current due date until the date is after today.
 * @param {string} dueISO
 * @param {Recurrence} recurrence
 * @param {string} [today]
 * @returns {string}
 */
export function nextOccurrence(dueISO, recurrence, today = todayISO()) {
  let next = stepRecurrence(dueISO, recurrence);
  while (next <= today) next = stepRecurrence(next, recurrence);
  return next;
}

/**
 * A friendly label for a due date: "Today", "Tomorrow", "Friday", "Oct 12".
 * @param {string} iso
 * @param {string} [today]
 * @returns {string}
 */
export function formatDue(iso, today = todayISO()) {
  const diff = diffDays(today, iso);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  const date = parseISODate(iso);
  if (diff > 1 && diff < 7) return date.toLocaleDateString(undefined, { weekday: 'long' });
  const sameYear = date.getFullYear() === parseISODate(today).getFullYear();
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/**
 * A longer label for section headings: "Today · Fri Oct 9".
 * @param {string} iso
 * @param {string} [today]
 * @returns {string}
 */
export function formatDayHeading(iso, today = todayISO()) {
  const full = parseISODate(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const diff = diffDays(today, iso);
  if (diff === 0) return `Today · ${full}`;
  if (diff === 1) return `Tomorrow · ${full}`;
  return full;
}
