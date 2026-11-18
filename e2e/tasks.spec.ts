import { readFileSync } from 'node:fs';
import { DATA, expect, fileTask, openApp, test } from './fixtures.ts';

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
    await page.keyboard.press('ControlOrMeta+Enter');
    // Type as a person does, once focus is in the field: fill() can land before the editor has set itself up.
    await expect(page.getByRole('textbox', { name: 'Task name' })).toBeFocused();
    await page.keyboard.press('ControlOrMeta+KeyA');
    await page.keyboard.type('Water the ferns');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('option', { name: /Water the ferns/ })).toBeVisible();
    await expect.poll(() => fileTask('Water the ferns')?.due).toBe('2027-01-15');
  });

  test('Enter renames a task in its row, the field survives switching windows, and Esc puts the name back', async ({
    page,
  }) => {
    const row = page.getByRole('option', { name: /Water the plants/ });
    await row.click();
    await page.keyboard.press('Enter');
    const field = row.getByRole('textbox', { name: 'Task name' });
    await expect(field).toBeFocused();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.keyboard.type(' twice');
    // Another window takes the keyboard: the field stays open with what was typed, and saves nothing yet.
    await page.evaluate(() => {
      document.hasFocus = () => false;
      (document.activeElement as HTMLElement).blur();
      window.dispatchEvent(new Event('blur'));
    });
    await page.evaluate(() => {
      document.hasFocus = () => true;
      window.dispatchEvent(new Event('focus'));
    });
    await expect(field).toHaveValue('Water the plants twice');
    await field.focus();
    await page.keyboard.press('Enter');
    await expect(field).toBeHidden();
    await expect(page.getByRole('option', { name: /Water the plants twice/ })).toBeFocused();
    await expect.poll(() => fileTask('Water the plants twice')?.due).toBe('2027-01-15');

    // Esc puts the name back; ⌘Enter saves and opens the full editor.
    await page.keyboard.press('Enter');
    await page.keyboard.type(' more');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('option', { name: /plants twice Today/ })).toBeVisible();
    await page.keyboard.press('Enter');
    await page.keyboard.type('!');
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(page.getByRole('dialog', { name: 'Task' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Task name' })).toHaveValue('Water the plants twice!');
  });

  test('files attach from the editor button, a drop or a paste, show their size, open, and come off with ×', async ({
    page,
  }) => {
    await page.getByRole('option', { name: /Water the plants/ }).click();
    await page.keyboard.press('ControlOrMeta+Enter');
    const editor = page.getByRole('dialog', { name: 'Task' });
    const chooser = page.waitForEvent('filechooser');
    await editor.getByRole('button', { name: 'Attachments' }).click();
    await (
      await chooser
    ).setFiles([
      { name: 'plant care.txt', mimeType: 'text/plain', buffer: Buffer.from('Water weekly.') },
      { name: 'fern.png', mimeType: 'image/png', buffer: Buffer.alloc(2048) },
    ]);
    const files = editor.getByRole('list', { name: 'Attachments' });
    await expect(files.getByRole('listitem')).toHaveText([/plant care\.txt\s*13 B/, /fern\.png\s*2 KB/]);
    await expect(page.getByRole('status')).toContainText('Attached 2 files.');
    await expect.poll(() => fileTask('Water the plants')?.attachments?.length).toBe(2);
    const [care] = fileTask('Water the plants')?.attachments ?? [];
    expect(readFileSync(`${DATA}/attachments/${care?.id}`, 'utf8')).toBe('Water weekly.');
    await expect(editor).toHaveScreenshot('editor-attachments.png');

    // Dropping a file on the editor attaches it too.
    const dropped = await page.evaluateHandle(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(['notes'], 'repotting.md', { type: 'text/markdown' }));
      return transfer;
    });
    const body = editor.getByRole('textbox', { name: 'Description' });
    await body.dispatchEvent('dragover', { dataTransfer: dropped });
    await body.dispatchEvent('drop', { dataTransfer: dropped });
    await expect(files.getByRole('listitem')).toHaveCount(3);

    // So does pasting a screenshot, but not rich text that carries a picture of itself.
    const paste = (rich: boolean) =>
      editor.getByRole('textbox', { name: 'Task name' }).evaluate((field, html) => {
        const data = new DataTransfer();
        if (html) data.setData('text/html', '<p>Water weekly</p>');
        data.items.add(new File(['png'], 'image.png', { type: 'image/png' }));
        field.dispatchEvent(
          new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
        );
      }, rich);
    await paste(true);
    await paste(false);
    await expect(files.getByRole('listitem')).toHaveCount(4);
    await expect(files.getByRole('listitem').last()).toContainText('image.png');

    const download = page.waitForEvent('download');
    await files.getByRole('button', { name: /^plant care\.txt/ }).click();
    expect((await download).suggestedFilename()).toBe('plant care.txt');

    await editor.getByRole('button', { name: 'Remove plant care.txt' }).click();
    await expect
      .poll(() => fileTask('Water the plants')?.attachments?.map((a) => a.name))
      .toEqual(['fern.png', 'repotting.md', 'image.png']);
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('option', { name: /Water the plants/ }).getByTitle('3 attachments'),
    ).toHaveText('3');
  });

  test('the editor adds a field from its button and focuses it; taking the value away brings the button back', async ({
    page,
  }) => {
    await page.getByRole('option', { name: /Water the plants/ }).click();
    await page.keyboard.press('ControlOrMeta+Enter');
    const editor = page.getByRole('dialog', { name: 'Task' });
    const buttons = editor.getByRole('group', { name: 'Add to the task' });
    // The task has a date, so Due date shows as a field, not a button.
    await expect(buttons.getByRole('button')).toHaveText([
      'Repeat',
      'Priority',
      'Labels',
      'Subtasks',
      'Attachments',
    ]);
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
