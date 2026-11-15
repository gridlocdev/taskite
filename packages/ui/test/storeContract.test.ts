import { versionOf } from '@taskite/node-files';
import { createServer } from '@taskite/server';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BrowserStore,
  ConflictError,
  MemoryStore,
  NasClient,
  NasStore,
  NativeStore,
  sha256Hex,
  type DirHandle,
  type LockManagerLike,
  type TaskStore,
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

async function nasStore(): Promise<TaskStore> {
  await stopServer?.();
  const server = createServer({
    file: path.join(dir, `nas-${++n}`, 'tasks.json'),
    staticDir: null,
    token: null,
    version: '0',
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  stopServer = () => new Promise((r) => server.close(() => r()));
  return new NasStore(new NasClient(base, { get: () => null, set: () => undefined }));
}

const stores: Record<string, () => Promise<TaskStore>> = {
  memory: () => Promise.resolve(new MemoryStore()),
  browser: () => {
    const { root } = fakeFolder('opfs');
    return Promise.resolve(new BrowserStore(() => Promise.resolve(root as unknown as DirHandle)));
  },
  nas: nasStore,
  native: () =>
    Promise.resolve(new NativeStore(fakeNativeBridge(path.join(dir, `native-${++n}`, 'tasks.json')))),
};

describe.each(Object.entries(stores))('the %s store', (_name, make) => {
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
