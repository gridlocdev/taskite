import type { CopyLabel } from '@taskite/core';
import {
  ConflictError,
  FileExistsError,
  putFileProblem,
  type StoredFile,
  type TaskStore,
} from './taskStore.ts';

/**
 * The data half of the desktop app's `window.taskiteNative` bridge (PRD §12). Results come back as values,
 * not thrown errors, because errors lose their type crossing IPC.
 */
export interface NativeData {
  /** The file and its version. `legacy` is true when this is the old "Tasks" app's file (version null). */
  load(): Promise<{ text: string | null; version: string | null; path: string; legacy: boolean }>;
  save(
    text: string,
    expected: string | null,
  ): Promise<{ ok: true; version: string } | { ok: false; reason: 'conflict' }>;
  /** Returns the copy's file name. */
  saveCopy(text: string, label: CopyLabel): Promise<string>;
  /** Writes an attached file once (PRD §4.8); 'exists' when the id already has one. */
  putFile(id: string, bytes: Uint8Array): Promise<'written' | 'exists'>;
  getFile(id: string): Promise<Uint8Array | null>;
  /** Returns how many files it deleted. */
  cleanFiles(): Promise<number>;
}

export class NativeStore implements TaskStore {
  readonly kind = 'native';
  readonly #bridge: NativeData;
  #path = 'tasks.json';
  /** True after loading the old app's file, until the first save writes Taskite's own. */
  legacy = false;

  constructor(bridge: NativeData) {
    this.#bridge = bridge;
  }

  async load(): Promise<StoredFile> {
    const r = await this.#bridge.load();
    this.#path = r.path;
    this.legacy = r.legacy;
    return { text: r.text, version: r.version };
  }

  async save(text: string, expected: string | null): Promise<string> {
    const r = await this.#bridge.save(text, expected);
    if (!r.ok) throw new ConflictError();
    this.legacy = false;
    return r.version;
  }

  saveCopy(text: string, label: CopyLabel): Promise<string> {
    return this.#bridge.saveCopy(text, label);
  }

  location(): string {
    return this.#path;
  }

  async putFile(id: string, bytes: Uint8Array): Promise<void> {
    const problem = putFileProblem(id, bytes);
    if (problem) throw new Error(problem);
    if ((await this.#bridge.putFile(id, bytes)) === 'exists') throw new FileExistsError(id);
  }

  getFile(id: string): Promise<Uint8Array | null> {
    return this.#bridge.getFile(id);
  }

  cleanFiles(): Promise<number> {
    return this.#bridge.cleanFiles();
  }
}
