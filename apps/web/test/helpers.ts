import { MemoryStore, TaskSession, memoryRecovery } from '@taskite/ui';
import { buildCommands } from '../src/app/commands.ts';
import { AppController } from '../src/app/controller.ts';

/** 2026-03-10, a Tuesday, at noon. */
export const NOW = new Date(2026, 2, 10, 12).getTime();

export async function makeApp(text: string | null = null) {
  let n = 0;
  const store = new MemoryStore(text);
  const { session } = await TaskSession.open(store, {
    recovery: memoryRecovery(),
    wait: async () => undefined,
    now: () => NOW,
    newId: () => `id${++n}`,
  });
  const app = new AppController(session, { now: () => NOW, wait: async () => undefined, version: '9.9.9' });
  const catalog = buildCommands(app);
  return { app, catalog, store, session };
}
