// Desktop smoke test: the built Electron app starts headless (no window, Dock icon or system dialog) on a throwaway
// data folder and shows the fixture's tasks. `just e2e-desktop` builds it first. The temp folder matters: the app
// must never open the owner's real tasks.
import { cpSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';
import { expect, test, watchErrors } from './fixtures.ts';

const DESKTOP = fileURLToPath(new URL('../apps/desktop', import.meta.url));
const FIXTURE = fileURLToPath(new URL('./fixtures/basic', import.meta.url));

test.describe('Desktop, browser, NAS and CLI', () => {
  test('the desktop app starts on its own data folder and shows the tasks', async () => {
    // realpath: macOS's temp folder is behind a symlink, and the app reports the real path.
    const userData = realpathSync(mkdtempSync(path.join(tmpdir(), 'taskite-e2e-')));
    cpSync(FIXTURE, userData, { recursive: true });
    const app = await electron.launch({
      cwd: DESKTOP,
      // The main script by name (the built one package.json points at), so nothing else is read as an argument.
      args: ['out/main.js'],
      env: { ...process.env, TASKITE_HEADLESS: '1', TASKITE_USER_DATA: userData },
    });
    try {
      expect(await app.evaluate(({ app }) => app.getPath('userData')), 'the throwaway data folder').toBe(
        userData,
      );
      const window = await app.firstWindow();
      const errors = watchErrors(window);
      await window.getByRole('button', { name: 'Inbox' }).click();
      await expect(window.getByRole('option', { name: /Book dentist appointment/ })).toBeVisible();
      expect(
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.isVisible())),
        'no window shows on the screen',
      ).toBe(false);
      expect(errors).toEqual([]);
    } finally {
      await app.close();
      rmSync(userData, { recursive: true, force: true });
    }
  });
});
