// Where the window opens (PRD §12): the size and place it had when it last closed, kept on a screen that is
// still there. No Electron imports, so the tests can run it in Node.
import { readFile } from 'node:fs/promises';
import { writeAtomic } from '@taskite/node-files';

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface SavedWindow extends Rect {
  readonly maximized: boolean;
}

/** The saved window, or null when the file is missing or doesn't hold one. */
export function parseSavedWindow(raw: unknown): SavedWindow | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);
  const x = n(r.x);
  const y = n(r.y);
  const width = n(r.width);
  const height = n(r.height);
  if (x === null || y === null || width === null || height === null || width <= 0 || height <= 0) return null;
  return { x, y, width, height, maximized: r.maximized === true };
}

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Where to open the window. The saved bounds go on the screen they overlap most, shrunk to fit its usable area
 * and moved fully onto it; bounds on no screen any more (a display unplugged) open centred on `fallback`'s
 * screen at the saved size, as far as it fits. Nothing saved: `fallback`.
 */
export function placeWindow(
  saved: SavedWindow | null,
  workAreas: readonly Rect[],
  fallback: Rect,
  min: { readonly width: number; readonly height: number },
): SavedWindow {
  if (!saved) return { ...fallback, maximized: false };
  let area: Rect | null = null;
  let best = 0;
  for (const a of workAreas) {
    const o = overlap(saved, a);
    if (o > best) {
      best = o;
      area = a;
    }
  }
  const onScreen = area !== null;
  const target = area ?? fallback;
  const width = Math.max(Math.min(saved.width, target.width), Math.min(min.width, target.width));
  const height = Math.max(Math.min(saved.height, target.height), Math.min(min.height, target.height));
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
  const x = onScreen
    ? clamp(saved.x, target.x, target.x + target.width - width)
    : target.x + Math.round((target.width - width) / 2);
  const y = onScreen
    ? clamp(saved.y, target.y, target.y + target.height - height)
    : target.y + Math.round((target.height - height) / 2);
  return { x, y, width, height, maximized: saved.maximized };
}

export async function loadSavedWindow(file: string): Promise<SavedWindow | null> {
  try {
    return parseSavedWindow(JSON.parse(await readFile(file, 'utf8')));
  } catch {
    return null;
  }
}

export async function saveWindow(file: string, w: SavedWindow): Promise<void> {
  await writeAtomic(file, JSON.stringify(w) + '\n');
}
