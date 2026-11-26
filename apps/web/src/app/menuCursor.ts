/**
 * A menu's active item (PRD §9): state first. ↑ ↓ Home End and the pointer change it, the menu draws it
 * (`.tk-active`), and the keyboard follows it (the active item is the menu's one Tab stop).
 */

const ITEMS = '[role^=menuitem]:not([disabled])';

/** The key of the item ↑ ↓ Home End move to from `active`, or null for a key menus don't use. Wraps around. */
export function nextMenuKey(keys: readonly string[], active: string | null, key: string): string | null {
  if (keys.length === 0) return null;
  const at = active === null ? -1 : keys.indexOf(active);
  let next: number;
  if (key === 'ArrowDown') next = (at + 1) % keys.length;
  else if (key === 'ArrowUp') next = at < 0 ? keys.length - 1 : (at - 1 + keys.length) % keys.length;
  else if (key === 'Home') next = 0;
  else if (key === 'End') next = keys.length - 1;
  else return null;
  return keys[next] ?? null;
}

/** The keys of a menu's items that can be chosen, in order (each item carries `data-key`). */
export function menuKeys(menu: HTMLElement | null): string[] {
  if (!menu) return [];
  return [...menu.querySelectorAll<HTMLElement>(ITEMS)].map((el) => el.dataset.key ?? '');
}

/** Puts the keyboard on the item with `key`: called right after the state moved there. */
export function focusMenuItem(menu: HTMLElement | null, key: string | null): void {
  if (!menu || key === null) return;
  menu.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.focus();
}

/**
 * Handles ↑ ↓ Home End on a menu: works out the next key and hands it to `move`, which sets the state and then
 * the keyboard. Returns false for other keys.
 */
export function menuArrows(e: KeyboardEvent, active: string | null, move: (key: string) => void): boolean {
  const next = nextMenuKey(menuKeys(e.currentTarget as HTMLElement), active, e.key);
  if (next === null) return false;
  e.preventDefault();
  e.stopPropagation();
  move(next);
  return true;
}
