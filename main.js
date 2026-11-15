// @ts-check
/**
 * Electron main process: creates the window and owns reading/writing the
 * data file. The renderer never touches the file system directly.
 */
const { app, BrowserWindow, ipcMain, Menu, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');

/** @returns {string} Absolute path of the JSON file that stores all tasks. */
function dataFilePath() {
  return path.join(app.getPath('userData'), 'tasks.json');
}

/**
 * The app used to be called "Tasks", which kept its data in a "Tasks" folder.
 * Returns that file's text so a first start after the rename picks it up, or
 * null if there is none. The old file is left where it is.
 * @returns {Promise<string|null>}
 */
async function readOldDataFile() {
  const oldFile = path.join(app.getPath('appData'), 'Tasks', 'tasks.json');
  try {
    return await fs.readFile(oldFile, 'utf8');
  } catch {
    return null;
  }
}

/** @param {string} file */
async function fileExists(file) {
  return fs.access(file).then(() => true, () => false);
}

/**
 * Reads the saved data. Returns null when there is no file yet. A corrupt
 * file is renamed (not deleted) so nothing is lost, then the app starts fresh.
 * @returns {Promise<unknown|null>}
 */
async function loadData() {
  const file = dataFilePath();
  let text;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'ENOENT') throw err;
    text = await readOldDataFile();
    if (text === null) return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    // An unreadable file from the old "Tasks" folder is just ignored there.
    if (!(await fileExists(file))) return null;
    const backup = file.replace(/\.json$/, `.corrupt-${Date.now()}.json`);
    await fs.rename(file, backup);
    console.error(`Data file was unreadable; moved it to ${backup}`);
    return null;
  }
}

/** Serializes writes so two quick saves can't interleave. */
let writeQueue = Promise.resolve();

/**
 * Saves data atomically: write a temp file, then rename over the real one.
 * @param {unknown} data
 * @returns {Promise<void>}
 */
function saveData(data) {
  const file = dataFilePath();
  const tmp = `${file}.tmp`;
  const json = JSON.stringify(data, null, 2);
  writeQueue = writeQueue
    .catch(() => {})
    .then(async () => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(tmp, json, 'utf8');
      await fs.rename(tmp, file);
    });
  return writeQueue;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 720,
    minHeight: 480,
    title: 'Taskite',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Open external links in the user's browser rather than a new app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event) => event.preventDefault());

  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
}

/**
 * @typedef {{id: string, title: string, group: string, accelerator: string|null}} MenuEntry
 * One command from the renderer's command list.
 */

/** A command chosen in the menu bar while no window was open; run once one loads. */
let pendingCommand = /** @type {string|null} */ (null);

/**
 * Sends a command to the focused window, opening one if none is open.
 * @param {string} id
 */
function sendCommand(id) {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  if (!win) {
    pendingCommand = id;
    createWindow();
    return;
  }
  win.show();
  win.webContents.send('menu:command', id);
}

/**
 * Builds the menu bar. Custom items come from the renderer's command list, so
 * the menu, the keyboard and the Keyboard Shortcuts window always agree. The
 * page handles the keys itself; the menu only shows them (registerAccelerator
 * is off), so typing "?" or Space in a text box still works.
 * @param {MenuEntry[]} entries
 */
function buildMenu(entries = []) {
  const isMac = process.platform === 'darwin';
  /**
   * @param {string} group
   * @returns {Electron.MenuItemConstructorOptions[]}
   */
  const items = (group) => entries.filter((e) => e.group === group).map((e) => ({
    label: e.title,
    accelerator: e.accelerator ?? undefined,
    registerAccelerator: false,
    click: () => sendCommand(e.id),
  }));
  /** @type {Electron.MenuItemConstructorOptions} */
  const separator = { type: 'separator' };
  /** @type {Electron.MenuItemConstructorOptions[]} */
  const template = [
    ...(isMac ? [/** @type {Electron.MenuItemConstructorOptions} */ ({ role: 'appMenu' })] : []),
    { label: 'File', submenu: [...items('File'), separator, isMac ? { role: 'close' } : { role: 'quit' }] },
    // Keep the standard Edit roles so cut, copy, paste and undo work in text boxes.
    { role: 'editMenu' },
    ...(entries.length ? [
      { label: 'Task', submenu: items('Task') },
      { label: 'Select', submenu: items('Select') },
      { label: 'Go', submenu: items('Go') },
    ] : []),
    {
      label: 'View',
      submenu: [
        ...items('View'),
        ...(items('View').length ? [separator] : []),
        { role: 'reload' },
        { role: 'toggleDevTools' },
        separator,
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        separator,
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    { role: 'help', submenu: items('Help') },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.on('menu:set', (event, entries) => {
  if (!Array.isArray(entries)) return;
  buildMenu(entries.filter((e) => e && typeof e.id === 'string' && typeof e.title === 'string' && typeof e.group === 'string')
    .map((e) => ({ id: e.id, title: e.title, group: e.group, accelerator: typeof e.accelerator === 'string' ? e.accelerator : null })));
  if (pendingCommand) {
    event.sender.send('menu:command', pendingCommand);
    pendingCommand = null;
  }
});

ipcMain.handle('data:load', () => loadData());
ipcMain.handle('data:save', (_event, data) => saveData(data));
ipcMain.handle('data:path', () => dataFilePath());

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
