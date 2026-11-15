// @ts-check
/**
 * Keyboard shortcut helpers for the command list in app.js. The same list
 * feeds the keyboard, the command menu (⌘K), right-click menus, the menu bar
 * and the Keyboard Shortcuts window, so a shortcut is written down once.
 *
 * Shortcut notation: modifiers and a key joined by "+", lowercase, e.g.
 * "mod+k", "shift+arrowdown", "space", "?". "mod" is ⌘ on a Mac and Ctrl
 * elsewhere. Two keys pressed one after the other are separated by a space,
 * e.g. "g i".
 */

/**
 * @typedef {Object} Command
 * @property {string} id
 * @property {string} title
 * @property {string} group Heading in the shortcuts window and menu bar.
 * @property {string[]} [keys] Shortcuts; the first is the one shown.
 * @property {() => void} run
 * @property {() => boolean} [enabled] When it can run. Defaults to always.
 * @property {boolean} [palette] Listed in the command menu. Defaults to true.
 * @property {boolean} [context] Listed in a task's right-click menu.
 * @property {boolean} [danger] Shown in red in menus.
 * @property {boolean} [anywhere] The shortcut also works while typing or with a window open.
 */

const MODIFIERS = new Set(['mod', 'shift', 'alt', 'ctrl']);

/**
 * @typedef {{mod: boolean, shift: boolean, alt: boolean, ctrl: boolean, key: string}} Chord
 */

/**
 * @param {string} chord One step, such as "mod+shift+z".
 * @returns {Chord}
 */
export function parseChord(chord) {
  const parts = chord.toLowerCase().split('+');
  // "mod++" would mean the plus key; we have none, so the last part is the key.
  const key = parts.pop() ?? '';
  const set = new Set(parts.filter((p) => MODIFIERS.has(p)));
  return { mod: set.has('mod'), shift: set.has('shift'), alt: set.has('alt'), ctrl: set.has('ctrl'), key };
}

/**
 * @param {string} shortcut
 * @returns {string[]} Its steps: one for "mod+k", two for "g i".
 */
export function shortcutSteps(shortcut) {
  return shortcut.trim().split(/\s+/);
}

/**
 * The name used in shortcuts for a keyboard event's key.
 * @param {string} key KeyboardEvent.key
 */
export function keyName(key) {
  if (key === ' ') return 'space';
  return key.toLowerCase();
}

/** @param {string} key */
function isSymbol(key) {
  return key.length === 1 && !/[a-z0-9]/.test(key);
}

/**
 * Whether a key press matches one step of a shortcut. Shift is ignored for
 * symbols like "?", since you need Shift to type them on most keyboards.
 * @param {{key: string, metaKey: boolean, ctrlKey: boolean, shiftKey: boolean, altKey: boolean}} event
 * @param {string} chord
 * @param {boolean} isMac
 */
export function matchesChord(event, chord, isMac) {
  const c = parseChord(chord);
  if (keyName(event.key) !== c.key) return false;
  const modPressed = isMac ? event.metaKey : event.ctrlKey;
  const otherPressed = isMac ? event.ctrlKey : event.metaKey;
  if (modPressed !== c.mod) return false;
  if (otherPressed !== (isMac && c.ctrl)) return false;
  if (event.altKey !== c.alt) return false;
  if (!isSymbol(c.key) && event.shiftKey !== c.shift) return false;
  return true;
}

/** @type {Record<string, [string, string]>} Key → [Mac label, other label]. */
const KEY_LABELS = {
  arrowup: ['↑', '↑'],
  arrowdown: ['↓', '↓'],
  arrowleft: ['←', '←'],
  arrowright: ['→', '→'],
  enter: ['↵', 'Enter'],
  escape: ['Esc', 'Esc'],
  space: ['Space', 'Space'],
  backspace: ['⌫', 'Backspace'],
  delete: ['⌦', 'Delete'],
};

/**
 * Key caps for showing a shortcut, one list per step.
 * @param {string} shortcut
 * @param {boolean} isMac
 * @returns {string[][]} e.g. [["⌘", "K"]] or [["G"], ["I"]].
 */
export function formatShortcut(shortcut, isMac) {
  return shortcutSteps(shortcut).map((step) => {
    const c = parseChord(step);
    /** @type {string[]} */
    const caps = [];
    if (c.ctrl) caps.push(isMac ? '⌃' : 'Ctrl');
    if (c.alt) caps.push(isMac ? '⌥' : 'Alt');
    if (c.shift) caps.push(isMac ? '⇧' : 'Shift');
    if (c.mod) caps.push(isMac ? '⌘' : 'Ctrl');
    const label = KEY_LABELS[c.key];
    caps.push(label ? label[isMac ? 0 : 1] : c.key.toUpperCase());
    return caps;
  });
}

/** @type {Record<string, string>} Key → Electron accelerator key. */
const ACCELERATOR_KEYS = {
  arrowup: 'Up',
  arrowdown: 'Down',
  arrowleft: 'Left',
  arrowright: 'Right',
  enter: 'Return',
  escape: 'Escape',
  space: 'Space',
  backspace: 'Backspace',
  delete: 'Delete',
  '/': '/',
  '?': '?',
};

/**
 * The Electron menu accelerator for a shortcut, or null when it has none
 * (two-step shortcuts can't be shown in the menu bar).
 * @param {string} shortcut
 * @returns {string|null}
 */
export function toAccelerator(shortcut) {
  const steps = shortcutSteps(shortcut);
  if (steps.length !== 1) return null;
  const c = parseChord(steps[0]);
  const key = ACCELERATOR_KEYS[c.key] ?? (/^[a-z0-9]$/.test(c.key) ? c.key.toUpperCase() : null);
  if (!key) return null;
  return [c.mod && 'CmdOrCtrl', c.ctrl && 'Ctrl', c.alt && 'Alt', c.shift && 'Shift', key].filter(Boolean).join('+');
}

/**
 * Ranks commands for the command menu: every word typed must appear in the
 * title or group; recently used ones come first, then alphabetical.
 * @template {{title: string, group: string}} T
 * @param {T[]} commands
 * @param {string} query
 * @param {string[]} recent Titles, most recent first.
 * @returns {T[]}
 */
export function filterCommands(commands, query, recent = []) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const rank = (/** @type {T} */ c) => {
    const i = recent.indexOf(c.title);
    return i === -1 ? Infinity : i;
  };
  return commands
    .filter((c) => {
      const text = `${c.title} ${c.group}`.toLowerCase();
      return words.every((w) => text.includes(w));
    })
    .sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title));
}
