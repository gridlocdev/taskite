import { effect } from '@preact/signals';
import { render } from 'preact';
import '@taskite/ui/styles.css';
import { NasClient, TaskSession, localRecovery, localTokenStorage, BrowserStore, every } from '@taskite/ui';
import { App } from './app/App.tsx';
import { buildCommands } from './app/commands.ts';
import { AppController } from './app/controller.ts';
import { TokenPrompt } from './app/Dialogs.tsx';
import { nativeBridge } from './app/native.ts';
import { menuSender, nativeMenu, watchMenuInputs } from './app/nativeMenu.ts';
import { chooseStore } from './app/openStore.ts';
import pkg from '../package.json';

/** How often an open window looks for changes made elsewhere. */
const REFRESH_MS = 15_000;
const root = document.getElementById('app')!;
const native = nativeBridge();
const tokens = localTokenStorage();

function askToken(wrong: boolean): Promise<string | null> {
  return new Promise((resolve) =>
    render(
      <TokenPrompt
        wrong={wrong}
        onDone={(token) => {
          render(null, root);
          resolve(token);
        }}
      />,
      root,
    ),
  );
}

async function start(): Promise<void> {
  const choice = await chooseStore({
    native,
    nas: native ? null : new NasClient('', tokens),
    askToken,
    setToken: (t) => tokens.set(t),
    browserAvailable: BrowserStore.available(),
  });
  const { session, notice } = await TaskSession.open(choice.store, { recovery: localRecovery() });
  const app = new AppController(session, { version: native?.version ?? pkg.version });
  const catalog = buildCommands(app);
  render(<App app={app} catalog={catalog} />, root);
  const startNotice = notice ?? choice.notice;
  if (startNotice) app.say(startNotice, { sticky: true, tone: 'error' });
  effect(() => app.saveStatusChanged(session.status.value));
  // Saves still waiting when the tab closes are kept by the recovery snapshot; ask the browser to wait.
  // Not in the desktop app: Electron shows no prompt for this and the window would just refuse to close.
  // It closes through onCloseRequested below, which saves first.
  if (!native)
    addEventListener('beforeunload', (e) => {
      app.flushDraft();
      if (session.status.peek() !== 'saved') e.preventDefault();
    });
  if (import.meta.env.DEV) Object.assign(globalThis, { taskite: { app, catalog } });

  // Changes made elsewhere (the CLI, another window or device) show up when the window comes back, and
  // every so often while it's in front (PRD §3.4).
  const refresh = () => {
    // Typed text not yet saved waits until the field is left, so a refresh can't pull it out from under the user.
    if (document.hidden || app.hasDraft()) return;
    void session.refresh().then((changed) => {
      if (changed)
        app.sayUndoable(`Updated with ${changed === 1 ? 'a change' : `${changed} changes`} made elsewhere.`);
    });
  };
  addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', refresh);
  every(REFRESH_MS, refresh);

  if (native) {
    const html = document.documentElement.classList;
    html.toggle('tk-unified', native.chrome === 'unified');
    native.onFullScreen((full) => html.toggle('tk-fullscreen', full));
    native.onCommand((id) => {
      // Menu accelerators reach the app before the page; in a text field ⌘Z and ⌘A stay the field's.
      const inText = !!document.activeElement?.closest('input, textarea, select');
      if (inText && !catalog.get(id)?.global) {
        const fallback: Record<string, string> = {
          'edit.undo': 'undo',
          'edit.redo': 'redo',
          'select.all': 'selectAll',
        };
        if (fallback[id]) document.execCommand(fallback[id]);
        return;
      }
      catalog.run(id);
    });
    native.onCloseRequested(() => {
      app.flushDraft();
      void session.flush().finally(() => native.closeReady());
    });
    const menu = menuSender((items) => native.setMenu(items));
    addEventListener('focus', () => {
      menu.forget();
      menu.send(nativeMenu(catalog));
    });
    watchMenuInputs(app, () => menu.send(nativeMenu(catalog)));
  }
}

start().catch((e: unknown) => {
  console.error(e);
  root.textContent = `Taskite couldn't start: ${e instanceof Error ? e.message : String(e)}`;
});
