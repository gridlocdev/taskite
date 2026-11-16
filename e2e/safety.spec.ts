import { cli, expect, fileTask, openApp, runCommand, test } from './fixtures.ts';

test.describe('Never losing a task', () => {
  test.beforeEach(async ({ seed, page }) => {
    seed('basic');
    await openApp(page);
  });

  test('Undo brings back a completed task, in the file too', async ({ page }) => {
    await page.getByRole('checkbox', { name: 'Complete "Water the plants"' }).click();
    await expect.poll(() => fileTask('Water the plants')?.completed).toBe(true);
    await page.keyboard.press('ControlOrMeta+KeyZ');
    await expect(page.getByRole('option', { name: /Water the plants/ })).toBeVisible();
    await expect.poll(() => fileTask('Water the plants')?.completed).toBe(false);
  });

  test('a deleted task waits in the Trash and R restores it', async ({ page }) => {
    await page.getByRole('option', { name: /Water the plants/ }).click();
    await page.keyboard.press('Delete');
    await expect.poll(() => fileTask('Water the plants')?.deletedAt).not.toBeNull();
    await page.getByRole('button', { name: 'Trash' }).click();
    await page.getByRole('option', { name: /Water the plants/ }).click();
    await page.keyboard.press('KeyR');
    await expect.poll(() => fileTask('Water the plants')?.deletedAt).toBeNull();
  });

  test('a task added somewhere else shows up without a reload', async ({ page }) => {
    cli('add', 'Call the plumber today');
    // The window looks for outside changes every 15 seconds while it's in front.
    await page.clock.runFor(16_000);
    await expect(page.getByRole('status')).toHaveText('Updated with a change made elsewhere.');
    await expect(page.getByRole('option', { name: /Call the plumber/ })).toBeVisible();
  });

  test('a change made here after the file changed elsewhere asks first, and Keep Mine keeps it', async ({
    page,
  }) => {
    cli('add', 'Call the plumber today');
    await page.getByRole('checkbox', { name: 'Complete "Water the plants"' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: 'Save Mine as a Copy' })).toBeVisible();
    expect(fileTask('Water the plants')?.completed, 'nothing is written before the choice').toBe(false);
    await dialog.getByRole('button', { name: 'Keep Mine' }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(() => fileTask('Water the plants')?.completed).toBe(true);
    expect(fileTask('Call the plumber'), 'Keep Mine replaces the outside change').toBeUndefined();
  });

  test('Use Theirs takes the file as it is now', async ({ page }) => {
    cli('add', 'Call the plumber today');
    await page.getByRole('checkbox', { name: 'Complete "Water the plants"' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Use Theirs' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('option', { name: /Call the plumber/ })).toBeVisible();
    await expect(page.getByRole('option', { name: /Water the plants/ })).toBeVisible();
    expect(fileTask('Water the plants')?.completed).toBe(false);
  });

  test('Move Completed Tasks to Trash from the command menu keeps them in the Trash', async ({ page }) => {
    await runCommand(page, 'Move Completed Tasks to Trash');
    await expect.poll(() => fileTask('Read chapter four')?.deletedAt).not.toBeNull();
  });
});
