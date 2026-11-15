/** What the desktop app's preload script puts on `window.taskiteNative` (PRD §12). */
import type { NativeData, NativeMenuItem } from '@taskite/ui';

export interface TaskiteNative extends NativeData {
  readonly version: string;
  /** Replaces the menu bar. */
  setMenu(items: readonly NativeMenuItem[]): void;
  /** A menu bar item was chosen. */
  onCommand(fn: (id: string) => void): void;
  /** The window wants to close: finish saving, then call `closeReady`. */
  onCloseRequested(fn: () => void): void;
  closeReady(): void;
}

export function nativeBridge(): TaskiteNative | null {
  return (globalThis as { taskiteNative?: TaskiteNative }).taskiteNative ?? null;
}
