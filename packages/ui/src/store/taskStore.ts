/**
 * Where the tasks file lives. Every platform (desktop, browser, NAS, tests) has one adapter with the same
 * contract, checked by `test/storeContract.test.ts`: versions are the SHA-256 of the file text (PRD §3.4).
 */
import { MAX_ATTACHMENT_BYTES, isAttachmentId, type CopyLabel } from '@taskite/core';

export interface StoredFile {
  /** The file's text, or null when there is no file yet. */
  readonly text: string | null;
  /** The version to send with the next save; null when there is no file (the save then creates it). */
  readonly version: string | null;
}

export interface TaskStore {
  readonly kind: 'memory' | 'browser' | 'nas' | 'native';
  load(): Promise<StoredFile>;
  /** Saves `text` if the file still has version `expected`, and returns the new version. Throws ConflictError if not. */
  save(text: string, expected: string | null): Promise<string>;
  /** Keeps `text` as a dated copy next to the file (PRD §3.2, §3.4); returns the copy's name. */
  saveCopy(text: string, label: CopyLabel): Promise<string>;
  /** Where the file is, for people: a path, or a description. */
  location(): string;
  /**
   * Keeps an attached file's bytes under its id, once (PRD §4.8). Rejects an id that isn't a UUID or is taken,
   * and a file over MAX_ATTACHMENT_BYTES; nothing is written then.
   */
  putFile(id: string, bytes: Uint8Array): Promise<void>;
  /** An attached file's bytes, or null when there is no such file. */
  getFile(id: string): Promise<Uint8Array | null>;
  /** Deletes the attached files no task names that are over a day old (`unusedAttachmentFiles`); returns how many. */
  cleanFiles(): Promise<number>;
}

/** Why `putFile` refuses before writing anything, or null when it may go ahead. */
export function putFileProblem(id: string, bytes: Uint8Array): string | null {
  if (!isAttachmentId(id)) return `Not an attachment id: ${id}`;
  if (bytes.length > MAX_ATTACHMENT_BYTES) return 'The file is too large to attach.';
  return null;
}

/** `putFile` was given an id that already has a file. */
export class FileExistsError extends Error {
  constructor(id: string) {
    super(`An attached file ${id} already exists.`);
    this.name = 'FileExistsError';
  }
}

/** The file changed since it was read; nothing was written. */
export class ConflictError extends Error {
  constructor() {
    super('The tasks file changed since it was read.');
    this.name = 'ConflictError';
  }
}

/** SHA-256 of the text's UTF-8 bytes, in hex: the same versions the Node side computes. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
