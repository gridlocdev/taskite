import { MAIN_WORKSPACE_ID, type CopyLabel } from '@taskite/core';
import type { NativeMenuItem } from '../commands/index.ts';
import {
  ConflictError,
  FileExistsError,
  putFileProblem,
  type StoredFile,
  type TaskStore,
} from './taskStore.ts';
import { checkedWorkspace, type WorkspaceStore } from './workspaceStore.ts';

/**
 * The data half of the `window.taskiteNative` bridge (PRD §12, §14.4). Every data and attachment call names
 * the workspace (`main` or a UUID); the native side checks it before it builds a path. Results come back as
 * values, not thrown errors, because errors lose their type crossing IPC.
 */
export interface NativeData {
  /** The file and its version. `legacy` is true when this is the old "Tasks" app's file (version null). */
  load(
    workspace: string,
  ): Promise<{ text: string | null; version: string | null; path: string; legacy: boolean }>;
  save(
    workspace: string,
    text: string,
    expected: string | null,
  ): Promise<{ ok: true; version: string } | { ok: false; reason: 'conflict' }>;
  /** Returns the copy's file name. */
  saveCopy(workspace: string, text: string, label: CopyLabel): Promise<string>;
  /** Writes an attached file once (PRD §4.8); 'exists' when the id already has one. */
  putFile(workspace: string, id: string, bytes: Uint8Array): Promise<'written' | 'exists'>;
  getFile(workspace: string, id: string): Promise<Uint8Array | null>;
  /** Returns how many files it deleted. */
  cleanFiles(workspace: string): Promise<number>;
  /** `workspaces.json` and its version (PRD §14.1). */
  loadWorkspaces(): Promise<{ text: string | null; version: string | null }>;
  saveWorkspaces(
    text: string,
    expected: string | null,
  ): Promise<{ ok: true; version: string } | { ok: false; reason: 'conflict' }>;
  /** Moves a workspace's folder to `workspaces/.deleted/<id>-<stamp>` (PRD §14.3). */
  deleteWorkspace(workspace: string, stamp: number): Promise<void>;
  /** Moves it back. */
  restoreWorkspace(workspace: string, stamp: number): Promise<void>;
}

/**
 * The whole `window.taskiteNative` bridge: the data calls plus the window's. The desktop preload provides it
 * (PRD §12), and so does the iOS app (PRD §13).
 */
export interface TaskiteNative extends NativeData {
  readonly version: string;
  /** 'unified': the window has no title bar and the page draws the toolbar row (macOS). */
  readonly chrome: 'unified' | 'native';
  /** Replaces the menu bar. */
  setMenu(items: readonly NativeMenuItem[]): void;
  /** A menu bar item was chosen. */
  onCommand(fn: (id: string) => void): void;
  /** The window wants to close: finish saving, then call `closeReady`. */
  onCloseRequested(fn: () => void): void;
  closeReady(): void;
  /** The window entered or left full screen. */
  onFullScreen(fn: (full: boolean) => void): void;
}

export class NativeStore implements TaskStore {
  readonly kind = 'native';
  readonly #bridge: NativeData;
  readonly #workspace: string;
  #path = 'tasks.json';
  /** True after loading the old app's file, until the first save writes Taskite's own. */
  legacy = false;

  constructor(bridge: NativeData, workspace: string = MAIN_WORKSPACE_ID) {
    this.#bridge = bridge;
    this.#workspace = workspace;
  }

  async load(): Promise<StoredFile> {
    const r = await this.#bridge.load(this.#workspace);
    this.#path = r.path;
    this.legacy = r.legacy;
    return { text: r.text, version: r.version };
  }

  async save(text: string, expected: string | null): Promise<string> {
    const r = await this.#bridge.save(this.#workspace, text, expected);
    if (!r.ok) throw new ConflictError();
    this.legacy = false;
    return r.version;
  }

  saveCopy(text: string, label: CopyLabel): Promise<string> {
    return this.#bridge.saveCopy(this.#workspace, text, label);
  }

  location(): string {
    return this.#path;
  }

  async putFile(id: string, bytes: Uint8Array): Promise<void> {
    const problem = putFileProblem(id, bytes);
    if (problem) throw new Error(problem);
    if ((await this.#bridge.putFile(this.#workspace, id, bytes)) === 'exists') throw new FileExistsError(id);
  }

  getFile(id: string): Promise<Uint8Array | null> {
    return this.#bridge.getFile(this.#workspace, id);
  }

  cleanFiles(): Promise<number> {
    return this.#bridge.cleanFiles(this.#workspace);
  }
}

/** Workspaces through the native bridge (PRD §14.4). */
export class NativeWorkspaces implements WorkspaceStore {
  readonly kind = 'native';
  readonly #bridge: NativeData;

  constructor(bridge: NativeData) {
    this.#bridge = bridge;
  }

  loadList(): Promise<StoredFile> {
    return this.#bridge.loadWorkspaces();
  }

  async saveList(text: string, expected: string | null): Promise<string> {
    const r = await this.#bridge.saveWorkspaces(text, expected);
    if (!r.ok) throw new ConflictError();
    return r.version;
  }

  open(id: string): NativeStore {
    return new NativeStore(this.#bridge, checkedWorkspace(id));
  }

  deleteFolder(id: string, stamp: number): Promise<void> {
    return this.#bridge.deleteWorkspace(id, stamp);
  }

  restoreFolder(id: string, stamp: number): Promise<void> {
    return this.#bridge.restoreWorkspace(id, stamp);
  }
}
