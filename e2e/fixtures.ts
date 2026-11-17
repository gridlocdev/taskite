// Shared scenario setup. `seed('basic')` replaces .e2e-data with a copy of e2e/fixtures/basic,
// so each test starts from known files and nothing one test writes leaks into the next.
// Every page runs on a clock that starts at NOW and keeps going, so the fixtures' dates mean the same on every run;
// `page.clock.runFor(ms)` moves it on, which checks a timer (an autosave, a row's way out) without waiting for it.
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

/**
 * Failed requests the app expects and handles, by status, method and URL. Everything else that fails is an error.
 */
const EXPECTED: readonly { status: number; method: string; url: RegExp }[] = [];

/**
 * Collect what went wrong on the page: uncaught errors, console errors and failed requests. The browser's own
 * "Failed to load resource" line names no URL, so the request is reported instead, with its URL.
 */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) {
      errors.push(message.text());
    }
  });
  page.on('response', (response) => {
    const status = response.status();
    const method = response.request().method();
    const url = response.url();
    if (
      status >= 400 &&
      !EXPECTED.some((e) => e.status === status && e.method === method && e.url.test(url))
    ) {
      errors.push(`${status} ${method} ${url}`);
    }
  });
  return errors;
}

/** The ⌘K menu: a dialog named "Command menu" holding a combobox, with an option for each entry. */
export const commandMenu = (page: Page) => page.getByRole('dialog', { name: 'Command menu' });

/**
 * Run a command from ⌘K by its name. Type the way a person does: wait until focus is in the field, then use the
 * keyboard. `fill()` right after a field appears can land before the component has set itself up, and be lost.
 */
export async function runCommand(page: Page, name: string): Promise<void> {
  await page.keyboard.press('ControlOrMeta+KeyK');
  const menu = commandMenu(page);
  await expect(menu.getByRole('combobox')).toBeFocused();
  await page.keyboard.type(name);
  await page.keyboard.press('Enter');
  await expect(menu).toBeHidden();
}
