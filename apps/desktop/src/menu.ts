import type { MenuItemConstructorOptions } from 'electron';
import type { NativeMenuItem } from './bridge.ts';

/**
 * The page's menus as an Electron template. Accelerators only show the key and run the command through
 * `send`; plain keys are in the label after a tab, so the page keeps handling them. Pure, so it can be
 * tested without Electron.
 */
export function toTemplate(
  items: readonly NativeMenuItem[],
  send: (command: string) => void,
): MenuItemConstructorOptions[] {
  return items.map((item): MenuItemConstructorOptions => {
    if (item.type === 'separator') return { type: 'separator' };
    if (item.role)
      return {
        role: item.role as MenuItemConstructorOptions['role'],
        ...(item.label ? { label: item.label } : {}),
      };
    const opts: MenuItemConstructorOptions = {
      label: item.label ?? '',
      enabled: item.enabled ?? true,
      ...(item.accelerator ? { accelerator: item.accelerator } : {}),
      ...(item.type === 'checkbox' ? { type: 'checkbox', checked: item.checked ?? false } : {}),
    };
    if (item.submenu) opts.submenu = toTemplate(item.submenu, send);
    else if (item.command) {
      const id = item.command;
      opts.click = () => send(id);
    }
    return opts;
  });
}

/**
 * The platform's standard menus around the page's: the app menu on macOS (with Quit), Quit at the end
 * of File elsewhere, a View block with zoom and full screen, and a Window menu before Help.
 */
export function withStandardMenus(
  template: readonly MenuItemConstructorOptions[],
  platform: NodeJS.Platform,
  devTools = false,
): MenuItemConstructorOptions[] {
  const mac = platform === 'darwin';
  const menus = template.map((menu): MenuItemConstructorOptions => {
    if (!Array.isArray(menu.submenu)) return menu;
    if (!mac && menu.label === 'File')
      return { ...menu, submenu: [...menu.submenu, { type: 'separator' }, { role: 'quit' }] };
    if (menu.label === 'View')
      return {
        ...menu,
        submenu: [
          ...menu.submenu,
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
          ...(devTools ? [{ role: 'toggleDevTools' } as const] : []),
        ],
      };
    return menu;
  });
  const help = menus.findIndex((m) => m.label === 'Help');
  menus.splice(help < 0 ? menus.length : help, 0, windowMenu(mac));
  if (mac) menus.unshift({ role: 'appMenu' });
  return menus;
}

/** On macOS the `windowMenu` role; elsewhere Minimize and Zoom (the role would add a second Ctrl+W). */
function windowMenu(mac: boolean): MenuItemConstructorOptions {
  if (mac) return { role: 'windowMenu' };
  return {
    label: 'Window',
    submenu: [
      { role: 'minimize' },
      {
        label: 'Zoom',
        click: (_item, win) => {
          if (!win) return;
          if (win.isMaximized()) win.unmaximize();
          else win.maximize();
        },
      },
    ],
  };
}
