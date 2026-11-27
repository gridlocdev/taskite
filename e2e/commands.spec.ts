import { expect, openApp, runCommand, test } from './fixtures.ts';

test.describe('Commands and shortcuts', () => {
  test.beforeEach(async ({ seed, page }) => {
    seed('basic');
    await openApp(page);
  });

  test('starts with no errors in the console', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await openApp(page);
    expect(errors).toEqual([]);
  });

  test('the command menu jumps to a project', async ({ page }) => {
    await runCommand(page, 'Go to Work');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Work');
  });

  test('the command menu finds a command by another word for it', async ({ page }) => {
    await page.keyboard.press('ControlOrMeta+KeyK');
    const menu = page.getByRole('dialog', { name: 'Command menu' });
    await expect(menu.getByRole('combobox')).toBeFocused();
    await page.keyboard.type('hotkeys');
    await expect(menu.getByRole('option').first()).toContainText('Keyboard Shortcuts');
  });

  test('a command that cannot run here says why in the command menu', async ({ page }) => {
    await page.keyboard.press('ControlOrMeta+KeyK');
    const menu = page.getByRole('dialog', { name: 'Command menu' });
    await page.keyboard.type('edit project');
    const item = menu.getByRole('option', { name: /Edit Project/ });
    await expect(item).toHaveAttribute('aria-disabled', 'true');
    await expect(item).toContainText('Go to a project other than the Inbox first.');
  });

  test('two-key shortcuts go to a view', async ({ page }) => {
    await page.keyboard.press('KeyG');
    await page.keyboard.press('KeyI');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Inbox');
  });

  test('going to a view by keys or the command menu takes the keyboard there', async ({ page }) => {
    const home = page.getByRole('button', { name: /^Home/ });
    await home.click();
    // The list hands the keyboard to its first row, with the cursor on it (PRD §9).
    const first = page.getByRole('listbox', { name: 'Today' }).getByRole('option').first();
    await page.keyboard.press('KeyG');
    await page.keyboard.press('KeyT');
    await expect(first).toBeFocused();
    await expect(first).toHaveClass(/tk-cursor/);
    await home.click();
    await runCommand(page, 'Go to Today');
    await expect(first).toBeFocused();
    // Down from there reaches the next task.
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('option').nth(1)).toBeFocused();
  });

  test('? opens the Keyboard Shortcuts window', async ({ page }) => {
    await page.keyboard.press('Shift+Slash');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Command Menu');
    await expect(dialog).toContainText('Move to Trash');
  });

  test('Press a Shortcut says what keys run and runs nothing, and Stop and Esc let the keys go', async ({
    page,
  }) => {
    await runCommand(page, 'Keyboard Shortcuts');
    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    const status = dialog.getByRole('status');
    await dialog.getByRole('button', { name: 'Press a Shortcut…' }).click();
    await expect(status).toContainText('Nothing runs');

    await page.keyboard.press('ControlOrMeta+KeyK');
    await expect(status).toContainText('runs Command Menu');
    await expect(page.getByRole('dialog', { name: 'Command menu' })).toHaveCount(0);
    await page.keyboard.press('KeyG');
    await expect(status).toContainText('press the next key');
    await page.keyboard.press('KeyI');
    await expect(status).toContainText('runs Go to Inbox');
    await page.keyboard.press('KeyQ');
    await expect(status).toContainText('runs no command');
    // ? toggles this window, but not while it listens.
    await page.keyboard.press('Shift+Slash');
    await expect(dialog).toBeVisible();

    await dialog.getByRole('button', { name: 'Stop' }).click();
    await expect(dialog.getByRole('button', { name: 'Press a Shortcut…' })).toBeVisible();
    await page.keyboard.press('Shift+Slash');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('Inbox');

    // Esc is never taken: it stops listening and closes the window, and keys work again.
    await page.keyboard.press('Shift+Slash');
    await dialog.getByRole('button', { name: 'Press a Shortcut…' }).click();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await page.keyboard.press('KeyG');
    await page.keyboard.press('KeyI');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Inbox');
  });
});
