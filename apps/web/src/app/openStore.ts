/** Which store the app keeps tasks in (PRD §3): the desktop file, the NAS server, or the browser. */
import {
  AuthError,
  BrowserStore,
  MemoryStore,
  NasStore,
  NativeStore,
  type NasClient,
  type NativeData,
  type TaskStore,
} from '@taskite/ui';

export interface StoreChoice {
  readonly store: TaskStore;
  /** For the status bar: why the tasks aren't kept where they usually are. */
  readonly notice: string | null;
}

export interface StoreDeps {
  readonly native: NativeData | null;
  /** Null when this build doesn't look for a server. */
  readonly nas: NasClient | null;
  /** Asks for the server's access token; null when the user gives up. `wrong` after a refused one. */
  readonly askToken: (wrong: boolean) => Promise<string | null>;
  readonly setToken: (token: string | null) => void;
  readonly browserAvailable: boolean;
}

/**
 * The desktop bridge when there is one, else the Taskite server this page came from (asking for its
 * token until one works), else the browser's private storage, else memory only.
 */
export async function chooseStore(deps: StoreDeps): Promise<StoreChoice> {
  if (deps.native) return { store: new NativeStore(deps.native), notice: null };
  if (deps.nas && (await deps.nas.info())) {
    const store = new NasStore(deps.nas);
    let wrong = false;
    for (;;) {
      try {
        await store.load();
        return { store, notice: null };
      } catch (e) {
        if (!(e instanceof AuthError)) throw e;
        const token = await deps.askToken(wrong);
        if (token === null) break;
        deps.setToken(token);
        wrong = true;
      }
    }
    return {
      store: new MemoryStore(),
      notice: 'Not signed in to the server, so nothing you add here will be kept. Reload to try again.',
    };
  }
  if (deps.browserAvailable) return { store: new BrowserStore(), notice: null };
  return {
    store: new MemoryStore(),
    notice: "This browser can't keep your tasks, so they'll be gone when you close the page.",
  };
}
