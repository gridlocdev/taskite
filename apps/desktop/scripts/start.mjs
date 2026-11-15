// Runs the built app in development. On macOS the menu bar and Dock take the app's name from the
// bundle's Info.plist, so `electron .` shows "Electron". This launches a private copy of the bundle
// named Taskite instead; the original stays untouched because pnpm shares it between projects.
import { spawn, execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const electron = require('electron');

/** The Taskite-named bundle's executable, rebuilt only when Electron or the icon changes. */
function namedBundle() {
  const source = resolve(dirname(electron), '../..');
  const icon = join(desktop, 'build/icon.icns');
  const cache = join(desktop, 'node_modules/.cache/taskite-dev');
  const app = join(cache, 'Taskite.app');
  const stamp = join(cache, 'stamp');
  const version = require('electron/package.json').version;
  const wanted = `${version} ${existsSync(icon) ? readFileSync(icon).length : 0}`;
  const binary = join(app, 'Contents/MacOS/Electron');
  if (existsSync(binary) && existsSync(stamp) && readFileSync(stamp, 'utf8') === wanted) return binary;

  rmSync(app, { recursive: true, force: true });
  mkdirSync(cache, { recursive: true });
  cpSync(source, app, { recursive: true, verbatimSymlinks: true });
  const plist = join(app, 'Contents/Info.plist');
  const set = (key, value) => execFileSync('/usr/bin/plutil', ['-replace', key, '-string', value, plist]);
  set('CFBundleName', 'Taskite');
  set('CFBundleDisplayName', 'Taskite');
  set('CFBundleIdentifier', 'dev.gridloc.taskite.dev');
  if (existsSync(icon)) cpSync(icon, join(app, 'Contents/Resources/electron.icns'));
  // Editing the bundle breaks its signature, and Apple silicon won't run an unsigned app.
  execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'ignore' });
  writeFileSync(stamp, wanted);
  return binary;
}

const binary = process.platform === 'darwin' ? namedBundle() : electron;
const child = spawn(binary, [desktop, ...process.argv.slice(2)], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
