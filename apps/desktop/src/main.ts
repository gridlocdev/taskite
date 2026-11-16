/**
 * Taskite desktop (PRD §12): one window running the web build from app://taskite/, with tasks.json in
 * the user-data folder. The page reaches the disk only through the preload's `taskiteNative`.
 */
import { app, BrowserWindow, ipcMain, Menu, nativeTheme, net, protocol, screen, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readDataFile, writeCopy, writeDataFile } from '@taskite/node-files';
import { Channels, type NativeMenuItem } from './bridge.ts';
import { editMenuTemplate, toTemplate, withStandardMenus } from './menu.ts';
import { appFile, dataPaths, isAppUrl } from './paths.ts';
import { loadSavedWindow, placeWindow, saveWindow, type SavedWindow } from './windowState.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(here, 'web');
/** How long a closing window waits for the page to finish saving. */
const CLOSE_WAIT_MS = 3000;
const MIN_SIZE = { width: 640, height: 440 };
/**
 * macOS: a unified title bar. The page draws its own toolbar row and the traffic lights sit in the
 * sidebar's top row; the centre of the lights lines up with that row's buttons (PRD §12).
 */
const unified = process.platform === 'darwin';
/** TASKITE_HEADLESS=1: render offscreen and never show a window or Dock icon (automated checks). */
const headless = process.env.TASKITE_HEADLESS === '1';
if (headless) app.dock?.hide();

const paths = dataPaths(process.env, app.getPath('appData'));
if (paths.userData) app.setPath('userData', paths.userData);
const dataFile = path.join(app.getPath('userData'), 'tasks.json');
const windowFile = path.join(app.getPath('userData'), 'window-state.json');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

let win: BrowserWindow | null = null;
let lastWindow: SavedWindow | null = null;
let quitting = false;

/** Only our own page may use the bridge. */
function trusted(e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean {
  return isAppUrl(e.senderFrame?.url);
}

function rememberWindow(w: BrowserWindow): void {
  if (headless || w.isDestroyed() || w.isMinimized()) return;
  const b = w.getNormalBounds();
  lastWindow = { ...b, maximized: w.isMaximized() };
  void saveWindow(windowFile, lastWindow).catch((e: unknown) =>
    console.warn('Could not remember the window position:', e),
  );
}

function createWindow(): BrowserWindow {
  const fallback = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const placed = placeWindow(
    headless ? null : lastWindow,
    screen.getAllDisplays().map((d) => d.workArea),
    { ...fallback, width: Math.min(1100, fallback.width), height: Math.min(760, fallback.height) },
    MIN_SIZE,
  );
  const w = new BrowserWindow({
    x: placed.x,
    y: placed.y,
    width: placed.width,
    height: placed.height,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    title: 'Taskite',
    ...(unified ? { titleBarStyle: 'hidden' as const, trafficLightPosition: { x: 18, y: 20 } } : {}),
    ...(process.platform === 'darwin' ? {} : { icon: path.join(here, '..', 'build', 'icon.png') }),
    show: false,
    // The page's background (--tk-bg), so a slow first paint doesn't flash.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#ffffff',
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      offscreen: headless,
      additionalArguments: [
        `--taskite-version=${app.getVersion()}`,
        `--taskite-chrome=${unified ? 'unified' : 'native'}`,
      ],
    },
  });
  if (!headless)
    w.once('ready-to-show', () => {
      if (placed.maximized) w.maximize();
      w.show();
    });
  let placeTimer: NodeJS.Timeout | null = null;
  const placeChanged = () => {
    if (placeTimer) clearTimeout(placeTimer);
    placeTimer = setTimeout(() => rememberWindow(w), 500);
  };
  for (const ev of ['move', 'resize', 'maximize', 'unmaximize'] as const) w.on(ev as 'move', placeChanged);

  // Closing asks the page to finish saving; it answers with closeReady. A page that doesn't answer in
  // time is closed anyway: unsaved edits are in its recovery snapshot.
  let allowClose = false;
  let closeTimer: NodeJS.Timeout | null = null;
  const closeNow = () => {
    allowClose = true;
    if (closeTimer) clearTimeout(closeTimer);
    if (!w.isDestroyed()) w.close();
  };
  w.on('close', (e) => {
    rememberWindow(w);
    if (allowClose) return;
    e.preventDefault();
    if (closeTimer) return;
    w.webContents.send(Channels.closeRequested);
    closeTimer = setTimeout(closeNow, CLOSE_WAIT_MS);
  });
  w.webContents.ipc.on(Channels.closeReady, (e) => {
    if (trusted(e)) closeNow();
  });
  w.webContents.on('render-process-gone', () => {
    if (closeTimer || quitting) closeNow();
  });
  w.on('closed', () => {
    if (placeTimer) clearTimeout(placeTimer);
    if (win === w) win = null;
  });

  // In full screen the traffic lights hide, so the page drops the room it keeps for them.
  w.on('enter-full-screen', () => w.webContents.send(Channels.fullScreen, true));
  w.on('leave-full-screen', () => w.webContents.send(Channels.fullScreen, false));
  // Electron shows no menu of its own on right-click; text gets the edit menu, the page does the rest.
  w.webContents.on('context-menu', (_e, params) => {
    const template = editMenuTemplate(params, {
      replace: (word) => w.webContents.replaceMisspelling(word),
      learn: (word) => w.webContents.session.addWordToSpellCheckerDictionary(word),
    });
    if (template) Menu.buildFromTemplate(template).popup({ window: w });
  });

  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  w.webContents.on('will-navigate', (e, url) => {
    if (!isAppUrl(url)) e.preventDefault();
  });
  void w.loadURL('app://taskite/index.html');
  return w;
}

function registerIpc(): void {
  ipcMain.handle(Channels.load, async (e) => {
    if (!trusted(e)) throw new Error('Forbidden');
    const own = await readDataFile(dataFile);
    if (own.text !== null || !paths.legacyFile) return { ...own, path: dataFile, legacy: false };
    // The old app's file, read only: the first save writes Taskite's own and leaves it where it is.
    const old = await readDataFile(paths.legacyFile).catch(() => ({ text: null }));
    return old.text === null
      ? { ...own, path: dataFile, legacy: false }
      : { text: old.text, version: null, path: dataFile, legacy: true };
  });
  ipcMain.handle(Channels.save, async (e, text: unknown, expected: unknown) => {
    if (!trusted(e) || typeof text !== 'string' || (expected !== null && typeof expected !== 'string'))
      throw new Error('Forbidden');
    const r = await writeDataFile(dataFile, text, expected);
    return r.ok ? { ok: true, version: r.version } : { ok: false, reason: 'conflict' };
  });
  ipcMain.handle(Channels.saveCopy, async (e, text: unknown, label: unknown) => {
    if (!trusted(e) || typeof text !== 'string' || (label !== 'copy' && label !== 'corrupt'))
      throw new Error('Forbidden');
    return path.basename(await writeCopy(dataFile, text, label));
  });
  ipcMain.on(Channels.setMenu, (e, items: readonly NativeMenuItem[]) => {
    if (!trusted(e) || !Array.isArray(items)) return;
    const send = (id: string) => win?.webContents.send(Channels.command, id);
    const template = withStandardMenus(toTemplate(items, send), process.platform, !app.isPackaged);
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (!win) win = createWindow();
    else {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.on('before-quit', () => {
    quitting = true;
  });
  void app.whenReady().then(async () => {
    protocol.handle('app', (req) => {
      const file = appFile(webRoot, new URL(req.url).pathname);
      return file ? net.fetch(pathToFileURL(file).toString()) : new Response('Forbidden', { status: 403 });
    });
    registerIpc();
    lastWindow = await loadSavedWindow(windowFile);
    win = createWindow();
    app.on('activate', () => {
      if (!win) win = createWindow();
    });
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' || quitting || headless) app.quit();
  });
}
