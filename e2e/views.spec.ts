import { expect, openApp, test } from './fixtures.ts';

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
});
