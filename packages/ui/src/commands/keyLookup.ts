/**
 * Press a Shortcut, in the Keyboard Shortcuts window (PRD §8): the keys pressed say which command they run in the
 * task list, and run nothing.
 */
import { after } from '../schedule.ts';
import type { Command, CommandCatalog } from './command.ts';
import { formatShortcut, isMac, type Shortcut, type ShortcutEvent } from './shortcut.ts';

/** How long Press a Shortcut listens without a key before it stops on its own. */
export const LISTEN_IDLE_MS = 20_000;

/** What a key pressed while listening does. */
export type KeyLookup =
  /** A modifier on its own: wait for the rest of the chord. */
  | { readonly kind: 'wait' }
  /**
   * The keys as the app writes them (`⌘K`, or `G` then `I`), and the command they run: null for none, or
   * `'more'` for the first key of a two-key shortcut.
   */
  | { readonly kind: 'found'; readonly keys: readonly string[]; readonly command: Command | 'more' | null };

const MODIFIERS = new Set([
  'Shift',
  'Meta',
  'Control',
  'Alt',
  'AltGraph',
  'CapsLock',
  'Fn',
  'OS',
  'Hyper',
  'Super',
]);

const NAMES: Record<string, string> = {
  ' ': 'space',
  arrowup: 'up',
  arrowdown: 'down',
  arrowleft: 'left',
  arrowright: 'right',
  escape: 'esc',
};

/** The key pressed, written the way shortcuts are: `⌘K`, `⇧?`, `Ctrl+Shift+Z`. */
export function pressedLabel(e: ShortcutEvent, mac = isMac): string {
  let key: string;
  if (/^[\x21-\x7e]$/.test(e.key)) key = e.key.toLowerCase();
  else if ([...e.key].length === 1 && e.key !== ' ') {
    // A character outside ASCII (an ⌥ layer, a Cyrillic layout): the physical key, as matching reads it.
    key = /^Key[A-Z]$/.test(e.code)
      ? e.code.slice(3).toLowerCase()
      : /^Digit\d$/.test(e.code)
        ? e.code.slice(5)
        : e.key;
  } else key = NAMES[e.key.toLowerCase()] ?? e.key.toLowerCase();
  const s: Shortcut = {
    key,
    mod: mac ? e.metaKey : e.ctrlKey,
    ctrl: mac && e.ctrlKey,
    alt: e.altKey,
    shift: e.shiftKey,
  };
  return formatShortcut(s, mac);
}

/**
 * Looks one key up the way the task list would read it, sequences included: after `G`, the next key finishes
 * `G` then `I`. `previous` is the label of a first key still waiting for its second.
 */
export function lookUpKey(
  catalog: CommandCatalog,
  e: ShortcutEvent,
  previous: string | null,
  now: number = Date.now(),
  mac = isMac,
): KeyLookup {
  if (MODIFIERS.has(e.key)) return { kind: 'wait' };
  const label = pressedLabel(e, mac);
  const result = catalog.forEvent(e, 'list', now, mac);
  if (result?.kind === 'wait') return { kind: 'found', keys: [label], command: 'more' };
  const keys = previous ? [previous, label] : [label];
  return { kind: 'found', keys, command: result?.command ?? null };
}

/**
 * The window, or a stand-in in tests: anything keydown events reach before the page's own handlers (the window's
 * capture phase).
 */
export type KeyTarget = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

let listening = 0;

/** True while Press a Shortcut holds the keyboard: no command runs, from a key or from the menu bar. */
export function listeningForKeys(): boolean {
  return listening > 0;
}

/**
 * Press a Shortcut: takes every key before the page sees it and reports what it would run, running nothing.
 * Because it holds the keyboard it has ways out that don't depend on anything else working:
 *
 * - Escape is never taken: it stops listening and goes on to the page as usual (it closes the window).
 * - `idleMs` without a key stops it.
 * - An error while looking a key up stops it, so keys reach the app again.
 *
 * Each of these calls `onStop`. The returned function stops it quietly (Stop, or the window closed).
 */
export function listenForKeys(
  target: KeyTarget,
  lookUp: (e: KeyboardEvent, previous: string | null) => KeyLookup,
  onFound: (found: Extract<KeyLookup, { kind: 'found' }>) => void,
  onStop: () => void,
  idleMs = LISTEN_IDLE_MS,
): () => void {
  let done = false;
  let previous: string | null = null;
  let cancelIdle = after(idleMs, () => finish());
  const remove = () => {
    if (done) return false;
    done = true;
    listening--;
    cancelIdle();
    target.removeEventListener('keydown', onKey, { capture: true });
    return true;
  };
  const finish = () => {
    if (remove()) onStop();
  };
  function onKey(event: Event): void {
    const e = event as KeyboardEvent;
    cancelIdle();
    if (e.key === 'Escape') {
      finish();
      return;
    }
    // First, so the key goes nowhere else whatever happens next.
    e.preventDefault();
    e.stopImmediatePropagation();
    let keep = false;
    try {
      const r = lookUp(e, previous);
      if (r.kind === 'found') {
        previous = r.command === 'more' ? (r.keys[0] ?? null) : null;
        onFound(r);
      }
      keep = true;
    } catch (err) {
      console.error('Press a Shortcut: looking up a key failed', err);
    } finally {
      if (keep && !done) cancelIdle = after(idleMs, () => finish());
      else finish();
    }
  }
  listening++;
  target.addEventListener('keydown', onKey, { capture: true });
  return () => {
    remove();
  };
}
