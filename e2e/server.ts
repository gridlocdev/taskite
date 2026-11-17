// Where the scenarios and the driver find the app: the NAS server serving the built client over fixture data.
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, utimesSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const DATA = `${ROOT}.e2e-data`;
/**
 * A port no other app's checks use, so two apps' checks can run at once (Cellestra uses 8791, Puffinote 8793).
 * An app that shares one stops the other's server or fails with EADDRINUSE.
 */
export const PORT = 8797;
export const BASE_URL = `http://127.0.0.1:${PORT}`;
/** The page's clock in every scenario and in the driver, so "today" and "overdue" in the fixtures never move. */
export const NOW = new Date('2027-01-15T09:00:00Z');
/** Every fixture file's modified time, so anything that shows or compares file dates sees the same on every run. */
const FIXTURE_TIME = new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000);

export const SERVER_COMMAND = ['apps/server/src/main.ts'];
export const SERVER_ENV: Record<string, string> = {
  TASKITE_PORT: String(PORT),
  TASKITE_HOST: '127.0.0.1',
  TASKITE_DATA: DATA,
  TASKITE_STATIC: `${ROOT}apps/web/dist`,
};

/** Replace .e2e-data with a fresh copy of e2e/fixtures/<fixture>. Never point this at real data. */
export function seedData(fixture: string): void {
  rmSync(DATA, { recursive: true, force: true });
  mkdirSync(DATA, { recursive: true });
  cpSync(fileURLToPath(new URL(`./fixtures/${fixture}`, import.meta.url)), DATA, { recursive: true });
  for (const file of readdirSync(DATA, { recursive: true, encoding: 'utf8' })) {
    utimesSync(`${DATA}/${file}`, FIXTURE_TIME, FIXTURE_TIME);
  }
}

export interface FileTask {
  title: string;
  projectId: string;
  due: string | null;
  priority: number;
  labels: string[];
  completed: boolean;
  deletedAt: number | null;
}

/** The tasks file as the server has it now. */
export function readTasks(): {
  projects: { id: string; name: string }[];
  tasks: FileTask[];
  settings: { showCompleted?: boolean };
} {
  return JSON.parse(readFileSync(`${DATA}/tasks.json`, 'utf8'));
}

/** The task in the file with this title. */
export function fileTask(title: string): FileTask | undefined {
  return readTasks().tasks.find((t) => t.title === title);
}
