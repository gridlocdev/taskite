import { expect, fileTask, openApp, readTasks, test } from './fixtures.ts';

test.describe('Quick Add', () => {
  test.beforeEach(async ({ seed, page }) => {
    seed('basic');
    await openApp(page);
  });

  test('one line becomes a task with its date, priority, project and label, saved to the file', async ({
    page,
  }) => {
    await page.keyboard.press('KeyN');
    const row = page.getByRole('textbox', { name: 'New task' });
    await expect(row).toBeFocused();
    await page.keyboard.type('Buy milk tomorrow p1 #Errands @shop');
    await expect(page.getByText('Errands (new)')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(row).toHaveValue('');
    await page.keyboard.press('Escape');

    await expect.poll(() => fileTask('Buy milk')?.due).toBe('2027-01-16');
    const task = fileTask('Buy milk');
    expect(task?.priority).toBe(1);
    expect(task?.labels).toEqual(['shop']);
    expect(readTasks().projects.find((p) => p.id === task?.projectId)?.name).toBe('Errands');

    await page.reload();
    await page.getByRole('button', { name: /^Errands/ }).click();
    await expect(page.getByRole('option', { name: /Buy milk/ })).toBeVisible();
  });

  test('a task added in a project starts in that project', async ({ page }) => {
    await page.getByRole('button', { name: /^Work/ }).click();
    await page.keyboard.press('KeyN');
    await expect(page.getByRole('textbox', { name: 'New task' })).toBeFocused();
    await page.keyboard.type('Write the agenda');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('option', { name: /Write the agenda/ })).toBeVisible();
    await expect
      .poll(() => fileTask('Write the agenda')?.projectId)
      .toBe(readTasks().projects.find((p) => p.name === 'Work')?.id);
  });
});
