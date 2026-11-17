import { copyFileName, unusedAttachmentFiles, type CopyLabel } from '@taskite/core';
import {
  ConflictError,
  FileExistsError,
  putFileProblem,
  sha256Hex,
  type StoredFile,
  type TaskStore,
} from './taskStore.ts';

/** A store in memory, for tests and demos. `copies` holds the saved copies by name. */
export class MemoryStore implements TaskStore {
  readonly kind = 'memory';
  text: string | null;
  readonly copies = new Map<string, string>();
  /** Attached files by id, with when each was written (epoch ms). */
  readonly files = new Map<string, { bytes: Uint8Array; modified: number }>();
  /** Set to make the next saves fail, like a full disk. */
  failSaves = 0;

  constructor(text: string | null = null) {
    this.text = text;
  }

  async load(): Promise<StoredFile> {
    return { text: this.text, version: this.text === null ? null : await sha256Hex(this.text) };
  }

  async save(text: string, expected: string | null): Promise<string> {
    if (this.failSaves > 0) {
      this.failSaves--;
      throw new Error('disk full');
    }
    const current = this.text === null ? null : await sha256Hex(this.text);
    if (current !== expected) throw new ConflictError();
    this.text = text;
    return sha256Hex(text);
  }

  saveCopy(text: string, label: CopyLabel): Promise<string> {
    const now = new Date();
    let n = 1;
    while (this.copies.has(copyFileName(label, now, n))) n++;
    const name = copyFileName(label, now, n);
    this.copies.set(name, text);
    return Promise.resolve(name);
  }

  location(): string {
    return 'memory';
  }

  putFile(id: string, bytes: Uint8Array): Promise<void> {
    const problem = putFileProblem(id, bytes);
    if (problem) return Promise.reject(new Error(problem));
    if (this.files.has(id)) return Promise.reject(new FileExistsError(id));
    this.files.set(id, { bytes: bytes.slice(), modified: Date.now() });
    return Promise.resolve();
  }

  getFile(id: string): Promise<Uint8Array | null> {
    return Promise.resolve(this.files.get(id)?.bytes.slice() ?? null);
  }

  cleanFiles(): Promise<number> {
    const listed = [...this.files].map(([name, f]) => ({ name, modified: f.modified }));
    const unused = unusedAttachmentFiles(this.text, listed, Date.now());
    for (const name of unused) this.files.delete(name);
    return Promise.resolve(unused.length);
  }
}
