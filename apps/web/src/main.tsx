import { effect } from '@preact/signals';
import { render } from 'preact';
import '@taskite/ui/styles.css';
import { NasClient, TaskSession, localRecovery, localTokenStorage, BrowserStore } from '@taskite/ui';
import { App } from './app/App.tsx';
import { buildCommands } from './app/commands.ts';
import { AppController } from './app/controller.ts';
import { TokenPrompt } from './app/Dialogs.tsx';
import { nativeBridge } from './app/native.ts';
import { menuSender, nativeMenu, watchMenuInputs } from './app/nativeMenu.ts';
import { chooseStore } from './app/openStore.ts';
import pkg from '../package.json';

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
  addEventListener('beforeunload', (e) => {
    if (session.status.peek() !== 'saved') e.preventDefault();
  });
  if (import.meta.env.DEV) Object.assign(globalThis, { taskite: { app, catalog } });

  if (native) {
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
    native.onCloseRequested(() => void session.flush().finally(() => native.closeReady()));
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
