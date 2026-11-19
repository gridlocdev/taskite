/** The bridge the desktop app's preload script, or the iOS app, puts on `window.taskiteNative` (PRD §12, §13). */
import type { TaskiteNative } from '@taskite/ui';

export function nativeBridge(): TaskiteNative | null {
  return (globalThis as { taskiteNative?: TaskiteNative }).taskiteNative ?? null;
}
