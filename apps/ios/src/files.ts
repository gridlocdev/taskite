/**
 * The file calls the iOS data bridge needs, in the app's Documents folder (PRD §13). `capacitorFiles` is the
 * real one; tests pass an in-memory one.
 */
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';

export interface ListedFile {
  readonly name: string;
  /** Last modified, in ms since the epoch. */
  readonly modified: number;
}

export interface Files {
  exists(path: string): Promise<boolean>;
  /** The file's UTF-8 text, or null when there is no file. */
  readText(path: string): Promise<string | null>;
  /** The file's bytes, or null when there is no file. */
  readBytes(path: string): Promise<Uint8Array | null>;
  /** Writes the file, creating its folder; replaces a file that is there. */
  write(path: string, data: string | Uint8Array): Promise<void>;
  /** Moves a file, replacing one already at `to`. */
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  /** The files (not folders) in a folder; empty when there is no folder. */
  list(dir: string): Promise<ListedFile[]>;
}

const DIR = Directory.Documents;
/** Bytes per String.fromCharCode call when encoding base64, to stay under the argument limit. */
const BASE64_CHUNK = 0x8000;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK)
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK));
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function capacitorFiles(): Files {
  const exists = (path: string) =>
    Filesystem.stat({ path, directory: DIR }).then(
      () => true,
      () => false,
    );
  return {
    exists,
    async readText(path) {
      if (!(await exists(path))) return null;
      const { data } = await Filesystem.readFile({ path, directory: DIR, encoding: Encoding.UTF8 });
      return typeof data === 'string' ? data : await data.text();
    },
    async readBytes(path) {
      if (!(await exists(path))) return null;
      const { data } = await Filesystem.readFile({ path, directory: DIR });
      return typeof data === 'string' ? fromBase64(data) : new Uint8Array(await data.arrayBuffer());
    },
    async write(path, data) {
      const text = typeof data === 'string';
      await Filesystem.writeFile({
        path,
        directory: DIR,
        recursive: true,
        data: text ? data : toBase64(data),
        ...(text ? { encoding: Encoding.UTF8 } : {}),
      });
    },
    async rename(from, to) {
      await Filesystem.rename({ from, to, directory: DIR, toDirectory: DIR });
    },
    async remove(path) {
      await Filesystem.deleteFile({ path, directory: DIR });
    },
    async list(dir) {
      if (!(await exists(dir))) return [];
      const { files } = await Filesystem.readdir({ path: dir, directory: DIR });
      return files.filter((f) => f.type === 'file').map((f) => ({ name: f.name, modified: f.mtime }));
    },
  };
}
