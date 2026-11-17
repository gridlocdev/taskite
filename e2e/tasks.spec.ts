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

  test('the editor adds a field from its button and focuses it; taking the value away brings the button back', async ({
    page,
  }) => {
    await page.getByRole('option', { name: /Water the plants/ }).click();
    await page.keyboard.press('Enter');
    const editor = page.getByRole('dialog', { name: 'Task' });
    const buttons = editor.getByRole('group', { name: 'Add to the task' });
    // The task has a date, so Due date shows as a field, not a button.
    await expect(buttons.getByRole('button')).toHaveText(['Repeat', 'Priority', 'Labels', 'Subtasks']);
    await expect(editor).toHaveScreenshot('editor-add-buttons.png');

    await buttons.getByRole('button', { name: 'Priority' }).click();
    const priority = editor.getByRole('combobox', { name: 'Priority' });
    await expect(priority).toBeFocused();
    await expect(buttons.getByRole('button', { name: 'Priority' })).toHaveCount(0);
    await priority.selectOption('2');
    await expect.poll(() => fileTask('Water the plants')?.priority).toBe(2);
    await editor.getByRole('button', { name: 'Remove priority' }).click();
    await expect.poll(() => fileTask('Water the plants')?.priority).toBe(4);
    await expect(priority).toBeHidden();
    await expect(buttons.getByRole('button', { name: 'Priority' })).toBeFocused();

    // Emptying a field by hand works the same way.
    await buttons.getByRole('button', { name: 'Labels' }).click();
    await expect(editor.getByRole('textbox', { name: 'Labels' })).toBeFocused();
    await page.keyboard.type('errands');
    await page.keyboard.press('Tab');
    await expect.poll(() => fileTask('Water the plants')?.labels).toEqual(['errands']);
    await editor.getByRole('textbox', { name: 'Labels' }).fill('');
    await page.keyboard.press('Tab');
    await expect.poll(() => fileTask('Water the plants')?.labels).toEqual([]);
    await expect(editor.getByRole('textbox', { name: 'Labels' })).toBeHidden();
    await expect(buttons.getByRole('button', { name: 'Labels' })).toBeVisible();
  });

  test('Shift and the arrow keys choose several tasks, and Space completes them all', async ({ page }) => {
    await page.getByRole('option', { name: /Book dentist appointment/ }).click();
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Space');
    await expect.poll(() => fileTask('Book dentist appointment')?.completed).toBe(true);
    await expect.poll(() => fileTask('Water the plants')?.completed).toBe(true);
  });
});
