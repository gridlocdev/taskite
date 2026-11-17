import { expect, fileTask, openApp, readTasks, runCommand, test, workAsBoard } from './fixtures.ts';

/** The rules a section of Work has in the file. */
function rulesOf(sectionId: string): unknown {
  const work = readTasks().projects.find((p) => p.name === 'Work');
  return work?.sections?.find((s) => s.id === sectionId)?.automations;
}

test.describe('Automations', () => {
  test.beforeEach(async ({ seed, page }) => {
    seed('basic');
    await openApp(page);
  });

  test('a section automation runs when a task moves in, says what it did, and Undo takes it all back', async ({
    page,
  }) => {
    await workAsBoard(page, true, [{ on: 'enter', do: [{ complete: true }, { addLabel: 'shipped' }] }]);
    await page.getByRole('button', { name: /^Work/ }).click();
    await page.getByRole('option', { name: /Plan team offsite/ }).click();
    await page.keyboard.press('Alt+ArrowRight');
    await expect(page.getByRole('status')).toContainText(
      'Moved to Done. Automation: completed it, added @shipped.',
    );
    await expect.poll(() => fileTask('Plan team offsite')?.completed).toBe(true);
    expect(fileTask('Plan team offsite')?.labels).toContain('shipped');

    // One undo step covers the move and everything the rule did.
    await page.keyboard.press('ControlOrMeta+KeyZ');
    await expect.poll(() => fileTask('Plan team offsite')?.completed).toBe(false);
    expect(fileTask('Plan team offsite')?.labels).not.toContain('shipped');
    expect(fileTask('Plan team offsite')?.sectionId).toBe('s2');
  });

  test('the editor builds rules from the section menu, and asks before applying them to tasks already there', async ({
    page,
  }) => {
    await workAsBoard(page, true);
    await page.getByRole('button', { name: /^Work/ }).click();

    // An empty Done column, from its ⋯ menu: nothing there yet, so Save just saves.
    await page.getByRole('button', { name: 'Done section actions' }).click();
    await page.getByRole('menuitem', { name: 'Section Automations…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Automations · Done' });
    await expect(dialog).toContainText('No automations yet.');
    await dialog.getByRole('button', { name: 'Add rule' }).click();
    await dialog.getByRole('button', { name: 'Add action' }).click();
    await dialog.getByRole('combobox', { name: 'Rule 1 action 2', exact: true }).selectOption('Add label');
    await dialog.getByRole('combobox', { name: 'Rule 1 action 2 label' }).fill('@shipped');
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(dialog).toBeHidden();
    await expect
      .poll(() => rulesOf('s3'))
      .toEqual([{ on: 'enter', do: [{ complete: true }, { addLabel: 'shipped' }] }]);

    // From ⌘K, for the column the cursor is in: Doing already holds a task, so Save asks first.
    await page.getByRole('option', { name: /Plan team offsite/ }).click();
    await runCommand(page, 'Section Automations');
    const doing = page.getByRole('dialog', { name: 'Automations · Doing' });
    await doing.getByRole('button', { name: 'Add rule' }).click();
    await doing.getByRole('combobox', { name: 'Rule 1 action 1', exact: true }).selectOption('Set priority');
    await doing.getByRole('button', { name: 'Save' }).click();
    await expect(doing).toContainText('Apply to the 1 task already in Doing?');
    await expect(doing.getByRole('button', { name: 'Apply' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(doing).toBeHidden();
    await expect.poll(() => fileTask('Plan team offsite')?.priority).toBe(1);
    await expect(page.getByRole('status')).toContainText(
      'Automations saved. Automation: set it to priority 1.',
    );

    // Saving and applying were one step.
    await page.keyboard.press('ControlOrMeta+KeyZ');
    await expect.poll(() => fileTask('Plan team offsite')?.priority).toBe(4);
    expect(rulesOf('s2')).toBeUndefined();
  });

  test('a section with rules shows ⚡ and their count; hovering lists them and a click opens the editor', async ({
    page,
  }) => {
    await workAsBoard(page, true, [
      { on: 'enter', do: [{ complete: true }, { addLabel: 'shipped' }] },
      {
        on: 'complete',
        do: [{ moveTo: { projectId: '978cd5f4-cbfd-4ecf-afad-4a96d464378b', sectionId: null } }],
      },
    ]);
    await page.getByRole('button', { name: /^Work/ }).click();
    const badge = page.getByRole('button', { name: 'Done automations: 2 rules' });
    await expect(badge).toHaveText('2');
    await expect(badge).toHaveAttribute(
      'title',
      'When a task enters: complete it, add @shipped\nWhen a task is completed: move it to Home',
    );
    await expect(page.getByRole('button', { name: /^Doing automations/ })).toHaveCount(0);
    await expect(page.getByRole('main')).toHaveScreenshot('board-automation-badge.png');
    await badge.click();
    await expect(page.getByRole('dialog', { name: 'Automations · Done' })).toBeVisible();
  });
});
