/**
 * Date helpers. Due dates are stored as local "YYYY-MM-DD" strings so they never shift with time zones.
 */

export type Recurrence = 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly';

export const RECURRENCES: readonly Recurrence[] = ['daily', 'weekdays', 'weekly', 'monthly', 'yearly'];

export const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;
export const MONTHS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
] as const;

export const RECURRENCE_LABELS: Record<Recurrence, string> = {
  daily: 'Every day',
  weekdays: 'Every weekday',
  weekly: 'Every week',
  monthly: 'Every month',
  yearly: 'Every year',
};

const DAY_MS = 86_400_000;

/** The date as local YYYY-MM-DD. */
export function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Local midnight of a YYYY-MM-DD day. */
export function parseISODate(iso: string): Date {
  const [y = 0, m = 1, d = 1] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Whether `text` is a real YYYY-MM-DD date. */
export function isISODate(text: unknown): text is string {
  return (
    typeof text === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(text) && toISODate(parseISODate(text)) === text
  );
}

export function todayISO(now: Date = new Date()): string {
  return toISODate(now);
}

export function addDays(iso: string, days: number): string {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

/** Adds months, clamping to the last day of the month (Jan 31 + 1 → Feb 28/29). */
export function addMonths(iso: string, months: number): string {
  const d = parseISODate(iso);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return toISODate(d);
}

/** Whole days from `from` to `to` (negative if `to` is earlier). */
export function diffDays(from: string, to: string): number {
  return Math.round((parseISODate(to).getTime() - parseISODate(from).getTime()) / DAY_MS);
}

/** True for Monday to Friday. */
export function isWeekday(iso: string): boolean {
  const day = parseISODate(iso).getDay();
  return day !== 0 && day !== 6;
}

/** The next date on `weekday` (0 = Sunday), strictly after `fromISO`. */
export function nextWeekday(weekday: number, fromISO: string): string {
  const current = parseISODate(fromISO).getDay();
  const delta = (weekday - current + 7) % 7 || 7;
  return addDays(fromISO, delta);
}

/** Moves a date forward by one step of the recurrence. */
export function stepRecurrence(iso: string, recurrence: Recurrence): string {
  switch (recurrence) {
    case 'daily':
      return addDays(iso, 1);
    case 'weekdays': {
      let next = addDays(iso, 1);
      while (!isWeekday(next)) next = addDays(next, 1);
      return next;
    }
    case 'weekly':
      return addDays(iso, 7);
    case 'monthly':
      return addMonths(iso, 1);
    case 'yearly':
      return addMonths(iso, 12);
  }
}

/** The next due date of a repeating task once it's checked off: step from its due date until after today (PRD §4.3). */
export function nextOccurrence(dueISO: string, recurrence: Recurrence, today: string = todayISO()): string {
  // Months count from the due date itself, so catching up over February doesn't move the 31st to the 28th.
  if (recurrence === 'monthly' || recurrence === 'yearly') {
    const step = recurrence === 'monthly' ? 1 : 12;
    let k = 1;
    while (addMonths(dueISO, k * step) <= today) k++;
    return addMonths(dueISO, k * step);
  }
  let next = stepRecurrence(dueISO, recurrence);
  while (next <= today) next = stepRecurrence(next, recurrence);
  return next;
}

/** A friendly label for a due date: "Today", "Tomorrow", "Friday", "Oct 12" (PRD §5.2). */
export function formatDue(iso: string, today: string = todayISO()): string {
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

/** A longer label for section headings: "Today · Fri Oct 9". */
export function formatDayHeading(iso: string, today: string = todayISO()): string {
  const full = parseISODate(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  const diff = diffDays(today, iso);
  if (diff === 0) return `Today · ${full}`;
  if (diff === 1) return `Tomorrow · ${full}`;
  return full;
}

/** Regions whose weeks start on Sunday, for runtimes without `Intl.Locale` week info. */
const SUNDAY_REGIONS = new Set([
  'US',
  'CA',
  'MX',
  'BR',
  'JP',
  'KR',
  'TW',
  'HK',
  'IL',
  'PH',
  'IN',
  'ZA',
  'AU',
]);

/** The first day of the week for a locale (0 = Sunday, 1 = Monday, 6 = Saturday). */
export function firstDayOfWeek(locale?: string): number {
  try {
    const loc = new Intl.Locale(locale ?? new Intl.DateTimeFormat().resolvedOptions().locale);
    // `getWeekInfo()` in newer engines, the `weekInfo` getter in older ones; firstDay is 1..7, 7 = Sunday.
    const withInfo = loc as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const info = withInfo.getWeekInfo?.() ?? withInfo.weekInfo;
    if (info) return info.firstDay % 7;
    return SUNDAY_REGIONS.has(loc.maximize().region ?? '') ? 0 : 1;
  } catch {
    return 1;
  }
}

/** The first day of the week holding `iso`, for weeks starting on `weekStart` (0 = Sunday). */
export function startOfWeek(iso: string, weekStart: number): string {
  const day = parseISODate(iso).getDay();
  return addDays(iso, -((day - weekStart + 7) % 7));
}

/** The 42 days (6 weeks) a month calendar shows for the month holding `iso`. */
export function monthGrid(iso: string, weekStart: number): string[] {
  const first = `${iso.slice(0, 8)}01`;
  const start = startOfWeek(first, weekStart);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}
