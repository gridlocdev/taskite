// @ts-check
/**
 * Quick Add parser. Turns text like
 *   "Pay rent tomorrow p1 #Home @bills"
 * into a title plus due date, priority, project and labels.
 */
import { WEEKDAYS, MONTHS, todayISO, addDays, addMonths, nextWeekday, isWeekday, parseISODate, toISODate } from './dates.js';

/** @typedef {import('./dates.js').Recurrence} Recurrence */

/**
 * @typedef {Object} ParsedTask
 * @property {string} title Text left over after removing the shortcuts.
 * @property {string|null} due YYYY-MM-DD or null.
 * @property {Recurrence|null} recurrence
 * @property {1|2|3|4|null} priority 1 = most urgent.
 * @property {string|null} projectName Name after "#", without the "#".
 * @property {string[]} labels Names after "@", without the "@".
 */

const WEEKDAY_RE = '(sunday|monday|tuesday|wednesday|thursday|friday|saturday)';
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

/**
 * Builds a date for a month/day, choosing next year if it has already passed.
 * @param {string} monthName
 * @param {number} day
 * @param {string} today
 * @returns {string|null}
 */
function monthDay(monthName, day, today) {
  const month = MONTHS.indexOf(monthName.slice(0, 3).toLowerCase());
  const year = parseISODate(today).getFullYear();
  for (const y of [year, year + 1]) {
    const date = new Date(y, month, day);
    if (date.getMonth() !== month) return null; // e.g. "feb 31"
    const iso = toISODate(date);
    if (iso >= today) return iso;
  }
  return null;
}

/**
 * Date phrases, tried in order. Each returns a date or null to skip.
 * @type {Array<{re: RegExp, toDate: (m: RegExpExecArray, today: string) => string|null}>}
 */
const DATE_RULES = [
  {
    re: /\b(\d{4})-(\d{2})-(\d{2})\b/,
    toDate: (m) => {
      const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      const iso = toISODate(date);
      return iso === m[0] ? iso : null;
    },
  },
  { re: /\btoday\b/i, toDate: (_m, today) => today },
  { re: /\btomorrow\b/i, toDate: (_m, today) => addDays(today, 1) },
  { re: /\bnext week\b/i, toDate: (_m, today) => nextWeekday(1, today) },
  {
    re: /\bin (\d{1,3}) (days?|weeks?|months?)\b/i,
    toDate: (m, today) => {
      const n = Number(m[1]);
      const unit = m[2].toLowerCase();
      if (unit.startsWith('day')) return addDays(today, n);
      if (unit.startsWith('week')) return addDays(today, n * 7);
      return addMonths(today, n);
    },
  },
  {
    re: new RegExp(`\\b(?:on |next )?${WEEKDAY_RE}\\b`, 'i'),
    toDate: (m, today) => nextWeekday(WEEKDAYS.indexOf(m[1].toLowerCase()), today),
  },
  {
    re: new RegExp(`\\b${MONTH_RE}\\.? (\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i'),
    toDate: (m, today) => monthDay(m[1], Number(m[2]), today),
  },
  {
    re: new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)? ${MONTH_RE}\\b`, 'i'),
    toDate: (m, today) => monthDay(m[2], Number(m[1]), today),
  },
];

/**
 * Parses Quick Add text.
 * @param {string} input
 * @param {string} [today] YYYY-MM-DD, defaults to the real today (handy for tests).
 * @returns {ParsedTask}
 */
export function parseQuickAdd(input, today = todayISO()) {
  let text = ` ${input} `;

  /**
   * Finds the first match of `re`, removes it from the text and returns it.
   * @param {RegExp} re
   * @returns {RegExpExecArray|null}
   */
  const take = (re) => {
    const m = re.exec(text);
    if (m) text = text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length);
    return m;
  };

  /** @type {ParsedTask} */
  const result = { title: '', due: null, recurrence: null, priority: null, projectName: null, labels: [] };

  // Repeating: "every day", "every weekday", "every week", "every monday", ...
  const every = take(new RegExp(`\\bevery (day|weekday|week|month|year|${WEEKDAY_RE.slice(1, -1)})\\b`, 'i'));
  if (every) {
    const word = every[1].toLowerCase();
    const weekdayIndex = WEEKDAYS.indexOf(word);
    if (weekdayIndex >= 0) {
      result.recurrence = 'weekly';
      result.due = parseISODate(today).getDay() === weekdayIndex ? today : nextWeekday(weekdayIndex, today);
    } else {
      result.recurrence = /** @type {Recurrence} */ ({ day: 'daily', weekday: 'weekdays', week: 'weekly', month: 'monthly', year: 'yearly' })[word];
      result.due = result.recurrence === 'weekdays' && !isWeekday(today) ? nextWeekday(1, today) : today;
    }
  }

  // A specific date wins over the default date a repeat would give.
  for (const rule of DATE_RULES) {
    const m = rule.re.exec(text);
    if (!m) continue;
    const date = rule.toDate(m, today);
    if (!date) continue;
    take(rule.re);
    result.due = date;
    break;
  }

  const priority = take(/(?:^|\s)p([1-4])(?=\s)/i);
  if (priority) result.priority = /** @type {1|2|3|4} */ (Number(priority[1]));

  const project = take(/(?:^|\s)#([^\s#@]+)(?=\s)/);
  if (project) result.projectName = project[1];

  let label;
  while ((label = take(/(?:^|\s)@([^\s#@]+)(?=\s)/))) {
    if (!result.labels.some((l) => l.toLowerCase() === label[1].toLowerCase())) result.labels.push(label[1]);
  }

  result.title = text.replace(/\s+/g, ' ').trim();
  return result;
}
