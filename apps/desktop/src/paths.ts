/** Where the desktop app keeps its files (PRD §12). No Electron imports, so the tests run it in Node. */
import path from 'node:path';

export interface DataPaths {
  /** Overrides Electron's user-data folder, or null for the default. */
  readonly userData: string | null;
  /** The old "Tasks" app's file, read once when Taskite has none of its own; null to skip it. */
  readonly legacyFile: string | null;
}

/**
 * TASKITE_USER_DATA moves everything (tasks, window place) to another folder, for checks against
 * throwaway data. The old app's file is only looked for in the real user-data setup, or where
 * TASKITE_LEGACY_FILE points, so a check never reads someone's real tasks.
 */
export function dataPaths(env: NodeJS.ProcessEnv, appData: string): DataPaths {
  const userData = env.TASKITE_USER_DATA ? path.resolve(env.TASKITE_USER_DATA) : null;
  const legacyFile = env.TASKITE_LEGACY_FILE
    ? path.resolve(env.TASKITE_LEGACY_FILE)
    : userData
      ? null
      : path.join(appData, 'Tasks', 'tasks.json');
  return { userData, legacyFile };
}

/** Only our own page may use the bridge or be navigated to. */
export function isAppUrl(url: string | undefined | null): boolean {
  return typeof url === 'string' && url.startsWith('app://taskite/');
}

/** The file under `root` that an app:// path names, or null when it would leave `root`. */
export function appFile(root: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const file = path.normalize(path.join(root, decoded === '/' ? '/index.html' : decoded));
  return file.startsWith(root + path.sep) ? file : null;
}
