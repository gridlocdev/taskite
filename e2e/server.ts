// Where the scenarios and the driver find the app: the NAS server serving the built client over fixture data.
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const DATA = `${ROOT}.e2e-data`;
export const PORT = 8797;
export const BASE_URL = `http://127.0.0.1:${PORT}`;
/** The page's clock in every scenario, so "today" and "overdue" in the fixtures never move. */
export const NOW = new Date('2027-01-15T09:00:00Z');

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
export function readTasks(): { projects: { id: string; name: string }[]; tasks: FileTask[] } {
  return JSON.parse(readFileSync(`${DATA}/tasks.json`, 'utf8'));
}

/** The task in the file with this title. */
export function fileTask(title: string): FileTask | undefined {
  return readTasks().tasks.find((t) => t.title === title);
}
