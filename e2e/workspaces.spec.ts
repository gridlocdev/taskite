import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { DATA, expect, openApp, readTasks, runCommand, test } from './fixtures.ts';
import type { Page } from '@playwright/test';

const switcher = (page: Page) => page.getByRole('button', { name: /^Switch workspace/ });

/** The workspaces in workspaces.json, in order. */
function listed(): { id: string; name: string }[] {
  return JSON.parse(readFileSync(`${DATA}/workspaces.json`, 'utf8')).workspaces;
}

async function newWorkspace(page: Page, name: string): Promise<void> {
  await switcher(page).click();
  await page.getByRole('menuitem', { name: /New Workspace/ }).click();
  const dialog = page.getByRole('dialog', { name: 'New workspace' });
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByRole('button', { name: 'Add Workspace' }).click();
  await expect(switcher(page)).toContainText(name);
}

test.describe('Workspaces', () => {
  test.beforeEach(async ({ seed, page }) => {
    seed('basic');
    await openApp(page);
  });

  test('a new workspace starts empty and keeps its tasks apart', async ({ page }) => {
    await expect(switcher(page)).toContainText('Tasks');
    await newWorkspace(page, 'Games');
    await expect(page).toHaveTitle('Games — Taskite');
    await expect(page.getByRole('button', { name: /^Home/ })).toHaveCount(0);
    await page.keyboard.press('KeyN');
    await page.keyboard.type('Fix the boss fight');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    const games = listed().find((w) => w.name === 'Games')!;
    const file = `${DATA}/workspaces/${games.id}/tasks.json`;
    await expect.poll(() => existsSync(file) && readFileSync(file, 'utf8')).toContain('Fix the boss fight');
    expect(readTasks().tasks.map((t) => t.title)).not.toContain('Fix the boss fight');

    await switcher(page).click();
    await page.getByRole('menuitemradio', { name: 'Tasks' }).click();
    await expect(switcher(page)).toContainText('Tasks');
    await expect(page.getByRole('button', { name: /^Home/ })).toBeVisible();
    await expect(page.getByRole('main')).not.toContainText('Fix the boss fight');
  });

  test('⌃1–⌃9 and ⌘K switch, and the open workspace is remembered', async ({ page }) => {
    await newWorkspace(page, 'Work');
    await page.keyboard.press('Control+Digit1');
    await expect(switcher(page)).toContainText('Tasks');
    await runCommand(page, 'Switch to Work');
    await expect(switcher(page)).toContainText('Work');
    await page.reload();
    await expect(switcher(page)).toContainText('Work');
  });

  test('a workspace is renamed, and a taken name is refused', async ({ page }) => {
    await newWorkspace(page, 'Work');
    await switcher(page).click();
    await page.getByRole('menuitem', { name: /Rename Workspace/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Rename workspace' });
    await dialog.getByLabel('Name').fill('tasks');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toContainText("There's already a workspace called Tasks.");
    await dialog.getByLabel('Name').fill('Day job');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(switcher(page)).toContainText('Day job');
    await expect.poll(() => listed().map((w) => w.name)).toEqual(['Tasks', 'Day job']);
  });

  test('Delete Workspace asks first, and Undo brings it back', async ({ page }) => {
    await newWorkspace(page, 'Scratch');
    await page.keyboard.press('KeyN');
    await page.keyboard.type('Try an idea');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    const scratch = listed().find((w) => w.name === 'Scratch')!;
    await expect.poll(() => existsSync(`${DATA}/workspaces/${scratch.id}/tasks.json`)).toBe(true);
    await switcher(page).click();
    await page.getByRole('menuitem', { name: /Delete Workspace/ }).click();
    await page
      .getByRole('dialog', { name: 'Delete "Scratch"?' })
      .getByRole('button', { name: 'Delete Workspace' })
      .click();
    await expect(page.getByRole('status').getByText('Deleted workspace Scratch.')).toBeVisible();
    await expect(switcher(page)).toContainText('Tasks');
    await expect.poll(() => listed().map((w) => w.name)).toEqual(['Tasks']);
    expect(readdirSync(`${DATA}/workspaces/.deleted`)).toHaveLength(1);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => listed().map((w) => w.name)).toEqual(['Tasks', 'Scratch']);
    await expect(switcher(page)).toContainText('Scratch');
    await expect(page.getByRole('main')).toContainText('Try an idea');
  });

  test('the switcher lists every workspace with its key', async ({ page }) => {
    await newWorkspace(page, 'Games');
    await switcher(page).click();
    await expect(page.getByRole('menu')).toHaveScreenshot('workspace-menu.png');
  });
});

test.describe('Workspaces', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('Browse starts with the workspace switcher', async ({ seed, page }) => {
    seed('basic');
    await openApp(page);
    await page.getByRole('navigation', { name: 'Tabs' }).getByRole('button', { name: 'Browse' }).tap();
    await switcher(page).tap();
    await expect(page.getByRole('menuitem', { name: /New Workspace/ })).toBeVisible();
  });
});
