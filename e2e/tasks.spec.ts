import { expect, fileTask, openApp, test } from './fixtures.ts';

test.describe('Working on tasks', () => {
  test.beforeEach(async ({ seed, page }) => {
    seed('basic');
    await openApp(page);
  });

  test('completing a task with its circle saves it as done', async ({ page }) => {
    await page.getByRole('checkbox', { name: 'Complete "Water the plants"' }).click();
    await expect.poll(() => fileTask('Water the plants')?.completed).toBe(true);
    await expect(page.getByRole('option', { name: /Water the plants/ })).toBeHidden();
  });

  test('renaming a task in its editor saves the new name', async ({ page }) => {
    await page.getByRole('option', { name: /Water the plants/ }).click();
    await page.keyboard.press('Enter');
    // Type as a person does, once focus is in the field: fill() can land before the editor has set itself up.
    await expect(page.getByRole('textbox', { name: 'Task name' })).toBeFocused();
    await page.keyboard.press('ControlOrMeta+KeyA');
    await page.keyboard.type('Water the ferns');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('option', { name: /Water the ferns/ })).toBeVisible();
    await expect.poll(() => fileTask('Water the ferns')?.due).toBe('2027-01-15');
  });

  test('Shift and the arrow keys choose several tasks, and Space completes them all', async ({ page }) => {
    await page.getByRole('option', { name: /Book dentist appointment/ }).click();
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Space');
    await expect.poll(() => fileTask('Book dentist appointment')?.completed).toBe(true);
    await expect.poll(() => fileTask('Water the plants')?.completed).toBe(true);
  });
});
