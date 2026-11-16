// Random use of the whole app: seeded runs of commands from the ⌘K menu, typing and keys, checking after every
// step that nothing broke. `just e2e` runs a few seeds; `just soak` tries new ones (FUZZ_RUNS, FUZZ_SEED_BASE).
// A failure prints its seed: `FUZZ_SEED=<n> just e2e -g random` replays it. Keep a found bug as its own scenario.
import type { Page } from '@playwright/test';
import { expect, openApp, readTasks, test } from './fixtures.ts';
import { createRandom } from './randomOps.ts';

const STEPS = 40;

/** Commands that leave the page. Matched against the text of each ⌘K entry. */
const SKIP = [/Taskite Help/];

/** Keys worth pressing on their own, besides the letters random typing presses. */
const KEYS = [
  'Escape',
  'Enter',
  'Tab',
  'Shift+Tab',
  'Space',
  'ArrowUp',
  'ArrowDown',
  'Shift+ArrowDown',
  'Alt+ArrowUp',
  'Alt+ArrowDown',
  'Alt+ArrowLeft',
  'Alt+ArrowRight',
  'Home',
  'End',
  'Backspace',
  'Delete',
  'KeyQ',
  'KeyD',
  'KeyM',
  'KeyR',
  'Shift+Slash',
  'Slash',
  'ControlOrMeta+KeyZ',
  'ControlOrMeta+Shift+KeyZ',
  'ControlOrMeta+KeyA',
];

const runs = Number(process.env.FUZZ_RUNS ?? 3);
const base = Number(process.env.FUZZ_SEED_BASE ?? 1);
const seeds = process.env.FUZZ_SEED
  ? [Number(process.env.FUZZ_SEED)]
  : Array.from({ length: runs }, (_, i) => base + i);

/** Open ⌘K, pick an entry and run it. Returns what was run, or why nothing was. */
async function runRandomCommand(page: Page, pick: (count: number) => number): Promise<string> {
  await page.keyboard.press('ControlOrMeta+KeyK');
  const menu = page.getByRole('dialog', { name: 'Command menu' });
  const opened = await menu
    .getByRole('combobox')
    .waitFor({ timeout: 1000 })
    .then(
      () => true,
      () => false,
    );
  // Another window that is open (a dialog, a menu) keeps ⌘K to itself.
  if (!opened) return 'command menu did not open';
  const options = menu.getByRole('option');
  const entries = await options.evaluateAll((items) =>
    items.map((item) => ({
      label: item.querySelector('.tk-palette-title')?.textContent ?? '',
      enabled: item.getAttribute('aria-disabled') !== 'true',
    })),
  );
  const usable = entries
    .map((entry, i) => ({ ...entry, i }))
    .filter(({ label, enabled }) => enabled && !SKIP.some((p) => p.test(label)));
  if (usable.length === 0) {
    await page.keyboard.press('Escape');
    return 'no command to run';
  }
  const { label, i } = usable[pick(usable.length)] ?? usable[0]!;
  await options.nth(i).click();
  return `command ${label}`;
}

/** The sidebar's names and counts: what the window says is in the file. */
const sidebar = (page: Page) =>
  page.getByRole('navigation', { name: 'Views' }).getByRole('button').allInnerTexts();

/** After a run: everything is saved, and a reload shows the same tasks without changing the file. */
async function checkSettled(page: Page): Promise<void> {
  for (let i = 0; i < 4; i++) await page.keyboard.press('Escape');
  await expect(page.locator('.tk-save'), 'every change is saved').toHaveClass(/tk-save-saved/);
  const before = await sidebar(page);
  const file = JSON.stringify(readTasks());
  await openApp(page);
  expect(await sidebar(page), 'a reload shows what was there').toEqual(before);
  expect(JSON.stringify(readTasks()), 'a reload writes nothing').toBe(file);
}

for (const runSeed of seeds) {
  test(`random use, seed ${runSeed}`, async ({ page, seed }) => {
    seed('basic');
    // A step that hangs fails here, with the steps that led to it, instead of at the test's own timeout.
    page.setDefaultTimeout(5000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await openApp(page);

    const random = createRandom(runSeed);
    const log: string[] = [];
    try {
      for (let step = 0; step < STEPS; step++) {
        const roll = random.int(10);
        if (roll < 4) {
          log.push(await runRandomCommand(page, (count) => random.int(count)));
        } else if (roll < 7) {
          const text = random.text(8);
          log.push(`type ${JSON.stringify(text)}`);
          await page.keyboard.type(text);
        } else {
          const key = random.pick(KEYS);
          log.push(`key ${key}`);
          await page.keyboard.press(key);
        }
        expect(errors, 'console errors').toEqual([]);
      }
      log.push('settle');
      await checkSettled(page);
      expect(errors, 'console errors').toEqual([]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const steps = process.env.FUZZ_SEED ? log : log.slice(-20);
      throw new Error(`FUZZ_SEED=${runSeed} failed after:\n${steps.join('\n')}\n\n${message}`, {
        cause: error,
      });
    }
  });
}
