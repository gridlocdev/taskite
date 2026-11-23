/**
 * Copy (PRD §4.9). The page's `copy` event does the writing, so ⌘C, Edit › Copy in the desktop's menu bar (an
 * Electron role, which takes ⌘C before the page sees it) and the Copy command all land in one place, and it
 * works on a NAS over plain http, where `navigator.clipboard` isn't there. Text fields and selected text keep
 * the browser's own copy.
 */
import { plural } from '@taskite/core';
import { keyFocus } from './App.tsx';
import type { AppController } from './controller.ts';

/** Text the Copy command asked for, which the copy event takes even from ⌘K's search field. */
let asked: { text: string; count: number } | null = null;

function copied(app: AppController, count: number): void {
  app.say(`Copied ${plural(count, 'task')}.`);
}

/** The Copy command: fires the page's copy event, or writes through `navigator.clipboard` if it can't. */
export function copyTasks(app: AppController): void {
  const copy = app.copyText();
  if (!copy) return;
  asked = copy;
  const fired = document.execCommand('copy');
  asked = null;
  if (fired) return;
  navigator.clipboard.writeText(copy.text).then(
    () => copied(app, copy.count),
    () => app.say("Couldn't copy the tasks.", { tone: 'error' }),
  );
}

/** The window's `copy` listener: writes the chosen tasks unless a text field or selected text has the copy. */
export function onCopy(app: AppController, e: ClipboardEvent): void {
  let copy = asked;
  if (!copy) {
    const selection = getSelection();
    if (keyFocus(document.activeElement) === 'text' || (selection && !selection.isCollapsed)) return;
    if (app.blocked()) return;
    copy = app.copyText();
  }
  if (!copy || !e.clipboardData) return;
  e.clipboardData.setData('text/plain', copy.text);
  e.preventDefault();
  copied(app, copy.count);
}
