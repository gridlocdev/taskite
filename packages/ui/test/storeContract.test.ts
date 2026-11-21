import { versionOf } from '@taskite/node-files';
import { createServer } from '@taskite/server';
import { mkdtemp, rm, utimes } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BrowserStore,
  BrowserWorkspaces,
  ConflictError,
  FileExistsError,
  MemoryStore,
  MemoryWorkspaces,
  NasClient,
  NasStore,
  NasWorkspaces,
  NativeStore,
  NativeWorkspaces,
  sha256Hex,
  type DirHandle,
  type LockManagerLike,
  type TaskStore,
  type WorkspaceStore,
} from '../src/index.ts';
import { fakeFolder } from './fakeFileSystem.ts';
import { fakeNativeBridge } from './fakeNativeBridge.ts';

let dir: string;
let base: string;
let stopServer: () => Promise<void>;
let n = 0;

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'taskite-contract-'));
});
afterAll(async () => {
  await stopServer?.();
  await rm(dir, { recursive: true, force: true });
});

/** A store, and a way to make one of its attached files two days old, as `cleanFiles` sees it. */
interface Made {
  readonly store: TaskStore;
  readonly age: (id: string) => Promise<void>;
}

const TWO_DAYS = 2 * 86_400_000;

/** Ages a file on disk by setting its modified time back. */
function ageOnDisk(file: string) {
  return (id: string) => {
    const old = new Date(Date.now() - TWO_DAYS);
    return utimes(path.join(path.dirname(file), 'attachments', id), old, old);
  };
}

async function nasStore(): Promise<TaskStore> {
  return (await nasMade()).store;
}

async function nasMade(): Promise<Made> {
  await stopServer?.();
  const file = path.join(dir, `nas-${++n}`, 'tasks.json');
  const server = createServer({
    file,
    staticDir: null,
    token: null,
    version: '0',
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  stopServer = () => new Promise((r) => server.close(() => r()));
  return {
    store: new NasStore(new NasClient(base, { get: () => null, set: () => undefined })),
    age: ageOnDisk(file),
  };
}

const stores: Record<string, () => Promise<Made>> = {
  memory: () => {
    const store = new MemoryStore();
    return Promise.resolve({
      store,
      age: (id) => {
        store.files.get(id)!.modified -= TWO_DAYS;
        return Promise.resolve();
      },
    });
  },
  browser: () => {
    const { root } = fakeFolder('opfs');
    return Promise.resolve({
      store: new BrowserStore(() => Promise.resolve(root as unknown as DirHandle)),
      age: async (id) => {
        const file = await (await root.getDirectoryHandle('attachments')).getFileHandle(id);
        file.lastModified -= TWO_DAYS;
      },
    });
  },
  nas: nasMade,
  native: () => {
    const file = path.join(dir, `native-${++n}`, 'tasks.json');
    return Promise.resolve({ store: new NativeStore(fakeNativeBridge(file)), age: ageOnDisk(file) });
  },
};

const A = '0b6f1c1e-3a4d-4c8e-9f00-1a2b3c4d5e6f';
const B = '7d3e2f10-5b6c-4d7e-8f90-a1b2c3d4e5f6';
const C = 'c0ffee00-1234-4abc-8def-0123456789ab';
const bytes = (...b: number[]) => new Uint8Array(b);

describe.each(Object.entries(stores))('the %s store', (_name, made) => {
  const make = async () => (await made()).store;
  it('starts with no file, creates one, and reads it back with its version', async () => {
    const store = await make();
    expect(await store.load()).toEqual({ text: null, version: null });
    const v1 = await store.save('{"a":1}', null);
    expect(v1).toBe(versionOf('{"a":1}'));
    expect(v1).toBe(await sha256Hex('{"a":1}'));
    expect(await store.load()).toEqual({ text: '{"a":1}', version: v1 });
  });

  it('saves only from the version it last saw', async () => {
    const store = await make();
    const v1 = await store.save('{"a":1}', null);
    await expect(store.save('{"a":2}', null)).rejects.toBeInstanceOf(ConflictError);
    const v2 = await store.save('{"a":2}', v1);
    await expect(store.save('{"a":3}', v1)).rejects.toBeInstanceOf(ConflictError);
    expect((await store.load()).version).toBe(v2);
  });

  it('keeps copies beside the file without touching it', async () => {
    const store = await make();
    await store.save('{"a":1}', null);
    const a = await store.saveCopy('{"mine":1}', 'copy');
    const b = await store.saveCopy('{"mine":2}', 'copy');
    expect(a).toMatch(/^tasks\.copy-\d{4}-\d\d-\d\d-\d{6}\.json$/);
    expect(b).not.toBe(a);
    expect((await store.load()).text).toBe('{"a":1}');
  });

  it('keeps an attached file once under its id, and refuses ids that are taken or not UUIDs', async () => {
    const store = await make();
    expect(await store.getFile(A)).toBeNull();
    await store.putFile(A, bytes(0, 1, 2, 255));
    expect(await store.getFile(A)).toEqual(bytes(0, 1, 2, 255));
    await expect(store.putFile(A, bytes(9))).rejects.toBeInstanceOf(FileExistsError);
    expect(await store.getFile(A)).toEqual(bytes(0, 1, 2, 255));
    await expect(store.putFile('../tasks.json', bytes(1))).rejects.toThrow('Not an attachment id');
    await store.putFile(B, bytes());
    expect(await store.getFile(B)).toEqual(bytes());
  });

  it('deletes only files no task names that are over a day old, and none without a file it can read', async () => {
    const { store, age } = await made();
    await store.putFile(A, bytes(1));
    await store.putFile(B, bytes(2));
    await store.putFile(C, bytes(3));
    await age(A);
    await age(B);
    // No tasks file yet: nothing can say which files are used.
    expect(await store.cleanFiles()).toBe(0);
    const trashed = {
      id: 't1',
      title: 'Old',
      deletedAt: 1,
      attachments: [{ id: A, name: 'a', size: 1, type: '' }],
    };
    const v1 = await store.save(JSON.stringify({ version: 1, tasks: [trashed] }), null);
    expect(await store.cleanFiles()).toBe(1);
    expect(await store.getFile(A)).toEqual(bytes(1));
    expect(await store.getFile(B)).toBeNull();
    expect(await store.getFile(C)).toEqual(bytes(3));
    // A file from a newer Taskite can't be read either.
    await store.save('{"version":99}', v1);
    await age(C);
    expect(await store.cleanFiles()).toBe(0);
  });
});

const workspaceStores: Record<string, () => Promise<WorkspaceStore>> = {
  memory: () => Promise.resolve(new MemoryWorkspaces()),
  browser: () => {
    const { root } = fakeFolder('opfs');
    return Promise.resolve(new BrowserWorkspaces(() => Promise.resolve(root as unknown as DirHandle), null));
  },
  nas: async () => {
    const { store } = await nasMade();
    return new NasWorkspaces((store as NasStore).client);
  },
  native: () =>
    Promise.resolve(new NativeWorkspaces(fakeNativeBridge(path.join(dir, `ws-${++n}`, 'tasks.json')))),
};

describe.each(Object.entries(workspaceStores))('the %s workspaces (PRD §14)', (_name, make) => {
  it('starts with no list, then saves it only from the version it last saw', async () => {
    const ws = await make();
    expect(await ws.loadList()).toEqual({ text: null, version: null });
    const v1 = await ws.saveList('{"version":1}', null);
    await expect(ws.saveList('{"version":1,"x":1}', null)).rejects.toBeInstanceOf(ConflictError);
    const v2 = await ws.saveList('{"version":1,"x":2}', v1);
    await expect(ws.saveList('{"version":1,"x":3}', v1)).rejects.toBeInstanceOf(ConflictError);
    expect(await ws.loadList()).toEqual({ text: '{"version":1,"x":2}', version: v2 });
  });

  it('keeps each workspace in its own file, with its own attached files', async () => {
    const ws = await make();
    await ws.open('main').save('{"main":1}', null);
    expect(await ws.open(A).load()).toEqual({ text: null, version: null });
    await ws.open(A).save('{"a":1}', null);
    await ws.open(A).putFile(C, bytes(7));
    expect((await ws.open('main').load()).text).toBe('{"main":1}');
    expect((await ws.open(A).load()).text).toBe('{"a":1}');
    expect(await ws.open('main').getFile(C)).toBeNull();
    expect(await ws.open(A).getFile(C)).toEqual(bytes(7));
    expect(await ws.open(B).getFile(C)).toBeNull();
  });

  it('moves a deleted workspace aside and puts it back on Undo', async () => {
    const ws = await make();
    await ws.open(A).save('{"a":1}', null);
    await ws.open(A).putFile(C, bytes(7));
    await ws.deleteFolder(A, 1700);
    expect(await ws.open(A).load()).toEqual({ text: null, version: null });
    // Reading the deleted workspace made nothing that would stop Undo.
    await ws.restoreFolder(A, 1700);
    expect((await ws.open(A).load()).text).toBe('{"a":1}');
    expect(await ws.open(A).getFile(C)).toEqual(bytes(7));
    // A workspace never saved has no folder, and deleting it is fine.
    await ws.deleteFolder(B, 1700);
  });

  it('refuses ids that are not main or a UUID, and never deletes main', async () => {
    const ws = await make();
    for (const id of ['../x', 'Main', A.toUpperCase(), 'workspaces', ''])
      expect(() => ws.open(id)).toThrow(/Not a workspace id/);
    await expect(ws.deleteFolder('main', 1)).rejects.toThrow();
    await expect(ws.deleteFolder('../x', 1)).rejects.toThrow();
  });
});

/** Web Locks in one page: each name runs its holders one after another. */
function fakeLocks(): LockManagerLike {
  const held = new Map<string, Promise<unknown>>();
  return {
    request<T>(name: string, task: () => Promise<T>): Promise<T> {
      const run = (held.get(name) ?? Promise.resolve()).catch(() => undefined).then(task);
      held.set(name, run);
      return run;
    },
  };
}

describe('the browser store in two tabs', () => {
  it('lets only one of two tabs that saw the same version save', async () => {
    const { root } = fakeFolder('opfs');
    const locks = fakeLocks();
    const tab = () => new BrowserStore(() => Promise.resolve(root as unknown as DirHandle), locks);
    const v1 = await tab().save('{"a":1}', null);
    const results = await Promise.allSettled([tab().save('{"tab":1}', v1), tab().save('{"tab":2}', v1)]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
    expect((await tab().load()).text).toBe('{"tab":1}');
  });
});

describe('the native store', () => {
  it("reads the old app's file when Taskite has none, and the first save writes its own", async () => {
    const own = path.join(dir, 'fresh', 'Taskite', 'tasks.json');
    const old = path.join(dir, 'fresh', 'Tasks', 'tasks.json');
    const oldStore = new NativeStore(fakeNativeBridge(old));
    await oldStore.save('{"old":true}', null);
    const store = new NativeStore(fakeNativeBridge(own, old));
    expect(await store.load()).toEqual({ text: '{"old":true}', version: null });
    expect(store.legacy).toBe(true);
    await store.save('{"new":true}', null);
    expect(store.legacy).toBe(false);
    expect(await store.load()).toEqual({ text: '{"new":true}', version: versionOf('{"new":true}') });
    expect((await oldStore.load()).text).toBe('{"old":true}');
  });
});

describe('the NAS client', () => {
  it('reads an unchanged file without downloading it again', async () => {
    const store = await nasStore();
    const v1 = await store.save('{"a":1}', null);
    const fetched: number[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = async (...args: Parameters<typeof fetch>) => {
      const res = await real(...args);
      if (String(args[0]).endsWith('/api/data')) fetched.push(res.status);
      return res;
    };
    try {
      expect(await store.load()).toEqual({ text: '{"a":1}', version: v1 });
      expect(fetched).toEqual([304]);
    } finally {
      globalThis.fetch = real;
    }
    // A store that has seen nothing downloads it.
    const fresh = new NasStore(new NasClient(base, { get: () => null, set: () => undefined }));
    expect((await fresh.load()).text).toBe('{"a":1}');
  });

  it('gives up on a server that never answers, so saving can report the failure', async () => {
    const { createServer: createHttp } = await import('node:http');
    const hung = createHttp(() => undefined);
    await new Promise<void>((r) => hung.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(hung.address() as AddressInfo).port}`;
    const store = new NasStore(new NasClient(url, { get: () => null, set: () => undefined }, 50));
    await expect(store.load()).rejects.toThrow();
    hung.closeAllConnections();
    await new Promise((r) => hung.close(r));
  });
});
