/** What Tab can land on inside a dialog. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Where Tab (or Shift+Tab, `backwards`) moves focus among `count` stops when it is on stop
 * `current` (-1 when focus is on none of them), wrapping at both ends. Null when there are none.
 */
export function trapIndex(count: number, current: number, backwards: boolean): number | null {
  if (count <= 0) return null;
  if (current < 0) return backwards ? count - 1 : 0;
  return (current + (backwards ? count - 1 : 1)) % count;
}

/** The elements inside `root` that Tab stops on, in document order, skipping hidden ones. */
export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.closest('[hidden], [inert]') && el.getClientRects().length > 0,
  );
}

/**
 * Keeps Tab inside `root`: call from its keydown handler. Moves focus to the next (or previous)
 * stop and wraps from the last to the first, so focus never leaves a modal dialog.
 */
export function trapTab(root: HTMLElement, e: KeyboardEvent): void {
  if (e.key !== 'Tab' || e.ctrlKey || e.metaKey || e.altKey) return;
  const stops = focusables(root);
  const next = trapIndex(stops.length, stops.indexOf(document.activeElement as HTMLElement), e.shiftKey);
  e.preventDefault();
  if (next !== null) stops[next]?.focus();
}
