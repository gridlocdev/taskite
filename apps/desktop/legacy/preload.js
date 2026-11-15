// @ts-check
/**
 * Preload script: exposes a tiny, safe API to the page as `window.api`.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  /** @returns {Promise<unknown|null>} */
  load: () => ipcRenderer.invoke('data:load'),
  /** @param {unknown} data @returns {Promise<void>} */
  save: (data) => ipcRenderer.invoke('data:save', data),
  /** @returns {Promise<string>} */
  dataPath: () => ipcRenderer.invoke('data:path'),
  /**
   * Hands the command list to the main process to build the menu bar from.
   * @param {{id: string, title: string, group: string, accelerator: string|null}[]} entries
   */
  setMenu: (entries) => ipcRenderer.send('menu:set', entries),
  /** Runs `callback` with a command id when one is chosen in the menu bar. @param {(id: string) => void} callback */
  onMenuCommand: (callback) => {
    ipcRenderer.on('menu:command', (_event, id) => callback(String(id)));
  },
});
