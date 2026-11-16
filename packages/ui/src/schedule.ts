/**
 * The page's only timers. Anything that waits goes through a named helper here, so every wait in the app can be
 * found and judged in one place. A timer is never the fix for things happening in the wrong order: change the
 * model first and let the signals redraw.
 */

/** Resolves after `ms`. */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Calls `run` once after `ms`. Returns a function that cancels it. */
export function after(ms: number, run: () => void): () => void {
  const id = setTimeout(run, ms);
  return () => clearTimeout(id);
}

/** Calls `run` every `ms` until the returned function is called. */
export function every(ms: number, run: () => void): () => void {
  const id = setInterval(run, ms);
  return () => clearInterval(id);
}

/** Calls `run` `ms` after the last `call()`; `cancel()` drops a pending call. */
export function debounce(ms: number, run: () => void): { call(): void; cancel(): void } {
  let cancel: (() => void) | undefined;
  return {
    call() {
      cancel?.();
      cancel = after(ms, run);
    },
    cancel() {
      cancel?.();
      cancel = undefined;
    },
  };
}
