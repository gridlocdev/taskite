import { expect, openApp, readTasks, runCommand, test, workAsBoard } from './fixtures.ts';

test.describe('Views', () => {
  test.beforeEach(async ({ seed, page }) => {
    seed('basic');
    await openApp(page);
  });

  test('Today lists what is due today under what is overdue', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Today');
    await expect(page.getByRole('region', { name: 'Overdue' })).toContainText('Book dentist appointment');
    await expect(page.getByRole('region', { name: /^Today ·/ })).toContainText('Water the plants');
  });

  test('a project lists its open tasks', async ({ page }) => {
    await page.getByRole('button', { name: /^Home/ }).click();
    const list = page.getByRole('listbox', { name: 'Home' });
    await expect(list.getByRole('option')).toHaveCount(3);
    await expect(list).toContainText('Café ☕ list for Zoë');
  });

  test('Upcoming shows tasks due later this week', async ({ page }) => {
    await page.getByRole('button', { name: 'Upcoming' }).click();
    await expect(page.getByRole('main')).toContainText('Draft quarterly report');
  });

  test('Completed lists finished tasks', async ({ page }) => {
    await page.getByRole('button', { name: 'Completed' }).click();
    await expect(page.getByRole('main')).toContainText('Read chapter four');
  });

  test('Show Completed Tasks lists finished tasks in the Inbox and is remembered', async ({ page }) => {
    await page.getByRole('button', { name: /^Inbox/ }).click();
    const inbox = page.getByRole('listbox', { name: 'Inbox' });
    await expect(inbox).not.toContainText('Read chapter four');
    await runCommand(page, 'Show Completed Tasks');
    await expect(inbox.getByRole('option').last()).toContainText('Read chapter four');
    await expect.poll(() => readTasks().settings.showCompleted).toBe(true);
    await page.reload();
    await expect(page.getByRole('listbox', { name: 'Inbox' })).toContainText('Read chapter four');
  });

  test('a label lists its tasks', async ({ page }) => {
    await page.getByRole('button', { name: /^errand/ }).click();
    await expect(page.getByRole('main').getByRole('option')).toHaveCount(2);
  });

  test('Search finds a task by part of its name, finished ones too', async ({ page }) => {
    await page.keyboard.press('Slash');
    await expect(page.getByRole('searchbox', { name: 'Search tasks' })).toBeFocused();
    await page.keyboard.type('chapter');
    await expect(page.getByRole('main')).toContainText('Read chapter four');
    await expect(page.getByRole('main')).not.toContainText('Water the plants');
  });

  test('Tab reaches every board column, and lands on the cursor row in a list', async ({ page }) => {
    await workAsBoard(page);
    await page.getByRole('button', { name: /^Work/ }).click();
    const draft = page.getByRole('option', { name: /Draft quarterly report/ });
    const plan = page.getByRole('option', { name: /Plan team offsite/ });
    await draft.click();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('main').getByRole('button', { name: 'Add task' }).first()).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Doing section actions' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(plan).toBeFocused();
    await expect(plan).toHaveAttribute('aria-selected', 'true');
    await expect(draft).toHaveAttribute('aria-selected', 'false');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(draft).toBeFocused();

    // A list is one stop: Tab goes from the cursor row to Add task, past the other rows.
    await page.getByRole('button', { name: /^Home/ }).click();
    await page.getByRole('option').first().click();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('main').getByRole('button', { name: 'Add task' })).toBeFocused();
  });

  test('keys and Go to Section move between sections in a list and on a board', async ({ page }) => {
    // A list: Shift+Option+Down goes from Overdue to the first task due today.
    await page.getByRole('region', { name: 'Overdue' }).getByRole('option').first().click();
    await page.keyboard.press('Alt+Shift+ArrowDown');
    const todays = page
      .getByRole('region', { name: /^Today ·/ })
      .getByRole('option')
      .first();
    await expect(todays).toBeFocused();
    await expect(todays).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Alt+Shift+ArrowUp');
    await expect(page.getByRole('region', { name: 'Overdue' }).getByRole('option').first()).toBeFocused();

    await workAsBoard(page, true);
    await page.getByRole('button', { name: /^Work/ }).click();
    const draft = page.getByRole('option', { name: /Draft quarterly report/ });
    const plan = page.getByRole('option', { name: /Plan team offsite/ });
    await draft.click();
    await page.keyboard.press('ArrowRight');
    await expect(plan).toBeFocused();
    await expect(plan).toHaveAttribute('aria-selected', 'true');
    // The empty Done column is skipped, so there is nowhere further right.
    await page.keyboard.press('ArrowRight');
    await expect(plan).toBeFocused();
    await page.keyboard.press('Alt+Shift+ArrowLeft');
    await expect(draft).toBeFocused();

    // Go to Section… in an empty column opens the add-task row there.
    await page.keyboard.press('g');
    await page.keyboard.press('s');
    await expect(page.getByRole('dialog').getByRole('combobox')).toBeFocused();
    await page.keyboard.type('done');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('region', { name: 'Done' }).getByRole('textbox')).toBeFocused();
  });

  test('Down reaches the Add task button after the last task, and Enter there adds a task', async ({
    page,
  }) => {
    await page.getByRole('button', { name: /^Home/ }).click();
    await page.getByRole('option').last().click();
    await page.keyboard.press('ArrowDown');
    const add = page.getByRole('main').getByRole('button', { name: 'Add task' });
    await expect(add).toBeFocused();
    // Highlighted like a chosen task, even though the row before it was clicked with the mouse.
    await expect(add).toHaveClass(/tk-chosen/);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('textbox', { name: 'New task' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(add).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(page.getByRole('option').last()).toBeFocused();

    // Typing on the button starts the task, even letters that are shortcuts elsewhere (N, D, M, J).
    await page.keyboard.press('ArrowDown');
    await page.keyboard.type('Need DMJ milk');
    const field = page.getByRole('textbox', { name: 'New task' });
    await expect(field).toBeFocused();
    await expect(field).toHaveValue('Need DMJ milk');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('option', { name: /Need DMJ milk/ })).toBeVisible();
  });

  test('with nothing focused, the arrow keys put the keyboard on the row or button they reach', async ({
    page,
  }) => {
    await page.getByRole('button', { name: /^Home/ }).click();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    // Up from nowhere goes to the last stop: the Add task button.
    await page.keyboard.press('ArrowUp');
    await expect(page.getByRole('main').getByRole('button', { name: 'Add task' })).toBeFocused();
    await page.keyboard.type('Buy');
    await expect(page.getByRole('textbox', { name: 'New task' })).toHaveValue('Buy');
  });

  test('the Add task highlight follows the keyboard when Tab moves off the button', async ({ page }) => {
    await page.getByRole('button', { name: /^Home/ }).click();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('ArrowUp');
    const add = page.getByRole('main').getByRole('button', { name: 'Add task' });
    await expect(add).toBeFocused();
    await expect(add).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await page.keyboard.press('Shift+Tab');
    await expect(add).not.toBeFocused();
    await expect(add).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await page.keyboard.press('Tab');
    await expect(add).toBeFocused();
    await expect(add).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    // Add section is in the list too, but the highlight still goes with the keyboard.
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Add section' })).toBeFocused();
    await expect(add).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  });
});
