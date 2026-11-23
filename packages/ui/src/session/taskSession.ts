/**
 * One open tasks file: the TaskList, the store it came from, and the saving around it (PRD §3.2–§3.5).
 * Every change saves at once; saves never overlap; failures retry, then wait for "Try again"; a conflict stops
 * saving until the user picks Use Theirs, Keep Mine or Save Mine as a Copy. What happens when is decided by
 * the table in `saveChart.ts`; this class keeps the state and does the reading and writing.
 */
import { signal } from '@preact/signals';
import {
  NEWER_FILE_MESSAGE,
  TaskList,
  emptyData,
  parseDataFile,
  serialize,
  type AppData,
  type TaskListOptions,
} from '@taskite/core';
import { wait } from '../schedule.ts';
import { step, type Effect, type SaveEvent, type SaveState } from './saveChart.ts';
import { ConflictError, type TaskStore } from '../store/taskStore.ts';

export type SaveStatus = 'saved' | 'saving' | 'failed' | 'conflict';

/** Keeps the data being saved until the save lands (`taskite.unsaved` in localStorage). */
export interface RecoveryStorage {
  get(): string | null;
  /** False when it couldn't keep the text (the browser's storage is full or turned off). */
  set(text: string): boolean;
  clear(): void;
}

export function localRecovery(key = 'taskite.unsaved'): RecoveryStorage {
  const guard = <T>(fn: () => T, fallback: T): T => {
    try {
      return fn();
    } catch {
      return fallback;
    }
  };
  return {
    get: () => guard(() => localStorage.getItem(key), null),
    set: (text) =>
      guard(() => {
        localStorage.setItem(key, text);
        return true;
      }, false),
    clear: () => guard(() => localStorage.removeItem(key), undefined),
  };
}

export function memoryRecovery(): RecoveryStorage & { text: string | null } {
  return {
    text: null,
    get() {
      return this.text;
    },
    set(text) {
      this.text = text;
      return true;
    },
    clear() {
      this.text = null;
    },
  };
}

export interface SessionOptions extends TaskListOptions {
  readonly recovery?: RecoveryStorage;
  /** Waits between retries; tests pass one that doesn't. */
  readonly wait?: (ms: number) => Promise<void>;
}

/** Waits before the 2nd and 3rd tries (PRD §3.3). */
export const RETRY_DELAYS = [300, 600] as const;

export interface Conflict {
  /** How many tasks differ between this window and the file. */
  readonly changed: number;
}

export interface OpenResult {
  readonly session: TaskSession;
  /** A message for the status bar, e.g. that the file couldn't be read. */
  readonly notice: string | null;
}

function countChanged(a: AppData, b: AppData): number {
  const left = new Map(a.tasks.map((t) => [t.id, JSON.stringify(t)]));
  const right = new Map(b.tasks.map((t) => [t.id, JSON.stringify(t)]));
  let n = 0;
  for (const id of new Set([...left.keys(), ...right.keys()])) if (left.get(id) !== right.get(id)) n++;
  return n;
}

export class TaskSession {
  readonly list: TaskList;
  readonly store: TaskStore;
  readonly status = signal<SaveStatus>('saved');
  readonly conflict = signal<Conflict | null>(null);
  /** A conflict choice is reading the file; the dialog's buttons wait for it. */
  readonly choosing = signal(false);
  /** Unsaved data from last time that differs from the file; the UI offers Restore or Discard (PRD §3.5). */
  readonly recoverable = signal<string | null>(null);
  /** False when the last save's data couldn't be kept in the recovery slot (PRD §3.5). */
  readonly backedUp = signal(true);

  #state: SaveState = 'clean';
  #version: string | null;
  readonly #recovery: RecoveryStorage;
  readonly #wait: (ms: number) => Promise<void>;
  readonly #now: () => number;
  /** The write in progress, then the conflict count if it found one; `flush` waits for both. */
  #writing: Promise<void> | null = null;
  #counting: Promise<void> | null = null;
  /** Bumped by `dropRead`, so a read that started before it is ignored when it finishes. */
  #reads = 0;
  /** The file a refresh or Reload read, for `takeFile` and `replaceWithFile`. */
  #read: { version: string | null; data: AppData | null } | null = null;
  /** Tasks the last `takeFile` changed, for `refresh` to return. */
  #taken: number | null = null;
  #cleaned: Promise<number | null> = Promise.resolve(null);

  private constructor(store: TaskStore, data: AppData, version: string | null, opts: SessionOptions) {
    this.store = store;
    this.list = new TaskList(data, opts);
    this.#version = version;
    this.#recovery = opts.recovery ?? memoryRecovery();
    this.#wait = opts.wait ?? wait;
    this.#now = opts.now ?? Date.now;
    this.list.onChange((kind) => {
      if (kind === 'edit' || kind === 'settings') this.#fire('edit');
    });
  }

  /** Loads the store's file and starts a session on it. */
  static async open(store: TaskStore, opts: SessionOptions = {}): Promise<OpenResult> {
    const now = opts.now ?? Date.now;
    const file = await store.load();
    let data = emptyData();
    let notice: string | null = null;
    let corrupt = false;
    if (file.text !== null) {
      const parsed = parseDataFile(file.text, now());
      if (parsed.ok) data = parsed.data;
      else if (parsed.reason === 'newer') throw new Error(NEWER_FILE_MESSAGE);
      else {
        const name = await store.saveCopy(file.text, 'corrupt');
        notice = `Your tasks file couldn't be read. It was kept as ${name}, and Taskite started empty.`;
        corrupt = true;
      }
    }
    // Read last time's unsaved data before anything here can save, and compare it with the file as it was
    // read: opening can save on its own (emptying old Trash, replacing an unreadable file), and that save
    // must not replace it.
    const recovery = opts.recovery ?? memoryRecovery();
    const saved = recovery.get();
    const session = new TaskSession(store, data, file.version, { ...opts, recovery });
    if (saved !== null) {
      if (saved !== serialize(data) && parseDataFile(saved, now()).ok) session.recoverable.value = saved;
      else recovery.clear();
    }
    // Replace the unreadable file now, so the next start doesn't keep another copy.
    if (corrupt) session.#fire('edit');
    session.list.purgeExpired(now());
    // Files no task names, left by Delete Forever on any device, go once they are a day old (PRD §4.8).
    session.#cleaned = store.cleanFiles().catch(() => null);
    return { session, notice };
  }

  /** How many unused attachment files opening removed, or null if that failed; nothing waits on it. */
  get cleaned(): Promise<number | null> {
    return this.#cleaned;
  }

  /** The version of the file this session last read or wrote. */
  get version(): string | null {
    return this.#version;
  }

  /** Where saving stands, as in the table in `saveChart.ts`. */
  get state(): SaveState {
    return this.#state;
  }

  /** Resolves once nothing is waiting to be saved (or saving has stopped on a failure or conflict). */
  async flush(): Promise<void> {
    while (this.#writing || this.#counting) await (this.#writing ?? this.#counting);
  }

  /** "Try again" after a failed save. */
  retry(): void {
    this.#fire('retry');
  }

  /** Reads the state fresh, past what TypeScript remembers from before an `await`. */
  #is(state: SaveState): boolean {
    return this.#state === state;
  }

  #fire(event: SaveEvent): void {
    const { to, effects } = step(this.#state, event);
    this.#state = to;
    const asking = to === 'conflict' || to === 'choosing';
    this.status.value =
      to === 'clean' || to === 'refreshing'
        ? 'saved'
        : to === 'savingDirty'
          ? 'saving'
          : asking
            ? 'conflict'
            : to;
    if (!asking) this.conflict.value = null;
    this.choosing.value = to === 'choosing';
    for (const effect of effects) this.#run(effect);
  }

  #run(effect: Effect): void {
    switch (effect) {
      case 'snapshot': {
        // While last time's unsaved data waits for Restore or Discard, it keeps the recovery slot.
        if (this.recoverable.value !== null) return;
        const kept = this.#recovery.set(serialize(this.list.data));
        // An older backup left in the slot would offer to restore stale data next time.
        if (!kept) this.#recovery.clear();
        this.backedUp.value = kept;
        return;
      }
      case 'clearSnapshot':
        if (this.recoverable.value === null) this.#recovery.clear();
        return;
      case 'writeFile': {
        const writing: Promise<void> = this.#write(serialize(this.list.data)).finally(() => {
          if (this.#writing === writing) this.#writing = null;
        });
        this.#writing = writing;
        return;
      }
      case 'readFile':
        this.#read = null;
        return;
      case 'dropRead':
        this.#reads++;
        return;
      case 'takeFile': {
        const read = this.#read;
        this.#taken = null;
        if (!read?.data || read.version === this.#version) return;
        this.#taken = countChanged(this.list.data, read.data);
        this.#version = read.version;
        this.list.takeOutside(read.data);
        return;
      }
      case 'replaceWithFile': {
        const read = this.#read;
        if (!read) return;
        this.#version = read.version;
        this.list.replace(read.data ?? emptyData());
        return;
      }
      case 'showConflict': {
        const counting: Promise<void> = this.#changedOnDisk().then((changed) => {
          if (this.#state === 'conflict' || this.#state === 'choosing') this.conflict.value = { changed };
          if (this.#counting === counting) this.#counting = null;
        });
        this.#counting = counting;
        return;
      }
    }
  }

  async #write(text: string): Promise<void> {
    try {
      this.#version = await this.#saveWithRetry(text);
    } catch (e) {
      if (e instanceof ConflictError) {
        this.#fire('versionChanged');
      } else {
        console.error(e);
        this.#fire('failed');
      }
      return;
    }
    this.#fire('saved');
  }

  async #saveWithRetry(text: string): Promise<string> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.store.save(text, this.#version);
      } catch (e) {
        const delay = RETRY_DELAYS[attempt];
        if (e instanceof ConflictError || delay === undefined) throw e;
        await this.#wait(delay);
      }
    }
  }

  async #changedOnDisk(): Promise<number> {
    try {
      const file = await this.store.load();
      const parsed = file.text === null ? null : parseDataFile(file.text, this.#now());
      return countChanged(this.list.data, parsed?.ok ? parsed.data : emptyData());
    } catch {
      return 0;
    }
  }

  /**
   * Looks for a change made somewhere else (the CLI, another window, another device) and takes it when this
   * window has nothing unsaved (PRD §3.4). Returns how many tasks it changed, or null when it took nothing.
   * With unsaved changes it leaves the file alone: the next save finds the conflict and asks.
   */
  async refresh(): Promise<number | null> {
    if (this.#state !== 'clean') return null;
    this.#fire('refresh');
    const reads = this.#reads;
    // A file that can't be read or parsed leaves nothing to take; the next refresh tries again.
    const read = await this.store.load().then(
      (file) => {
        const parsed = file.text === null ? null : parseDataFile(file.text, this.#now());
        return { version: file.version, data: parsed?.ok ? parsed.data : null };
      },
      () => ({ version: this.#version, data: null }),
    );
    // A change made here while the file was being read wins: its save will see the conflict.
    if (reads !== this.#reads || !this.#is('refreshing')) return null;
    this.#read = read;
    this.#fire('refreshRead');
    return this.#taken;
  }

  /** Conflict → Use Theirs: take the file on disk; this window's unsaved changes are dropped. */
  async reload(): Promise<string | null> {
    if (!this.#is('conflict')) return null;
    this.#fire('choose');
    return this.#choosing(() => this.#takeTheirs());
  }

  /** Conflict → Keep Mine: save this window's data over the file. */
  async keepMine(): Promise<void> {
    if (!this.#is('conflict')) return;
    this.#fire('choose');
    await this.#choosing(async () => {
      const file = await this.store.load();
      // A file from a newer Taskite stays as it is (PRD §3.2); the conflict waits for another choice.
      if (file.text !== null) {
        const parsed = parseDataFile(file.text, this.#now());
        if (!parsed.ok && parsed.reason === 'newer') throw new Error(NEWER_FILE_MESSAGE);
      }
      this.#version = file.version;
      this.#fire('keepMine');
    });
    await this.flush();
  }

  /**
   * Conflict → Save Mine as a Copy: keep this window's data as a dated copy, then take the file. Returns the
   * copy's name, or null when another choice is already under way.
   */
  async saveCopyAndReload(): Promise<string | null> {
    if (!this.#is('conflict')) return null;
    this.#fire('choose');
    return this.#choosing(async () => {
      const name = await this.store.saveCopy(serialize(this.list.data), 'copy');
      await this.#takeTheirs();
      return name;
    });
  }

  /** Runs a conflict choice; if it fails, the dialog comes back for another. */
  async #choosing<T>(choice: () => Promise<T>): Promise<T> {
    try {
      return await choice();
    } catch (e) {
      this.#fire('chooseFailed');
      throw e;
    }
  }

  async #takeTheirs(): Promise<string | null> {
    const file = await this.store.load();
    let notice: string | null = null;
    let data = emptyData();
    if (file.text !== null) {
      const parsed = parseDataFile(file.text, this.#now());
      if (parsed.ok) data = parsed.data;
      else if (parsed.reason === 'newer') throw new Error(NEWER_FILE_MESSAGE);
      else {
        const name = await this.store.saveCopy(file.text, 'corrupt');
        notice = `Your tasks file couldn't be read. It was kept as ${name}.`;
      }
    }
    this.#read = { version: file.version, data };
    this.#fire('takeTheirs');
    // The unreadable file is replaced with the empty data, as when opening one.
    if (notice) this.#fire('edit');
    return notice;
  }

  /** Recovery → Restore: put last time's unsaved data back, and save it. */
  restoreRecovered(): void {
    const text = this.recoverable.value;
    this.recoverable.value = null;
    if (text === null) return;
    const parsed = parseDataFile(text, this.#now());
    if (!parsed.ok) return;
    this.list.replace(parsed.data);
    this.#fire('edit');
  }

  /** Recovery → Discard. */
  discardRecovered(): void {
    this.recoverable.value = null;
    this.#recovery.clear();
  }
}
