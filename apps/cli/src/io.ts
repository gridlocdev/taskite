import path from 'node:path';

/** Everything the CLI touches outside the tasks file, so tests run it without a process. */
export interface CliIo {
  stdout(text: string): void;
  stderr(text: string): void;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly cwd: string;
  readonly home: string;
  readonly platform: NodeJS.Platform;
  now(): number;
}

/** Where the desktop app keeps its tasks (PRD §3.6). */
export function desktopFile(io: Pick<CliIo, 'env' | 'home' | 'platform'>): string {
  return path.join(appDataFolder(io), 'Taskite', 'tasks.json');
}

/** The old "Tasks" app's file, which the desktop app reads once (PRD §3.2). */
export function legacyFile(io: Pick<CliIo, 'env' | 'home' | 'platform'>): string {
  return path.join(appDataFolder(io), 'Tasks', 'tasks.json');
}

function appDataFolder({ env, home, platform }: Pick<CliIo, 'env' | 'home' | 'platform'>): string {
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support');
  if (platform === 'win32') return env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
  return env.XDG_CONFIG_HOME ?? path.join(home, '.config');
}

/** The file this run uses: --file, else $TASKITE_FILE, else the desktop app's. */
export function chooseFile(flag: string | null, io: CliIo): { file: string; isDefault: boolean } {
  const given = flag ?? io.env.TASKITE_FILE;
  return given
    ? { file: path.resolve(io.cwd, given), isDefault: false }
    : { file: desktopFile(io), isDefault: true };
}
