import type { Files } from '../src/files.ts';

interface Stored {
  data: string | Uint8Array;
  modified: number;
}

/** The iOS file calls on a Map, with a way to age a file and to make the next rename fail. */
export function memoryFiles(): Files & {
  readonly entries: Map<string, Stored>;
  failNextRename: boolean;
} {
  const entries = new Map<string, Stored>();
  const files = {
    entries,
    failNextRename: false,
    exists: (path: string) =>
      Promise.resolve(entries.has(path) || [...entries.keys()].some((k) => k.startsWith(`${path}/`))),
    readText: (path: string) => {
      const e = entries.get(path);
      return Promise.resolve(
        e ? (typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data)) : null,
      );
    },
    readBytes: (path: string) => {
      const e = entries.get(path);
      return Promise.resolve(
        e ? (typeof e.data === 'string' ? new TextEncoder().encode(e.data) : e.data.slice()) : null,
      );
    },
    write: (path: string, data: string | Uint8Array) => {
      entries.set(path, { data: typeof data === 'string' ? data : data.slice(), modified: Date.now() });
      return Promise.resolve();
    },
    rename: (from: string, to: string) => {
      const e = entries.get(from);
      if (files.failNextRename || !e) {
        files.failNextRename = false;
        return Promise.reject(new Error(`Couldn't move ${from}`));
      }
      entries.delete(from);
      entries.set(to, e);
      return Promise.resolve();
    },
    remove: (path: string) => {
      entries.delete(path);
      return Promise.resolve();
    },
    list: (dir: string) =>
      Promise.resolve(
        [...entries]
          .filter(([k]) => k.startsWith(`${dir}/`) && !k.slice(dir.length + 1).includes('/'))
          .map(([k, e]) => ({ name: k.slice(dir.length + 1), modified: e.modified })),
      ),
  };
  return files;
}
