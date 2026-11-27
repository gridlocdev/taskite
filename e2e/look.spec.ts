import { expect, openApp, runCommand, test } from './fixtures.ts';

test.describe('Look', () => {
  test.beforeEach(async ({ seed, page }) => {
    seed('basic');
    await openApp(page);
  });

  test('Today looks right in light and dark', async ({ page }) => {
    await expect(page).toHaveScreenshot('today-light.png');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page).toHaveScreenshot('today-dark.png');
  });

  test('the dark theme stays chosen after a reload', async ({ page }) => {
    await runCommand(page, 'Theme: Dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await openApp(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test("focus is the app's own: no browser outline, and every Tab stop shows where it is, light and dark", async ({
    page,
  }) => {
    // What the focused element shows: the browser's ring is outline-style auto; the app's are a solid outline, an
    // inset ring, or (lists and menus) the state classes; a text field shows its caret.
    const look = () =>
      page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return { what: 'body', ok: true, animated: false, browser: false };
        const cs = getComputedStyle(el);
        const ok =
          (cs.outlineStyle === 'solid' && parseFloat(cs.outlineWidth) > 0) ||
          cs.boxShadow !== 'none' ||
          el.matches('.tk-chosen, .tk-active, .tk-cursor, input, textarea, [contenteditable]') ||
          // An empty list keeps the keyboard without a ring around its empty-state text.
          el.matches('[role=listbox]:not(:has([role=option], .tk-add-row))');
        // A ring appears at once: nothing fades or grows it in (reduced motion leaves 0.01 ms, which is nothing).
        const props = cs.transitionProperty.split(',').map((p) => p.trim());
        const durations = cs.transitionDuration.split(',').map((d) => parseFloat(d));
        const animated = props.some(
          (p, i) => /^(all|outline.*|box-shadow)$/.test(p) && (durations[i % durations.length] ?? 0) > 0.001,
        );
        return {
          what: `${el.tagName.toLowerCase()}.${el.className} ${el.getAttribute('aria-label') ?? el.textContent?.slice(0, 20)}`,
          ok,
          animated,
          browser: cs.outlineStyle === 'auto',
        };
      });
    for (const scheme of ['light', 'dark'] as const) {
      // With motion on, so a transition on a ring would show.
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'no-preference' });
      await openApp(page);
      for (let i = 0; i < 30; i++) {
        await page.keyboard.press('Tab');
        const now = await look();
        expect(now.browser, `${scheme}: the browser's outline on ${now.what}`).toBe(false);
        expect(now.ok, `${scheme}: nothing shows focus on ${now.what}`).toBe(true);
        expect(now.animated, `${scheme}: the focus ring on ${now.what} is animated`).toBe(false);
      }
    }
  });

  test('the cursor is drawn from app state, and the keyboard follows it through keys, clicks and dialogs', async ({
    page,
  }) => {
    const rows = page.getByRole('option');
    const cursor = page.locator('.tk-row.tk-cursor');
    // One cursor, and it is where the keyboard is.
    const agrees = async () => {
      await expect(cursor).toHaveCount(1);
      expect(await cursor.evaluate((el) => el === document.activeElement)).toBe(true);
    };
    await page.keyboard.press('ArrowDown');
    await expect(rows.first()).toHaveClass(/tk-cursor/);
    await agrees();
    await page.keyboard.press('ArrowDown');
    await expect(rows.nth(1)).toHaveClass(/tk-cursor/);
    await agrees();
    // A lone chosen row shows its tint; with several chosen the cursor's ring shows on the tint as well.
    expect(await cursor.evaluate((el) => getComputedStyle(el).boxShadow)).toBe('none');
    await page.keyboard.press('Shift+ArrowUp');
    await expect(rows.first()).toHaveClass(/tk-cursor/);
    await agrees();
    expect(await cursor.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe('none');
    // A click moves the state and the keyboard together, and no browser outline shows on the row.
    await rows.nth(1).click();
    await expect(rows.nth(1)).toHaveClass(/tk-cursor/);
    await agrees();
    expect(await cursor.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('auto');
    // A dialog closing gives the keyboard back to the cursor row.
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(page.getByRole('textbox', { name: 'Task name' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(rows.nth(1)).toHaveClass(/tk-cursor/);
    await agrees();
    // So does a command run from the command menu.
    await runCommand(page, 'Go to Today');
    await page.keyboard.press('ArrowUp');
    await agrees();
  });

  test('the keyboard goes to the cursor row when a key moves the cursor from outside the list', async ({
    page,
  }) => {
    await page.getByRole('button', { name: /^Home/ }).click();
    await expect(page.getByRole('button', { name: /^Home/ })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    const cursor = page.locator('.tk-row.tk-cursor');
    await expect(cursor).toBeFocused();
    // So the right-click key acts on the marked task, not the sidebar item.
    await page.keyboard.press('Shift+F10');
    await expect(page.getByRole('menu').getByRole('menuitem', { name: /Rename Task/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(cursor).toBeFocused();
  });

  test('a list that takes the keyboard puts the cursor on its first row, and draws no ring around itself', async ({
    page,
  }) => {
    const list = page.getByRole('listbox');
    const ring = () =>
      list.evaluate((el) => {
        const cs = getComputedStyle(el);
        return cs.outlineStyle !== 'none' || cs.boxShadow !== 'none';
      });
    await runCommand(page, 'Go to Inbox');
    await expect(page.getByRole('option').first()).toHaveClass(/tk-cursor/);
    await expect(page.getByRole('option').first()).toBeFocused();
    expect(await ring()).toBe(false);
    // An empty list keeps the keyboard, with no ring around its empty-state text.
    await runCommand(page, 'Go to Trash');
    await expect(list).toBeFocused();
    expect(await ring()).toBe(false);
  });

  test('with reduced motion, a menu opened from the keyboard takes the keyboard at once, and Esc closes it', async ({
    page,
  }) => {
    // A transition left on visibility, however short, kept a just-shown menu hidden, so it refused the keyboard
    // and Esc went on to clear the choice instead.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.keyboard.press('ArrowDown');
    const row = page.locator('.tk-row.tk-cursor');
    await expect(row).toHaveClass(/tk-chosen/);
    await page.keyboard.press('Shift+F10');
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem').first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(row).toBeFocused();
    await expect(row).toHaveClass(/tk-chosen/);
  });

  test("a menu's active item is state: arrows and the pointer move it, and the keyboard goes with it", async ({
    page,
  }) => {
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Shift+F10');
    const menu = page.getByRole('menu');
    const active = menu.locator('.tk-active');
    const agrees = async () => {
      await expect(active).toHaveCount(1);
      expect(await active.evaluate((el) => el === document.activeElement)).toBe(true);
    };
    const items = menu.getByRole('menuitem');
    await expect(items.first()).toHaveClass(/tk-active/);
    await agrees();
    await page.keyboard.press('ArrowDown');
    await expect(items.nth(1)).toHaveClass(/tk-active/);
    await agrees();
    await page.keyboard.press('End');
    await expect(items.last()).toHaveClass(/tk-active/);
    await agrees();
    await items.nth(2).hover();
    await expect(items.nth(2)).toHaveClass(/tk-active/);
    await agrees();
    await page.keyboard.press('ArrowUp');
    await expect(items.nth(1)).toHaveClass(/tk-active/);
    await agrees();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(page.locator('.tk-row.tk-cursor')).toBeFocused();
  });
});
