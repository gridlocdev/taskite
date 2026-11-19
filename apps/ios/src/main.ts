/**
 * Puts the `taskiteNative` bridge in place on iOS (PRD §13), so the web client keeps its tasks in the app's
 * Documents folder exactly as it does with the desktop app's bridge.
 */
import { App } from '@capacitor/app';
import type { TaskiteNative } from '@taskite/ui';
import pkg from '../package.json';
import { documentsData } from './documents.ts';
import { capacitorFiles } from './files.ts';

const bridge: TaskiteNative = {
  ...documentsData(capacitorFiles()),
  version: pkg.version,
  chrome: 'native',
  // iOS has no menu bar or full screen to report.
  setMenu: () => undefined,
  onCommand: () => undefined,
  onFullScreen: () => undefined,
  // iOS never asks to close; it suspends the app. Leaving the app is when Taskite finishes saving.
  onCloseRequested: (fn) => void App.addListener('pause', fn),
  closeReady: () => undefined,
};

Object.assign(globalThis, { taskiteNative: bridge });
