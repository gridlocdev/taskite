/** What the desktop app's preload script puts on `window.taskiteNative` (PRD §12). */
import type { NativeData, NativeMenuItem } from '@taskite/ui';

export interface TaskiteNative extends NativeData {
  readonly version: string;
  /** 'unified': the window has no title bar and the page draws the toolbar row (macOS). */
  readonly chrome: 'unified' | 'native';
  /** Replaces the menu bar. */
  setMenu(items: readonly NativeMenuItem[]): void;
  /** A menu bar item was chosen. */
  onCommand(fn: (id: string) => void): void;
  /** The window wants to close: finish saving, then call `closeReady`. */
  onCloseRequested(fn: () => void): void;
  closeReady(): void;
  /** The window entered or left full screen. */
  onFullScreen(fn: (full: boolean) => void): void;
}

export function nativeBridge(): TaskiteNative | null {
  return (globalThis as { taskiteNative?: TaskiteNative }).taskiteNative ?? null;
}
