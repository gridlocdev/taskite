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

  test('two-key shortcuts go to a view', async ({ page }) => {
    await page.keyboard.press('KeyG');
    await page.keyboard.press('KeyI');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Inbox');
  });

  test('going to a view by keys or the command menu takes the keyboard there', async ({ page }) => {
    const home = page.getByRole('button', { name: /^Home/ });
    await home.click();
    await page.keyboard.press('KeyG');
    await page.keyboard.press('KeyT');
    await expect(page.getByRole('listbox', { name: 'Today' })).toBeFocused();
    await home.click();
    await runCommand(page, 'Go to Today');
    await expect(page.getByRole('listbox', { name: 'Today' })).toBeFocused();
    // Down from there reaches the first task.
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('option').first()).toBeFocused();
  });

  test('? opens the Keyboard Shortcuts window', async ({ page }) => {
    await page.keyboard.press('Shift+Slash');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Command Menu');
    await expect(dialog).toContainText('Move to Trash');
  });
});
