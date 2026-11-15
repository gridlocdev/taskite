import { DATA_FILE, copyFileName, type CopyLabel } from '@taskite/core';
import { ConflictError, sha256Hex, type StoredFile, type TaskStore } from './taskStore.ts';

/** The parts of a File System Access directory handle the store uses (OPFS in the browser, a fake in tests). */
export interface DirHandle {
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileHandleLike>;
}
export interface FileHandleLike {
  getFile(): Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>;
  createWritable(): Promise<{ write(data: Uint8Array): Promise<void>; close(): Promise<void> }>;
}

function isNotFound(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'NotFoundError';
}

/**
 * tasks.json in the origin's private file system (PRD §3.6). Only this tab writes it, but saves still check
 * the version so a second tab can't overwrite the first one's work.
 */
export class BrowserStore implements TaskStore {
  readonly kind = 'browser';
  readonly #root: () => Promise<DirHandle>;
  #queue: Promise<unknown> = Promise.resolve();

  /** `root` defaults to `navigator.storage.getDirectory()`. */
  constructor(root?: () => Promise<DirHandle>) {
    this.#root = root ?? (() => navigator.storage.getDirectory() as Promise<unknown> as Promise<DirHandle>);
  }

  /** Is there a private file system here? (Not in old browsers or some private windows.) */
  static available(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function';
  }

  async #read(name: string): Promise<string | null> {
    try {
      const handle = await (await this.#root()).getFileHandle(name);
      return new TextDecoder().decode(await (await handle.getFile()).arrayBuffer());
    } catch (e) {
      if (isNotFound(e)) return null;
      throw e;
    }
  }

  async #write(name: string, text: string): Promise<void> {
    const handle = await (await this.#root()).getFileHandle(name, { create: true });
    const w = await handle.createWritable();
    await w.write(new TextEncoder().encode(text));
    await w.close();
  }

  #serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.#queue.catch(() => undefined).then(task);
    this.#queue = run;
    return run;
  }

  async load(): Promise<StoredFile> {
    const text = await this.#read(DATA_FILE);
    return { text, version: text === null ? null : await sha256Hex(text) };
  }

  save(text: string, expected: string | null): Promise<string> {
    return this.#serial(async () => {
      const current = await this.load();
      if (current.version !== expected) throw new ConflictError();
      // createWritable writes to a swap file and swaps it in on close(), so a failed write leaves the old file.
      await this.#write(DATA_FILE, text);
      return sha256Hex(text);
    });
  }

  saveCopy(text: string, label: CopyLabel): Promise<string> {
    return this.#serial(async () => {
      const now = new Date();
      let n = 1;
      while ((await this.#read(copyFileName(label, now, n))) !== null) n++;
      const name = copyFileName(label, now, n);
      await this.#write(name, text);
      return name;
    });
  }

  location(): string {
    return "this browser's storage";
  }
}
