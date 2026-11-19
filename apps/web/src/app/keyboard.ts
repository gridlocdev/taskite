/**
 * The on-screen keyboard (PRD §5.5). A phone's keyboard covers the bottom of the page without resizing it, so
 * the app sizes itself to the part still showing (the visual viewport). Bottom-docked fields such as search and
 * the add-task panel then sit right above the keyboard and move up with it.
 */
import { signal, type ReadonlySignal } from '@preact/signals';

/** A viewport this much shorter than the window means the keyboard is up, not just a browser bar. */
export const KEYBOARD_MIN_PX = 100;

export interface Frame {
  /** The height of the part of the page still showing, in px. */
  readonly height: number;
  /** How far down the page that part starts, in px. */
  readonly top: number;
  /** Whether the keyboard is up. */
  readonly keyboard: boolean;
}

/** The frame the app fills, from the window's height and the visual viewport (null when there is none). */
export function frameOf(
  windowHeight: number,
  viewport: { readonly height: number; readonly pageTop: number } | null,
): Frame {
  if (!viewport) return { height: windowHeight, top: 0, keyboard: false };
  return {
    height: viewport.height,
    top: viewport.pageTop,
    keyboard: windowHeight - viewport.height >= KEYBOARD_MIN_PX,
  };
}

const up = signal(false);
/** True while the on-screen keyboard is up. */
export const keyboardUp: ReadonlySignal<boolean> = up;

/**
 * Keeps `--tk-frame-height` and `--tk-frame-top` on the root element in step with the visual viewport, for the
 * phone stylesheet. Returns a function that stops.
 */
export function followKeyboard(): () => void {
  const viewport = typeof visualViewport === 'object' ? visualViewport : null;
  if (!viewport) return () => undefined;
  const root = document.documentElement;
  const update = () => {
    const frame = frameOf(innerHeight, viewport);
    root.style.setProperty('--tk-frame-height', `${frame.height}px`);
    root.style.setProperty('--tk-frame-top', `${frame.top}px`);
    up.value = frame.keyboard;
  };
  update();
  viewport.addEventListener('resize', update);
  viewport.addEventListener('scroll', update);
  return () => {
    viewport.removeEventListener('resize', update);
    viewport.removeEventListener('scroll', update);
    root.style.removeProperty('--tk-frame-height');
    root.style.removeProperty('--tk-frame-top');
    up.value = false;
  };
}
