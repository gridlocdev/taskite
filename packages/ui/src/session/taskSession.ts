/**
 * One open tasks file: the TaskList, the store it came from, and the saving around it (PRD §3.2–§3.5).
 * Every change saves at once; saves never overlap; failures retry, then wait for "Try again"; a conflict stops
 * saving until the user picks Use Theirs, Keep Mine or Save Mine as a Copy.
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
import { ConflictError, type TaskStore } from '../store/taskStore.ts';

export type SaveStatus = 'saved' | 'saving' | 'failed' | 'conflict';

/** Keeps the data being saved until the save lands (`taskite.unsaved` in localStorage). */
export interface RecoveryStorage {
  get(): string | null;
  set(text: string): void;
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
    set: (text) => guard(() => localStorage.setItem(key, text), undefined),
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
  /** Unsaved data from last time that differs from the file; the UI offers Restore or Discard (PRD §3.5). */
  readonly recoverable = signal<string | null>(null);

  #version: string | null;
  readonly #recovery: RecoveryStorage;
  readonly #wait: (ms: number) => Promise<void>;
  readonly #now: () => number;
  #dirty = false;
  #running: Promise<void> | null = null;

  private constructor(store: TaskStore, data: AppData, version: string | null, opts: SessionOptions) {
    this.store = store;
    this.list = new TaskList(data, opts);
    this.#version = version;
    this.#recovery = opts.recovery ?? memoryRecovery();
    this.#wait = opts.wait ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.#now = opts.now ?? Date.now;
    this.list.onChange((kind) => {
      if (kind !== 'load' && kind !== 'outside') this.#kick();
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
    if (corrupt) session.#kick();
    session.list.purgeExpired(now());
    return { session, notice };
  }

  /** The version of the file this session last read or wrote. */
  get version(): string | null {
    return this.#version;
  }

  /** Resolves once nothing is waiting to be saved (or saving has stopped on a failure or conflict). */
  async flush(): Promise<void> {
    while (this.#running) await this.#running;
  }

  /** "Try again" after a failed save. */
  retry(): void {
    if (this.status.value === 'failed') this.#kick();
  }

  #kick(): void {
    this.#dirty = true;
    if (this.conflict.value) return;
    this.#running ??= this.#run().finally(() => {
      this.#running = null;
    });
  }

  async #run(): Promise<void> {
    while (this.#dirty && !this.conflict.value) {
      this.#dirty = false;
      const text = serialize(this.list.data);
      // While last time's unsaved data waits for Restore or Discard, it keeps the recovery slot.
      const keepsSlot = this.recoverable.value === null;
      if (keepsSlot) this.#recovery.set(text);
      this.status.value = 'saving';
      try {
        this.#version = await this.#saveWithRetry(text);
        if (!this.#dirty && keepsSlot && this.recoverable.value === null) this.#recovery.clear();
        this.status.value = 'saved';
      } catch (e) {
        if (e instanceof ConflictError) {
          this.#dirty = true;
          this.status.value = 'conflict';
          this.conflict.value = { changed: await this.#changedOnDisk() };
        } else {
          console.error(e);
          this.status.value = 'failed';
        }
        return;
      }
    }
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
    if (this.#running || this.#dirty || this.conflict.value || this.status.value !== 'saved') return null;
    let file;
    try {
      file = await this.store.load();
    } catch {
      return null;
    }
    // A change made here while the file was being read wins; its save will see the conflict.
    if (this.#running || this.#dirty || file.version === this.#version || file.text === null) return null;
    const parsed = parseDataFile(file.text, this.#now());
    if (!parsed.ok) return null;
    const changed = countChanged(this.list.data, parsed.data);
    this.#version = file.version;
    this.list.takeOutside(parsed.data);
    return changed;
  }

  /** Conflict → Reload: take the file on disk; this window's unsaved changes are dropped. */
  async reload(): Promise<string | null> {
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
    this.#version = file.version;
    this.#dirty = false;
    this.conflict.value = null;
    this.status.value = 'saved';
    this.#recovery.clear();
    this.list.replace(data);
    if (notice) this.#kick();
    return notice;
  }

  /** Conflict → Keep mine: save this window's data over the file. */
  async keepMine(): Promise<void> {
    const file = await this.store.load();
    // A file from a newer Taskite stays as it is (PRD §3.2); the conflict waits for another choice.
    if (file.text !== null) {
      const parsed = parseDataFile(file.text, this.#now());
      if (!parsed.ok && parsed.reason === 'newer') throw new Error(NEWER_FILE_MESSAGE);
    }
    this.#version = file.version;
    this.conflict.value = null;
    this.#kick();
    await this.flush();
  }

  /** Conflict → Save a copy: keep this window's data as a dated copy, then reload. Returns the copy's name. */
  async saveCopyAndReload(): Promise<string> {
    const name = await this.store.saveCopy(serialize(this.list.data), 'copy');
    await this.reload();
    return name;
  }

  /** Recovery → Restore: put last time's unsaved data back, and save it. */
  restoreRecovered(): void {
    const text = this.recoverable.value;
    this.recoverable.value = null;
    if (text === null) return;
    const parsed = parseDataFile(text, this.#now());
    if (!parsed.ok) return;
    this.list.replace(parsed.data);
    this.#kick();
  }

  /** Recovery → Discard. */
  discardRecovered(): void {
    this.recoverable.value = null;
    this.#recovery.clear();
  }
}
