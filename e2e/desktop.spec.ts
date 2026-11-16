// Desktop smoke test: the built Electron app starts headless on a throwaway data folder and shows the fixture's tasks.
// `just e2e-desktop` builds it first. The temp folder matters: the app must never open the owner's real tasks.
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';
import { expect, test } from './fixtures.ts';

const DESKTOP = fileURLToPath(new URL('../apps/desktop', import.meta.url));
const FIXTURE = fileURLToPath(new URL('./fixtures/basic', import.meta.url));

test.describe('Desktop, browser, NAS and CLI', () => {
  test('the desktop app starts on its own data folder and shows the tasks', async () => {
    const userData = mkdtempSync(path.join(tmpdir(), 'taskite-e2e-'));
    cpSync(FIXTURE, userData, { recursive: true });
    const app = await electron.launch({
      cwd: DESKTOP,
      args: ['.'],
      env: { ...process.env, TASKITE_HEADLESS: '1', TASKITE_USER_DATA: userData },
    });
    try {
      const window = await app.firstWindow();
      await window.getByRole('button', { name: 'Inbox' }).click();
      await expect(window.getByRole('option', { name: /Book dentist appointment/ })).toBeVisible();
    } finally {
      await app.close();
      rmSync(userData, { recursive: true, force: true });
    }
  });
});
