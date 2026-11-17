// Random use of the whole app: seeded runs of commands from the ⌘K menu, typing and keys, checking after every
// step that nothing broke. `just e2e` runs a few seeds; `just soak` tries new ones (FUZZ_RUNS, FUZZ_SEED_BASE).
// A failure prints its seed: `FUZZ_SEED=<n> just e2e -g random` replays it, with every step. Keep a found bug
// as its own scenario.
import type { Page } from '@playwright/test';
import { commandMenu, expect, openApp, readTasks, test, watchErrors } from './fixtures.ts';
import { createRandom } from './randomOps.ts';

const STEPS = 40;

/**
 * Commands skipped, matched against the title of each ⌘K entry: ones that leave the page, and the clipboard
 * (Cut, Copy, Paste), which in a browser can be the owner's real one.
 */
const SKIP = [/Taskite Help/, /^(cut|copy|paste)\b/i];

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
  'KeyN',
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

/**
 * Open ⌘K and click one of its entries. Clicking runs exactly that entry (typing its name may match another one
 * first), and disabled entries are skipped (a click on one waits forever). Options are looked up inside the menu,
 * because list rows are options too. Returns what was run, or why nothing was.
 */
async function runRandomCommand(page: Page, pick: (count: number) => number): Promise<string> {
  await page.keyboard.press('ControlOrMeta+KeyK');
  const menu = commandMenu(page);
  const opened = await menu
    .getByRole('combobox')
    .waitFor({ timeout: 1000 })
    .then(
      () => true,
      () => false,
    );
  // ⌘K opens over no dialog but its own kind, so with one open this is expected: the per-step check makes sure
  // that dialog kept the keyboard.
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
  const chosen = usable[pick(usable.length)];
  if (!chosen) {
    await page.keyboard.press('Escape');
    return 'no command to run';
  }
  // A dialog a command opens a moment later (a Delete… confirmation) can replace the menu before the click lands.
  const clicked = await options
    .nth(chosen.i)
    .click({ timeout: 1000 })
    .then(
      () => true,
      () => false,
    );
  if (!clicked && (await menu.count()) === 0) return `command menu was replaced before ${chosen.label}`;
  if (!clicked) throw new Error(`could not click ${chosen.label} in the command menu`);
  return `command ${chosen.label}`;
}

/**
 * Longer than anything the app waits for before an edit reaches the file: Space and Delete play the row's way out
 * before they change anything (COMPLETE_MS, LEAVE_MS), and the save badge still says saved while one is pending.
 */
const SETTLE_MS = 1000;

/** The pause between random steps, on the page's clock. */
const STEP_PAUSE_MS = 50;

/**
 * `text` as a person could type it where the keyboard is. Playwright types a character that has no key on its
 * keyboard (é, 漢字, and a tab: Tab is a key, but `\t` isn't one of its characters) by inserting it as text,
 * which lands in the last text field, and takes the keyboard there, even when a button has it. No keyboard does
 * that, so outside a text field only the characters with keys are typed.
 */
async function typeable(page: Page, text: string): Promise<string> {
  const inText = await page.evaluate(() => {
    const active = document.activeElement;
    // A radio button or checkbox is an input too, but holds no text.
    const textInput = ['text', 'search', 'email', 'url', 'tel', 'password', 'number'];
    if (active instanceof HTMLInputElement) return textInput.includes(active.type);
    return (
      active instanceof HTMLTextAreaElement || (active instanceof HTMLElement && active.isContentEditable)
    );
  });
  return inText ? text : text.replace(/[^\x20-\x7e\n\r]/g, '');
}

/**
 * Where the keyboard is, when a dialog is open and the keyboard is not in it; null otherwise. A key pressed then
 * goes to the window behind the dialog.
 */
async function focusOutsideDialog(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const dialogs = [...document.querySelectorAll('[role=dialog], [role=alertdialog]')];
    const active = document.activeElement;
    if (dialogs.length === 0 || dialogs.some((dialog) => dialog.contains(active))) return null;
    const label = active?.getAttribute('aria-label') ?? '';
    return `${active?.tagName.toLowerCase()} ${label} while ${dialogs.map((d) => d.getAttribute('aria-label')).join(', ')} is open`;
  });
}

/** The sidebar's names and counts: what the window says is in the file. */
const sidebar = (page: Page) =>
  page.getByRole('navigation', { name: 'Views' }).getByRole('button').allInnerTexts();

/** After a run: everything is saved, and a reload shows the same tasks without changing the file. */
async function checkSettled(page: Page): Promise<void> {
  // A dialog a command opens a moment later (a Delete… confirmation) can come up after the first Escape.
  const dialogs = page.locator('[role=dialog], [role=alertdialog]');
  for (let i = 0; i < 6; i++) {
    await page.clock.runFor(STEP_PAUSE_MS);
    if ((await dialogs.count()) === 0) break;
    await page.keyboard.press('Escape');
  }
  await expect(dialogs, 'Escape closes every dialog').toHaveCount(0);
  // Until these timers fire, the saved state can show while a change is still on its way to the file.
  await page.clock.runFor(SETTLE_MS);
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
    // A step that hangs fails here, with the steps that led to it, instead of at the test's own timeout,
    // which would end the test before the seed and the steps are printed.
    page.setDefaultTimeout(5000);
    const errors = watchErrors(page);
    await openApp(page);

    const random = createRandom(runSeed);
    const log: string[] = [];
    try {
      for (let step = 0; step < STEPS; step++) {
        const roll = random.int(10);
        if (roll < 4) {
          log.push(await runRandomCommand(page, (count) => random.int(count)));
        } else if (roll < 7) {
          const text = await typeable(page, random.text(8));
          log.push(`type ${JSON.stringify(text)}`);
          await page.keyboard.type(text);
        } else {
          const key = random.pick(KEYS);
          log.push(`key ${key}`);
          await page.keyboard.press(key);
        }
        // A person takes longer than this between keys. Without it, focus the app moves a moment after a command
        // lands after the next key has opened a dialog, which no one could do.
        await page.clock.runFor(STEP_PAUSE_MS);
        expect(errors, 'console errors').toEqual([]);
        expect(await focusOutsideDialog(page), 'an open dialog has the keyboard').toBeNull();
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
