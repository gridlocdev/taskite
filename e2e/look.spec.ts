import { expect, openApp, runCommand, test } from './fixtures.ts';

test.describe('Look', () => {
  test.beforeEach(async ({ seed, page }) => {
    seed('basic');
    await openApp(page);
  });

  test('Today looks right in light and dark', async ({ page }) => {
    await expect(page).toHaveScreenshot('today-light.png');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page).toHaveScreenshot('today-dark.png');
  });

  test('the dark theme stays chosen after a reload', async ({ page }) => {
    await runCommand(page, 'Theme: Dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await openApp(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });
});
