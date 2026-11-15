/**
 * Quick Add (PRD §4.2): turns "Pay rent tomorrow p1 #Home @bills" into a title plus due date, priority,
 * project and labels.
 */
import {
  MONTHS,
  WEEKDAYS,
  addDays,
  addMonths,
  isWeekday,
  nextWeekday,
  parseISODate,
  toISODate,
  todayISO,
  type Recurrence,
} from './dates.ts';

export type Priority = 1 | 2 | 3 | 4;

export interface ParsedTask {
  /** Text left after removing the shortcuts. */
  title: string;
  /** YYYY-MM-DD or null. */
  due: string | null;
  recurrence: Recurrence | null;
  /** 1 = most urgent. */
  priority: Priority | null;
  /** The name after "#", without it. */
  projectName: string | null;
  /** Names after "@", without it. */
  labels: string[];
}

const WEEKDAY_WORDS = 'sunday|monday|tuesday|wednesday|thursday|friday|saturday';
const MONTH_RE =
  '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

const EVERY_WORDS: Record<string, Recurrence> = {
  day: 'daily',
  weekday: 'weekdays',
  week: 'weekly',
  month: 'monthly',
  year: 'yearly',
};

function weekdayIndex(word: string): number {
  return (WEEKDAYS as readonly string[]).indexOf(word.toLowerCase());
}

/** A date for a month and day: this year, or next year if already past. Null for "feb 31". */
function monthDay(monthName: string, day: number, today: string): string | null {
  const month = (MONTHS as readonly string[]).indexOf(monthName.slice(0, 3).toLowerCase());
  const year = parseISODate(today).getFullYear();
  for (const y of [year, year + 1]) {
    const date = new Date(y, month, day);
    if (date.getMonth() !== month) return null;
    const iso = toISODate(date);
    if (iso >= today) return iso;
  }
  return null;
}

interface DateRule {
  re: RegExp;
  toDate: (m: RegExpExecArray, today: string) => string | null;
}

/** Date phrases, tried in order. Each gives a date, or null to skip. */
const DATE_RULES: DateRule[] = [
  {
    re: /\b(\d{4})-(\d{2})-(\d{2})\b/,
    toDate: (m) => {
      const iso = toISODate(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
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
      const unit = (m[2] ?? '').toLowerCase();
      if (unit.startsWith('day')) return addDays(today, n);
      if (unit.startsWith('week')) return addDays(today, n * 7);
      return addMonths(today, n);
    },
  },
  {
    re: new RegExp(`\\b(?:on |next )?(${WEEKDAY_WORDS})\\b`, 'i'),
    toDate: (m, today) => nextWeekday(weekdayIndex(m[1] ?? ''), today),
  },
  {
    re: new RegExp(`\\b${MONTH_RE}\\.? (\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i'),
    toDate: (m, today) => monthDay(m[1] ?? '', Number(m[2]), today),
  },
  {
    re: new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)? ${MONTH_RE}\\b`, 'i'),
    toDate: (m, today) => monthDay(m[2] ?? '', Number(m[1]), today),
  },
];

/** Parses Quick Add text. `today` defaults to the real today. */
export function parseQuickAdd(input: string, today: string = todayISO()): ParsedTask {
  let text = ` ${input} `;

  /** Finds the first match of `re`, removes it from the text and returns it. */
  const take = (re: RegExp): RegExpExecArray | null => {
    const m = re.exec(text);
    if (m) text = text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length);
    return m;
  };

  const result: ParsedTask = {
    title: '',
    due: null,
    recurrence: null,
    priority: null,
    projectName: null,
    labels: [],
  };

  const every = take(new RegExp(`\\bevery (day|weekday|week|month|year|${WEEKDAY_WORDS})\\b`, 'i'));
  if (every) {
    const word = (every[1] ?? '').toLowerCase();
    const weekday = weekdayIndex(word);
    if (weekday >= 0) {
      result.recurrence = 'weekly';
      result.due = parseISODate(today).getDay() === weekday ? today : nextWeekday(weekday, today);
    } else {
      const recurrence = EVERY_WORDS[word] ?? 'daily';
      result.recurrence = recurrence;
      result.due = recurrence === 'weekdays' && !isWeekday(today) ? nextWeekday(1, today) : today;
    }
  }

  // A specific date wins over the default date a repeat gives.
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
  if (priority) result.priority = Number(priority[1]) as Priority;

  const project = take(/(?:^|\s)#([^\s#@]+)(?=\s)/);
  if (project) result.projectName = project[1] ?? null;

  for (let label = take(/(?:^|\s)@([^\s#@]+)(?=\s)/); label; label = take(/(?:^|\s)@([^\s#@]+)(?=\s)/)) {
    const name = label[1] ?? '';
    if (!result.labels.some((l) => l.toLowerCase() === name.toLowerCase())) result.labels.push(name);
  }

  result.title = text.replace(/\s+/g, ' ').trim();
  return result;
}

export interface DueText {
  readonly due: string | null;
  /** False when the text isn't a date the parser knows. */
  readonly ok: boolean;
}

const SHORT_DAYS: Readonly<Record<string, string>> = {
  sun: 'sunday',
  mon: 'monday',
  tue: 'tuesday',
  tues: 'tuesday',
  wed: 'wednesday',
  thu: 'thursday',
  thur: 'thursday',
  thurs: 'thursday',
  fri: 'friday',
  sat: 'saturday',
};

/** A due date typed on its own: "tomorrow", "fri", "jan 5", "2026-12-01", or nothing / "none" for no date. */
export function parseDueText(text: string, today: string = todayISO()): DueText {
  const trimmed = text.trim().toLowerCase();
  if (!trimmed || trimmed === 'no date' || trimmed === 'none') return { due: null, ok: true };
  // Short weekday names only here, where the text is a date: in Quick Add "sun" or "sat" may be words.
  const full = trimmed.replace(/\b(sun|mon|tues?|wed|thu(?:rs?)?|fri|sat)\b/g, (w) => SHORT_DAYS[w] ?? w);
  const parsed = parseQuickAdd(full, today);
  return parsed.due && !parsed.title ? { due: parsed.due, ok: true } : { due: null, ok: false };
}
