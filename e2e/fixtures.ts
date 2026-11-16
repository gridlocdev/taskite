// Shared scenario setup. `seed('basic')` replaces .e2e-data with a copy of e2e/fixtures/basic,
// so each test starts from known files and nothing one test writes leaks into the next.
// Every page runs on a clock that starts at NOW and keeps going, so the fixtures' dates mean the same each run.
import { execFileSync } from 'node:child_process';
import { expect, test as base, type Page } from '@playwright/test';
import { DATA, NOW, ROOT, seedData } from './server.ts';

export { expect };
export { DATA, NOW, fileTask, readTasks, seedData } from './server.ts';

export const test = base.extend<{ seed: (fixture: string) => void }>({
  page: async ({ page }, use) => {
    await page.clock.install({ time: NOW });
    await use(page);
  },
  // eslint-disable-next-line no-empty-pattern -- Playwright reads fixture names from this pattern.
  seed: async ({}, use) => {
    await use(seedData);
  },
});

/** Open the app the way a user does and wait until it has drawn: a key pressed sooner goes nowhere. */
export async function openApp(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('main').waitFor();
}

/** Run the Taskite CLI on the scenario's file, as a change made somewhere else. */
export function cli(...args: string[]): string {
  return execFileSync(
    process.execPath,
    [`${ROOT}apps/cli/src/main.ts`, '--file', `${DATA}/tasks.json`, ...args],
    {
      encoding: 'utf8',
    },
  );
}

/** Run a command from ⌘K by its name. */
export async function runCommand(page: Page, name: string): Promise<void> {
  await page.keyboard.press('ControlOrMeta+KeyK');
  const menu = page.getByRole('dialog', { name: 'Command menu' });
  await expect(menu.getByRole('combobox')).toBeFocused();
  await page.keyboard.type(name);
  await page.keyboard.press('Enter');
  await expect(menu).toBeHidden();
}
