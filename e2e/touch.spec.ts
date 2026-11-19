// A phone: the tab bar, Browse, the Add button, and a finger's taps, long presses and swipes (PRD §5.5).
// Touches go through Chromium's own touch input, so the page sees the same pointer events a phone sends.
import type { Locator, Page } from '@playwright/test';
import { expect, fileTask, openApp, test } from './fixtures.ts';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

async function touch(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', x = 0, y = 0) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const middle = async (target: Locator) => {
    const box = (await target.boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  return {
    /** A finger dragged sideways across the target by dx px, in small steps, then lifted unless `hold`. */
    async swipe(target: Locator, dx: number, { hold = false } = {}) {
      const { x, y } = await middle(target);
      await send('touchStart', x, y);
      for (let i = 1; i <= 12; i++) await send('touchMove', x + (dx * i) / 12, y);
      if (!hold) await send('touchEnd');
    },
    /** Lifts a finger left down by `swipe(…, { hold: true })`. */
    lift: () => send('touchEnd'),
    /** A finger held still on the target until its menu opens, then lifted. */
    async longPress(target: Locator) {
      const { x, y } = await middle(target);
      await send('touchStart', x, y);
      await expect(page.getByRole('menu')).toBeVisible();
      await send('touchEnd');
    },
  };
}

const row = (page: Page, title: string) => page.getByRole('option', { name: new RegExp(title) });
const tab = (page: Page, name: string | RegExp) =>
  page.getByRole('navigation', { name: 'Tabs' }).getByRole('button', { name });

test.describe('Phones and touch screens', () => {
  test.beforeEach(async ({ seed, page }) => {
    seed('basic');
    await openApp(page);
  });

  test('the tab bar replaces the sidebar, and Browse holds the other views and search', async ({ page }) => {
    await expect(page.getByRole('navigation', { name: 'Views' })).toBeHidden();
    await expect(tab(page, /Today/)).toHaveAttribute('aria-current', 'page');

    await tab(page, /Inbox/).tap();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Inbox');
    await expect(tab(page, /Inbox/)).toHaveAttribute('aria-current', 'page');

    await tab(page, 'Browse').tap();
    await expect(page.getByRole('main')).toBeHidden();
    const views = page.getByRole('navigation', { name: 'Views' });
    // The tabs' own views aren't repeated in Browse.
    await expect(views.getByRole('button', { name: /^Today/ })).toBeHidden();
    await views.getByRole('button', { name: /Work/ }).tap();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Work');
    await expect(tab(page, 'Browse')).toHaveAttribute('aria-current', 'page');

    await tab(page, 'Browse').tap();
    // Search sits at the bottom, under the list and by the thumb, with New Project beside it and no ⌘K.
    const search = page.getByRole('searchbox', { name: 'Search tasks' });
    const top = async (target: Locator) => (await target.boundingBox())!.y;
    expect(await top(search)).toBeGreaterThan(await top(views.getByRole('button', { name: /Work/ })));
    await expect(views.getByRole('button', { name: 'New project' })).toBeVisible();
    await expect(views.getByRole('button', { name: 'Command menu' })).toBeHidden();
    await search.fill('dentist');
    await expect(row(page, 'Book dentist appointment')).toBeVisible();
    // The results fill the screen above it.
    await expect
      .poll(async () => (await top(search)) - (await top(row(page, 'dentist'))))
      .toBeGreaterThan(300);
  });

  test('search and the add-task panel ride on top of the on-screen keyboard', async ({ page }) => {
    // Chromium has no on-screen keyboard: stand in for one by shrinking the visual viewport, as a phone does.
    await page.evaluate(() => {
      const viewport = window.visualViewport!;
      let covered = 0;
      Object.defineProperty(viewport, 'height', { get: () => innerHeight - covered });
      Object.defineProperty(viewport, 'pageTop', { get: () => 0 });
      Object.assign(window, {
        keyboard: (px: number) => {
          covered = px;
          viewport.dispatchEvent(new Event('resize'));
        },
      });
    });
    const keyboard = (px: number) =>
      page.evaluate((h) => (window as unknown as { keyboard(px: number): void }).keyboard(h), px);
    const bottomOf = async (target: Locator) => {
      const box = (await target.boundingBox())!;
      return box.y + box.height;
    };

    await tab(page, 'Browse').tap();
    const search = page.getByRole('searchbox', { name: 'Search tasks' });
    await search.tap();
    await keyboard(300);
    await expect(page.getByRole('navigation', { name: 'Tabs' })).toBeHidden();
    await expect.poll(() => bottomOf(search)).toBeLessThanOrEqual(844 - 300);
    expect(await bottomOf(search)).toBeGreaterThan(844 - 300 - 60);
    await keyboard(0);
    await expect(page.getByRole('navigation', { name: 'Tabs' })).toBeVisible();

    await tab(page, /Inbox/).tap();
    await page.locator('.tk-fab').tap();
    await keyboard(300);
    const panel = page.locator('.tk-composer');
    await expect.poll(() => bottomOf(panel)).toBeLessThanOrEqual(844 - 300 + 1);
    expect(await bottomOf(panel)).toBeGreaterThan(844 - 300 - 4);
    await page.keyboard.type('Call the bank');
    await panel.getByRole('button', { name: 'Add' }).tap();
    await expect.poll(() => fileTask('Call the bank')?.projectId).toBe('inbox');
    // The panel stays open for the next task, with the keyboard.
    await expect(page.getByRole('textbox', { name: 'New task' })).toBeFocused();
  });

  test('a long press on the tab that is showing opens its view menu', async ({ page }) => {
    await tab(page, /Inbox/).tap();
    const { longPress } = await touch(page);
    await longPress(tab(page, /Inbox/));
    // Lifting the finger doesn't also pick the item the sheet opened under it.
    const menu = page.getByRole('menu', { name: 'Actions' });
    await expect(menu).toHaveClass(/tk-sheet/);
    await menu.getByRole('menuitem', { name: /View as Board/ }).tap();
    await expect(page.locator('.tk-board')).toBeVisible();
    await expect(tab(page, /Inbox/)).toHaveAttribute('aria-current', 'page');
  });

  test('the due date is a sheet with its quick picks by Set Date, and no keyboard until a field is tapped', async ({
    page,
  }) => {
    const { longPress } = await touch(page);
    await longPress(row(page, 'Water the plants'));
    await page.getByRole('menuitem', { name: /Due Date/ }).tap();
    const dialog = page.getByRole('dialog', { name: 'Due date' });
    await expect(dialog).toBeFocused();
    const sheet = (await dialog.boundingBox())!;
    expect(sheet.y + sheet.height).toBeGreaterThanOrEqual(844 - 1);
    const tomorrow = dialog.getByRole('button', { name: 'Tomorrow' });
    const calendar = (await dialog.locator('.tk-calendar').boundingBox())!;
    expect((await tomorrow.boundingBox())!.y).toBeGreaterThan(calendar.y + calendar.height - 1);
    await tomorrow.tap();
    await expect.poll(() => fileTask('Water the plants')?.due).toBe('2027-01-16');
  });

  test('a tap just outside a check circle still completes the task', async ({ page }) => {
    const check = (await row(page, 'Water the plants').locator('.tk-check').boundingBox())!;
    await page.touchscreen.tap(check.x + check.width / 2, check.y + check.height + 8);
    await expect.poll(() => fileTask('Water the plants')?.completed).toBe(true);
  });

  test('the Add button opens the add-task panel', async ({ page }) => {
    await tab(page, /Inbox/).tap();
    await page.locator('.tk-fab').tap();
    await expect(page.getByRole('textbox', { name: /task/i }).first()).toBeFocused();
    await page.keyboard.type('Call the bank');
    await page.keyboard.press('Enter');
    await expect.poll(() => fileTask('Call the bank')?.projectId).toBe('inbox');
  });

  test('swiping a row right completes it', async ({ page }) => {
    const { swipe } = await touch(page);
    await swipe(row(page, 'Water the plants'), 200);
    await expect.poll(() => fileTask('Water the plants')?.completed).toBe(true);
  });

  test('swiping a row left moves it to the Trash with Undo, and a short swipe springs back', async ({
    page,
  }) => {
    const { swipe } = await touch(page);
    await swipe(row(page, 'Water the plants'), -40);
    await expect(row(page, 'Water the plants')).not.toHaveAttribute('style', /translate/);
    expect(fileTask('Water the plants')?.deletedAt).toBeNull();

    await swipe(row(page, 'Water the plants'), -200);
    await expect.poll(() => fileTask('Water the plants')?.deletedAt).not.toBeNull();
    await expect(
      page.locator('.tk-notice').getByText('Moved "Water the plants" to the Trash.'),
    ).toBeVisible();
    // The Add button moves up out of the notice's way.
    const add = (await page.locator('.tk-fab').boundingBox())!;
    const notice = (await page.locator('.tk-status').boundingBox())!;
    expect(add.y + add.height).toBeLessThanOrEqual(notice.y);
    await page.locator('.tk-notice').getByRole('button', { name: 'Undo' }).tap();
    await expect.poll(() => fileTask('Water the plants')?.deletedAt).toBeNull();
  });

  test('tapping a row opens the task, and a long press opens its menu as a sheet', async ({ page }) => {
    await row(page, 'Water the plants').tap();
    await expect(page.getByRole('textbox', { name: 'Task name' })).toHaveValue('Water the plants');
    await page.getByRole('button', { name: 'Done' }).tap();
    await expect(page.getByRole('dialog')).toBeHidden();

    const { longPress } = await touch(page);
    await longPress(row(page, 'Water the plants'));
    const menu = page.getByRole('menu', { name: 'Task actions' });
    await expect(menu).toHaveClass(/tk-sheet/);
    // The priorities share one row of flags.
    await expect(menu.getByRole('group', { name: 'Priority' }).getByRole('menuitem')).toHaveCount(4);
    // The press that opened the menu doesn't also open the task.
    await expect(page.getByRole('textbox', { name: 'Task name' })).toBeHidden();
    await menu.getByRole('menuitem', { name: /Priority 1/ }).tap();
    await expect.poll(() => fileTask('Water the plants')?.priority).toBe(1);
  });

  test('a long press on a project in Browse opens its menu', async ({ page }) => {
    await tab(page, 'Browse').tap();
    const { longPress } = await touch(page);
    await longPress(page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: /Work/ }));
    await expect(page.getByRole('menuitem', { name: /Edit Project/ })).toBeVisible();
    // The press doesn't also open the project.
    await expect(page.getByRole('main')).toBeHidden();
  });

  test('looks right: the tab bar and Add button, a swipe under way, and a menu sheet', async ({ page }) => {
    await expect(page).toHaveScreenshot('phone-today.png');
    const { swipe, lift, longPress } = await touch(page);
    await swipe(row(page, 'Water the plants'), 150, { hold: true });
    await expect(page.locator('.tk-swipe-hint.tk-armed')).toBeVisible();
    await expect(page).toHaveScreenshot('phone-swipe.png');
    await lift();
    await expect(row(page, 'Water the plants')).toBeHidden();
    await longPress(row(page, 'Book dentist appointment'));
    await expect(page).toHaveScreenshot('phone-sheet.png');
  });
});
