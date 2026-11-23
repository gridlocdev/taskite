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
  /** One plain sentence: the Keyboard Shortcuts window, the command menu and docs/controls.md show it. */
  readonly description: string;
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
  /** A ticked menu item (the current theme, say). */
  readonly checked?: () => boolean;
  /** Shown in red in menus. */
  readonly danger?: boolean;
  /**
   * Its shortcut also works in a text field or with a dialog open, always or while this returns true. Only for
   * chords with ⌘/Ctrl.
   */
  readonly global?: boolean | (() => boolean);
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

/** Whether `c`'s shortcut works in a text field right now (`CommandSpec.global`). */
export function isGlobal(c: CommandSpec | undefined): boolean {
  return typeof c?.global === 'function' ? c.global() : c?.global === true;
}

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
   * (no ⌘/Ctrl) never count in a text field, where only `global` chords run; Space and Enter on a
   * button belong to the button (PRD §8).
   */
  forEvent(e: ShortcutEvent, focus: KeyFocus, now: number = Date.now(), mac = isMac): KeyResult {
    if (isComposingKey(e)) return null;
    const pending = this.#pending;
    this.#pending = null;
    // A sequence never finishes in a text field: g in the list, then i typed into search, types i.
    if (pending && focus !== 'text' && now - pending.at <= SEQUENCE_MS) {
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
        if (focus === 'text' && !only.mod && !only.ctrl) continue;
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

  /** Disabled commands let their keys through, so two commands can share a key (Delete in the Trash). */
  #allowed(c: Command, focus: KeyFocus): boolean {
    return (focus !== 'text' || isGlobal(c)) && this.isEnabled(c);
  }
}

/**
 * Command menu search (PRD §8). Spaces don't count, so "newtask" and "new task" both find New Task. Best
 * first: the title starts with the query, then contains it, then the group or keywords contain it (or
 * every typed word appears somewhere), then the title holds the query's letters in order ("nwtk").
 * Within a rank, recent entries lead and the rest keep their order. With nothing typed, recent first.
 */
export function filterEntries<T extends MenuEntry>(
  entries: readonly T[],
  query: string,
  recent: readonly string[] = [],
): T[] {
  const q = compact(query);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const recentRank = (e: T) => {
    const i = recent.indexOf(e.id);
    return i === -1 ? Infinity : i;
  };
  const score = (e: T): number => {
    if (!q) return 0;
    const title = compact(e.title);
    const rest = `${e.group} ${e.keywords ?? ''}`.toLowerCase();
    if (title.startsWith(q)) return 0;
    if (title.includes(q)) return 1;
    if (compact(rest).includes(q) || words.every((w) => `${e.title.toLowerCase()} ${rest}`.includes(w)))
      return 2;
    return inOrder(q, title) ? 3 : -1;
  };
  return entries
    .map((e) => ({ e, s: score(e) }))
    .filter(({ s }) => s >= 0)
    .sort((a, b) => a.s - b.s || recentRank(a.e) - recentRank(b.e))
    .map(({ e }) => e);
}

/** Lower-cased with every space removed: what the command menu compares. */
export function compact(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '');
}

/** True when every character of `needle` appears in `hay` in order, gaps allowed. */
export function inOrder(needle: string, hay: string): boolean {
  let at = 0;
  for (const ch of needle) {
    at = hay.indexOf(ch, at) + 1;
    if (at === 0) return false;
  }
  return true;
}

/** One item of the desktop menu bar, as the Electron main process builds it (PRD §8). */
export type NativeMenuItem =
  | { readonly type: 'separator' }
  | { readonly role: string; readonly label?: string }
  | {
      readonly label: string;
      readonly command?: string;
      readonly accelerator?: string;
      readonly enabled?: boolean;
      readonly type?: 'checkbox';
      readonly checked?: boolean;
      readonly submenu?: readonly NativeMenuItem[];
    };
