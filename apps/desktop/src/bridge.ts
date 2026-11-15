/**
 * The channels between the main process and the preload. The sandboxed preload can't import this file,
 * so it repeats the names: keep the two in step.
 */
export const Channels = {
  load: 'taskite:load',
  save: 'taskite:save',
  saveCopy: 'taskite:save-copy',
  setMenu: 'taskite:set-menu',
  closeReady: 'taskite:close-ready',
  command: 'taskite:command',
  closeRequested: 'taskite:close-requested',
  fullScreen: 'taskite:full-screen',
} as const;

/** One item of the menu bar the page sends, as `NativeMenuItem` in @taskite/ui. */
export interface NativeMenuItem {
  readonly type?: 'separator' | 'checkbox';
  readonly role?: string;
  readonly label?: string;
  readonly command?: string;
  readonly accelerator?: string;
  readonly enabled?: boolean;
  readonly checked?: boolean;
  readonly submenu?: readonly NativeMenuItem[];
}
