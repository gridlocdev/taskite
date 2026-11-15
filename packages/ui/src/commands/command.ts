import {
  SEQUENCE_MS,
  formatSequence,
  isComposingKey,
  isMac,
  matchRank,
  parseSequence,
  type KeySequence,
  type Shortcut,
  type ShortcutEvent,
} from './shortcut.ts';

/** Menu groups, in menu-bar order (PRD §8). */
export const COMMAND_GROUPS = ['File', 'Edit', 'Task', 'Select', 'Go', 'View', 'Help'] as const;
export type CommandGroup = (typeof COMMAND_GROUPS)[number];

export interface CommandSpec {
  readonly id: string;
  readonly title: string;
  readonly group: CommandGroup;
  /** Shortcuts; the first is the one menus show. `g i` is two keys in a row. */
  readonly shortcuts?: readonly string[];
  /** Extra words the command menu matches. */
  readonly keywords?: string;
  readonly run: () => void | Promise<void>;
  readonly enabled?: () => boolean;
  /** Left out of the command menu (the command menu itself, say). */
  readonly hidden?: boolean;
  /** In a task's right-click menu. */
  readonly context?: boolean;
  /** Shown in red in menus. */
  readonly danger?: boolean;
  /** Its shortcut also works in a text field or with a dialog open. Only for chords with ⌘/Ctrl. */
  readonly global?: boolean;
  /** Its shortcuts work from the keyboard but don't go in the menu bar (Space, Enter, letters). */
  readonly keysOnly?: boolean;
}

export interface Command extends CommandSpec {
  readonly sequences: readonly KeySequence[];
}

/** Where keyboard focus is: a text field, another control (a button, a menu), or the task list / nothing. */
export type KeyFocus = 'text' | 'control' | 'list';

export type KeyResult =
  { readonly kind: 'run'; readonly command: Command } | { readonly kind: 'wait' } | null;

/** One entry in the command menu: a command, or something made on the fly (Go to <project>). */
export interface MenuEntry {
  readonly id: string;
  readonly title: string;
  readonly group: string;
  readonly keywords?: string;
}

export const MAX_RECENT = 5;

function same(a: Shortcut, b: Shortcut): boolean {
  return a.key === b.key && a.mod === b.mod && a.shift === b.shift && a.alt === b.alt && a.ctrl === b.ctrl;
}

/**
 * The one command catalog: keyboard, command menu, right-click menu, menu bar and the Keyboard Shortcuts window
 * all read it (PRD §8). Every run goes through `run`, which checks the gate and records recents.
 */
export class CommandCatalog {
  readonly all: readonly Command[];
  readonly #byId: Map<string, Command>;
  readonly #recent: string[] = [];
  #pending: { readonly first: Shortcut; readonly at: number } | null = null;

  /** Asked before every run; returning false cancels it. */
  gate: ((c: Command) => boolean) | null = null;

  constructor(specs: readonly CommandSpec[]) {
    this.all = specs.map((s) => ({ ...s, sequences: (s.shortcuts ?? []).map(parseSequence) }));
    this.#byId = new Map(this.all.map((c) => [c.id, c]));
    if (this.#byId.size !== this.all.length) throw new Error('Duplicate command id');
  }

  get(id: string): Command | undefined {
    return this.#byId.get(id);
  }

  isEnabled(c: Command): boolean {
    return c.enabled?.() ?? true;
  }

  /** Runs `id` if it is enabled and the gate lets it. */
  run(id: string): boolean {
    const c = this.#byId.get(id);
    if (!c || !this.isEnabled(c)) return false;
    if (this.gate && !this.gate(c)) return false;
    if (!c.hidden) this.remember(id);
    void Promise.resolve(c.run()).catch((e: unknown) => console.error(`command ${id} failed`, e));
    return true;
  }

  /** Puts an id first among the recents (the command menu also records its own entries). */
  remember(id: string): void {
    const at = this.#recent.indexOf(id);
    if (at >= 0) this.#recent.splice(at, 1);
    this.#recent.unshift(id);
    this.#recent.length = Math.min(this.#recent.length, MAX_RECENT);
  }

  get recentIds(): readonly string[] {
    return this.#recent;
  }

  /** The label of a command's first shortcut, one string per key: `['⌘K']`, `['G', 'I']`, or []. */
  keys(c: Command, mac = isMac): string[] {
    const first = c.sequences[0];
    return first ? formatSequence(first, mac) : [];
  }

  /**
   * What a key press does: runs a command, waits for the second key of a sequence, or nothing. Plain keys
   * (no ⌘/Ctrl) only count in the list; in a text field only `global` commands run; Space and Enter on a
   * button belong to the button (PRD §8).
   */
  forEvent(e: ShortcutEvent, focus: KeyFocus, now: number = Date.now(), mac = isMac): KeyResult {
    if (isComposingKey(e)) return null;
    const pending = this.#pending;
    this.#pending = null;
    if (pending && now - pending.at <= SEQUENCE_MS) {
      for (const c of this.all)
        for (const seq of c.sequences) {
          const [a, b] = seq;
          if (seq.length === 2 && a && same(a, pending.first) && b && matchRank(b, e, mac) > 0)
            return { kind: 'run', command: c };
        }
    }
    let best: Command | undefined;
    let bestRank = Infinity;
    for (const c of this.all) {
      if (!this.#allowed(c, focus)) continue;
      for (const seq of c.sequences) {
        const [only] = seq;
        if (seq.length !== 1 || !only) continue;
        if (focus === 'control' && !only.mod && (only.key === 'space' || only.key === 'enter')) continue;
        const rank = matchRank(only, e, mac);
        if (rank > 0 && rank < bestRank) {
          best = c;
          bestRank = rank;
        }
      }
    }
    if (best) return { kind: 'run', command: best };
    if (focus !== 'text')
      for (const c of this.all)
        for (const seq of c.sequences) {
          const [a] = seq;
          if (seq.length === 2 && a && matchRank(a, e, mac) > 0) {
            this.#pending = { first: a, at: now };
            return { kind: 'wait' };
          }
        }
    return null;
  }

  #allowed(c: Command, focus: KeyFocus): boolean {
    return focus !== 'text' || c.global === true;
  }
}

/**
 * Command menu search (PRD §8): every typed word must appear in the title, group or keywords. With nothing
 * typed, the recent ones come first; otherwise recent ones still lead, then alphabetical.
 */
export function filterEntries<T extends MenuEntry>(
  entries: readonly T[],
  query: string,
  recent: readonly string[] = [],
): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const rank = (e: T) => {
    const i = recent.indexOf(e.id);
    return i === -1 ? Infinity : i;
  };
  return entries
    .filter((e) => {
      const text = `${e.title} ${e.group} ${e.keywords ?? ''}`.toLowerCase();
      return words.every((w) => text.includes(w));
    })
    .sort((a, b) => rank(a) - rank(b) || (words.length ? a.title.localeCompare(b.title) : 0));
}
