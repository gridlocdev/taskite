/**
 * Touch screens (PRD §5.5): the phone layout and coarse-pointer signals, and the tap, long-press and swipe
 * gestures on rows and Browse items. A mouse or pen never starts a gesture here; it keeps the desktop's
 * clicks, drags and right-click menus.
 */
import { signal, type ReadonlySignal } from '@preact/signals';
import { useRef, useState } from 'preact/hooks';
import { after } from '@taskite/ui';

/** Narrower than this is a phone: the tab bar replaces the sidebar. Matches the stylesheet. */
export const PHONE_QUERY = '(max-width: 600px)';
/** How long a finger rests on a row before its menu opens. */
export const LONG_PRESS_MS = 500;
/** How far a finger moves before it is a swipe or a scroll rather than a tap or a long press. */
export const SLOP_PX = 8;
/** How far a swipe goes before letting go runs its action: this, or a third of the row when that is less. */
export const SWIPE_COMMIT_PX = 120;

function watch(query: string): ReadonlySignal<boolean> {
  const matches = signal(false);
  if (typeof matchMedia !== 'function') return matches;
  const media = matchMedia(query);
  matches.value = media.matches;
  media.addEventListener('change', (e) => (matches.value = e.matches));
  return matches;
}

/** True while the window is phone width. */
export const phone = watch(PHONE_QUERY);
/** True when the main pointer is a finger, as on a phone or tablet. */
export const touchScreen = watch('(pointer: coarse)');

/** What a finger that has moved by (dx, dy) is doing: nothing yet, swiping sideways or scrolling. */
export function gestureOf(dx: number, dy: number): 'none' | 'swipe' | 'scroll' {
  if (Math.hypot(dx, dy) < SLOP_PX) return 'none';
  return Math.abs(dx) > Math.abs(dy) ? 'swipe' : 'scroll';
}

/** The side a swipe of `dx` across a row `width` wide commits to on release, or null to spring back. */
export function swipeSide(dx: number, width: number): 'right' | 'left' | null {
  const needed = Math.min(SWIPE_COMMIT_PX, width / 3);
  if (dx >= needed) return 'right';
  if (dx <= -needed) return 'left';
  return null;
}

export interface TouchOptions {
  /** A finger held still: open the item's menu at that point. */
  readonly onLongPress?: (at: { readonly x: number; readonly y: number }) => void;
  /** A swipe released past the line. Leave a side out and the row doesn't slide that way. */
  readonly onSwipe?: { readonly right?: () => void; readonly left?: () => void };
}

export interface Touch {
  /** Pointer handlers to spread on the element. */
  readonly handlers: {
    onPointerDown(e: PointerEvent): void;
    onPointerMove(e: PointerEvent): void;
    onPointerUp(e: PointerEvent): void;
    onPointerCancel(e: PointerEvent): void;
  };
  /** How far the row is slid now, in px (0 when not swiping). */
  readonly dx: number;
  /** Whether letting go now runs the swipe's action. */
  readonly armed: boolean;
  /** Whether the press that led to this click was a finger. */
  wasTouch(): boolean;
  /** True once after a swipe or long press, so the click that follows it does nothing. */
  swallowClick(): boolean;
}

/** Tap, long-press and swipe tracking for one element. */
export function useTouch(options: TouchOptions): Touch {
  const [dx, setDx] = useState(0);
  const [width, setWidth] = useState(0);
  const state = useRef({
    id: -1,
    x: 0,
    y: 0,
    width: 0,
    gesture: 'none' as 'none' | 'swipe' | 'scroll',
    touch: false,
    swallow: false,
    stopTimer: null as (() => void) | null,
  });
  const opts = useRef(options);
  opts.current = options;

  const stopTimer = () => {
    state.current.stopTimer?.();
    state.current.stopTimer = null;
  };
  const end = () => {
    stopTimer();
    state.current.id = -1;
    setDx(0);
  };
  const allowed = (d: number) => (d > 0 ? !!opts.current.onSwipe?.right : !!opts.current.onSwipe?.left);

  return {
    dx,
    armed: swipeSide(dx, width) !== null,
    wasTouch: () => state.current.touch,
    swallowClick: () => {
      const swallow = state.current.swallow;
      state.current.swallow = false;
      return swallow;
    },
    handlers: {
      onPointerDown(e) {
        const s = state.current;
        s.touch = e.pointerType === 'touch';
        s.swallow = false;
        if (!s.touch || !e.isPrimary) return;
        stopTimer();
        s.id = e.pointerId;
        s.x = e.clientX;
        s.y = e.clientY;
        s.width = (e.currentTarget as HTMLElement).offsetWidth;
        s.gesture = 'none';
        const press = opts.current.onLongPress;
        if (press) {
          const at = { x: e.clientX, y: e.clientY };
          s.stopTimer = after(LONG_PRESS_MS, () => {
            s.stopTimer = null;
            s.id = -1;
            s.swallow = true;
            press(at);
          });
        }
      },
      onPointerMove(e) {
        const s = state.current;
        if (e.pointerId !== s.id) return;
        const moved = e.clientX - s.x;
        if (s.gesture === 'none') {
          s.gesture = gestureOf(moved, e.clientY - s.y);
          if (s.gesture === 'none') return;
          stopTimer();
          if (s.gesture === 'swipe') {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            setWidth(s.width);
          }
        }
        if (s.gesture !== 'swipe') return;
        setDx(allowed(moved) ? moved : 0);
      },
      onPointerUp(e) {
        const s = state.current;
        if (e.pointerId !== s.id) return;
        if (s.gesture === 'swipe') {
          s.swallow = true;
          const moved = e.clientX - s.x;
          const side = allowed(moved) ? swipeSide(moved, s.width) : null;
          if (side) opts.current.onSwipe?.[side]?.();
        }
        end();
      },
      onPointerCancel(e) {
        if (e.pointerId === state.current.id) end();
      },
    },
  };
}
