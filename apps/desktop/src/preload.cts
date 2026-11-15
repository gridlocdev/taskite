// Sandboxed preload: CommonJS, and it may only require('electron'), so the channel names from
// bridge.ts are repeated here. Keep them in step. It exposes exactly one object, `taskiteNative`.
import type { NativeMenuItem } from './bridge.ts';

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/consistent-type-imports
const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');

const arg = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? '';
const version = arg('taskite-version');
const chrome = arg('taskite-chrome') === 'unified' ? 'unified' : 'native';

contextBridge.exposeInMainWorld('taskiteNative', {
  version,
  chrome,
  load: () => ipcRenderer.invoke('taskite:load'),
  save: (text: string, expected: string | null) => ipcRenderer.invoke('taskite:save', text, expected),
  saveCopy: (text: string, label: 'copy' | 'corrupt') => ipcRenderer.invoke('taskite:save-copy', text, label),
  setMenu: (items: readonly NativeMenuItem[]) => ipcRenderer.send('taskite:set-menu', items),
  onCommand: (fn: (id: string) => void) => ipcRenderer.on('taskite:command', (_e, id: string) => fn(id)),
  onCloseRequested: (fn: () => void) => ipcRenderer.on('taskite:close-requested', () => fn()),
  closeReady: () => ipcRenderer.send('taskite:close-ready'),
  onFullScreen: (fn: (full: boolean) => void) =>
    ipcRenderer.on('taskite:full-screen', (_e, full: boolean) => fn(full)),
});
