import {
  ATTACHMENTS_DIR,
  DATA_FILE,
  MAIN_WORKSPACE_ID,
  WORKSPACES_DIR,
  WORKSPACES_FILE,
  deletedWorkspaceDir,
  isAttachmentId,
  copyFileName,
  unusedAttachmentFiles,
  type CopyLabel,
} from '@taskite/core';
import {
  ConflictError,
  FileExistsError,
  putFileProblem,
  sha256Hex,
  type StoredFile,
  type TaskStore,
} from './taskStore.ts';
import { checkedWorkspace, type WorkspaceStore } from './workspaceStore.ts';

/** The parts of a File System Access directory handle the store uses (OPFS in the browser, a fake in tests). */
export interface DirHandle {
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileHandleLike>;
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<DirHandle>;
  removeEntry(name: string, opts?: { recursive?: boolean }): Promise<void>;
  entries(): AsyncIterable<[string, { readonly kind: 'file' | 'directory' }]>;
}
export interface FileHandleLike {
  getFile(): Promise<{ lastModified: number; arrayBuffer(): Promise<ArrayBuffer> }>;
  createWritable(): Promise<{ write(data: Uint8Array): Promise<void>; close(): Promise<void> }>;
}

/** The part of the Web Locks API the store uses (`navigator.locks`). */
export interface LockManagerLike {
  request<T>(name: string, task: () => Promise<T>): Promise<T>;
}

function defaultLocks(): LockManagerLike | null {
  return typeof navigator !== 'undefined' && navigator.locks ? navigator.locks : null;
}

function opfsRoot(): Promise<DirHandle> {
  return navigator.storage.getDirectory() as Promise<unknown> as Promise<DirHandle>;
}

function isNotFound(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'NotFoundError';
}

/**
 * tasks.json in the origin's private file system (PRD §3.6). Every tab of the app shares it, so a save holds a
 * Web Lock while it checks the version and writes: a second tab can't pass the same check and overwrite it.
 */
export class BrowserStore implements TaskStore {
  readonly kind = 'browser';
  /** The folder holding the file; `create` false rejects with NotFoundError when it isn't there yet. */
  readonly #root: (create: boolean) => Promise<DirHandle>;
  readonly #locks: LockManagerLike | null;
  readonly #lockName: string;
  #queue: Promise<unknown> = Promise.resolve();

  /**
   * `root` defaults to `navigator.storage.getDirectory()`, `locks` to `navigator.locks`. Each workspace's
   * file has its own lock name (PRD §14).
   */
  constructor(
    root?: (create: boolean) => Promise<DirHandle>,
    locks: LockManagerLike | null = defaultLocks(),
    lockName = 'taskite-tasks-file',
  ) {
    this.#root = root ?? opfsRoot;
    this.#locks = locks;
    this.#lockName = lockName;
  }

  /** Is there a private file system here? (Not in old browsers or some private windows.) */
  static available(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function';
  }

  async #read(name: string): Promise<string | null> {
    try {
      const handle = await (await this.#root(false)).getFileHandle(name);
      return new TextDecoder().decode(await (await handle.getFile()).arrayBuffer());
    } catch (e) {
      if (isNotFound(e)) return null;
      throw e;
    }
  }

  async #write(name: string, text: string): Promise<void> {
    const handle = await (await this.#root(true)).getFileHandle(name, { create: true });
    const w = await handle.createWritable();
    await w.write(new TextEncoder().encode(text));
    await w.close();
  }

  /** One operation at a time in this tab, and across tabs while one holds the lock. */
  #serial<T>(task: () => Promise<T>): Promise<T> {
    const locks = this.#locks;
    const locked = locks ? () => locks.request(this.#lockName, task) : task;
    // Runs after the one before it either way; that one's failure went to its own caller.
    const run = this.#queue.then(locked, locked);
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

  /** The attachments folder beside tasks.json (PRD §4.8). */
  async #files(create: boolean): Promise<DirHandle> {
    return (await this.#root(create)).getDirectoryHandle(ATTACHMENTS_DIR, { create });
  }

  putFile(id: string, bytes: Uint8Array): Promise<void> {
    const problem = putFileProblem(id, bytes);
    if (problem) return Promise.reject(new Error(problem));
    return this.#serial(async () => {
      const dir = await this.#files(true);
      const taken = await dir.getFileHandle(id).then(
        () => true,
        (e: unknown) => {
          if (isNotFound(e)) return false;
          throw e;
        },
      );
      if (taken) throw new FileExistsError(id);
      const w = await (await dir.getFileHandle(id, { create: true })).createWritable();
      await w.write(bytes);
      await w.close();
    });
  }

  async getFile(id: string): Promise<Uint8Array | null> {
    try {
      const handle = await (await this.#files(false)).getFileHandle(id);
      return new Uint8Array(await (await handle.getFile()).arrayBuffer());
    } catch (e) {
      if (isNotFound(e)) return null;
      throw e;
    }
  }

  cleanFiles(): Promise<number> {
    return this.#serial(async () => {
      let dir: DirHandle;
      try {
        dir = await this.#files(false);
      } catch (e) {
        if (isNotFound(e)) return 0;
        throw e;
      }
      const listed: { name: string; modified: number }[] = [];
      for await (const [name, entry] of dir.entries()) {
        if (entry.kind !== 'file') continue;
        const file = await (await dir.getFileHandle(name)).getFile();
        listed.push({ name, modified: file.lastModified });
      }
      const unused = unusedAttachmentFiles(await this.#read(DATA_FILE), listed, Date.now());
      for (const name of unused) await dir.removeEntry(name);
      return unused.length;
    });
  }
}

/** Walks `names` down from `dir`; rejects with NotFoundError on a missing folder unless `create`. */
async function descend(dir: DirHandle, names: readonly string[], create: boolean): Promise<DirHandle> {
  let at = dir;
  for (const name of names) at = await at.getDirectoryHandle(name, { create });
  return at;
}

/** Copies every file and folder in `from` into `to`. */
async function copyInto(from: DirHandle, to: DirHandle): Promise<void> {
  for await (const [name, entry] of from.entries()) {
    if (entry.kind === 'directory') {
      await copyInto(
        await from.getDirectoryHandle(name),
        await to.getDirectoryHandle(name, { create: true }),
      );
      continue;
    }
    const bytes = new Uint8Array(await (await (await from.getFileHandle(name)).getFile()).arrayBuffer());
    const w = await (await to.getFileHandle(name, { create: true })).createWritable();
    await w.write(bytes);
    await w.close();
  }
}

function missingAsNull(e: unknown): null {
  if (isNotFound(e)) return null;
  throw e;
}

/** `workspaces.json` at the top of the private file system, with its own lock (PRD §14.1). */
class ListFile {
  readonly #root: () => Promise<DirHandle>;
  readonly #locks: LockManagerLike | null;

  constructor(root: () => Promise<DirHandle>, locks: LockManagerLike | null) {
    this.#root = root;
    this.#locks = locks;
  }

  async load(): Promise<StoredFile> {
    const handle = await (await this.#root()).getFileHandle(WORKSPACES_FILE).catch(missingAsNull);
    if (!handle) return { text: null, version: null };
    const text = new TextDecoder().decode(await (await handle.getFile()).arrayBuffer());
    return { text, version: await sha256Hex(text) };
  }

  save(text: string, expected: string | null): Promise<string> {
    const task = async () => {
      if ((await this.load()).version !== expected) throw new ConflictError();
      const w = await (
        await (await this.#root()).getFileHandle(WORKSPACES_FILE, { create: true })
      ).createWritable();
      await w.write(new TextEncoder().encode(text));
      await w.close();
      return sha256Hex(text);
    };
    return this.#locks ? this.#locks.request('taskite-workspaces-file', task) : task();
  }
}

/** Workspaces in the origin's private file system (PRD §14.4), laid out as on disk. */
export class BrowserWorkspaces implements WorkspaceStore {
  readonly kind = 'browser';
  readonly #root: () => Promise<DirHandle>;
  readonly #locks: LockManagerLike | null;
  readonly #list: ListFile;

  constructor(root: () => Promise<DirHandle> = opfsRoot, locks: LockManagerLike | null = defaultLocks()) {
    this.#root = root;
    this.#locks = locks;
    this.#list = new ListFile(root, locks);
  }

  loadList(): Promise<StoredFile> {
    return this.#list.load();
  }

  saveList(text: string, expected: string | null): Promise<string> {
    return this.#list.save(text, expected);
  }

  open(id: string): BrowserStore {
    checkedWorkspace(id);
    if (id === MAIN_WORKSPACE_ID) return new BrowserStore(() => this.#root(), this.#locks);
    return new BrowserStore(
      async (create) => descend(await this.#root(), [WORKSPACES_DIR, id], create),
      this.#locks,
      `taskite-tasks-file:${id}`,
    );
  }

  /** OPFS can't rename a folder everywhere, so a move is a copy and then a delete. */
  async #move(id: string, stamp: number, back: boolean): Promise<void> {
    if (!isAttachmentId(id)) throw new Error(`Not a workspace that can be deleted: ${id}`);
    const root = await this.#root();
    const live = [WORKSPACES_DIR, id];
    const deleted = deletedWorkspaceDir(id, stamp).split('/');
    const [fromPath, toPath] = back ? [deleted, live] : [live, deleted];
    const from = await descend(root, fromPath, false).catch(missingAsNull);
    // Nothing to move, or something already where it would go: leave both alone.
    if (!from || (await descend(root, toPath, false).catch(missingAsNull))) return;
    await copyInto(from, await descend(root, toPath, true));
    const parent = await descend(root, fromPath.slice(0, -1), false);
    await parent.removeEntry(fromPath[fromPath.length - 1] ?? '', { recursive: true });
  }

  deleteFolder(id: string, stamp: number): Promise<void> {
    return this.#move(id, stamp, false);
  }

  restoreFolder(id: string, stamp: number): Promise<void> {
    return this.#move(id, stamp, true);
  }
}
