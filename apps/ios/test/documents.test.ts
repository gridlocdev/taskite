// The store contract (packages/ui/test/storeContract.test.ts) run against the iOS bridge, plus what only iOS
// does. A change to the contract belongs in both files.
import { ConflictError, FileExistsError, NativeStore, NativeWorkspaces, sha256Hex } from '@taskite/ui';
import { describe, expect, it } from 'vitest';
import { DATA_LOCATION, documentsData } from '../src/documents.ts';
import { memoryFiles } from './memoryFiles.ts';

const TWO_DAYS = 2 * 86_400_000;
const A = '0b6f1c1e-3a4d-4c8e-9f00-1a2b3c4d5e6f';
const B = '7d3e2f10-5b6c-4d7e-8f90-a1b2c3d4e5f6';
const C = 'c0ffee00-1234-4abc-8def-0123456789ab';
const bytes = (...b: number[]) => new Uint8Array(b);

function made() {
  const files = memoryFiles();
  return {
    files,
    store: new NativeStore(documentsData(files)),
    age: (id: string) => {
      files.entries.get(`attachments/${id}`)!.modified -= TWO_DAYS;
    },
  };
}

describe('the iOS store', () => {
  it('starts with no file, creates one, and reads it back with its version', async () => {
    const { store } = made();
    expect(await store.load()).toEqual({ text: null, version: null });
    const v1 = await store.save('{"a":1}', null);
    expect(v1).toBe(await sha256Hex('{"a":1}'));
    expect(await store.load()).toEqual({ text: '{"a":1}', version: v1 });
    expect(store.location()).toBe(DATA_LOCATION);
  });

  it('saves only from the version it last saw', async () => {
    const { store } = made();
    const v1 = await store.save('{"a":1}', null);
    await expect(store.save('{"a":2}', null)).rejects.toBeInstanceOf(ConflictError);
    const v2 = await store.save('{"a":2}', v1);
    await expect(store.save('{"a":3}', v1)).rejects.toBeInstanceOf(ConflictError);
    expect((await store.load()).version).toBe(v2);
  });

  it('keeps copies beside the file without touching it', async () => {
    const { store } = made();
    await store.save('{"a":1}', null);
    const a = await store.saveCopy('{"mine":1}', 'copy');
    const b = await store.saveCopy('{"mine":2}', 'copy');
    expect(a).toMatch(/^tasks\.copy-\d{4}-\d\d-\d\d-\d{6}\.json$/);
    expect(b).not.toBe(a);
    expect((await store.load()).text).toBe('{"a":1}');
  });

  it('keeps an attached file once under its id, and refuses ids that are taken or not UUIDs', async () => {
    const { store } = made();
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
    const { store, age } = made();
    await store.putFile(A, bytes(1));
    await store.putFile(B, bytes(2));
    await store.putFile(C, bytes(3));
    age(A);
    age(B);
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
    await store.save('{"version":99}', v1);
    age(C);
    expect(await store.cleanFiles()).toBe(0);
  });

  it('leaves the old file and no temp file when a save fails partway', async () => {
    const { files, store } = made();
    const v1 = await store.save('{"a":1}', null);
    files.failNextRename = true;
    await expect(store.save('{"a":2}', v1)).rejects.toThrow();
    expect([...files.entries.keys()]).toEqual(['tasks.json']);
    expect(await store.load()).toEqual({ text: '{"a":1}', version: v1 });
  });
});

describe('workspaces on iOS (PRD §14)', () => {
  it('saves the list with versions, and keeps each workspace in its own folder', async () => {
    const files = memoryFiles();
    const ws = new NativeWorkspaces(documentsData(files));
    expect(await ws.loadList()).toEqual({ text: null, version: null });
    const v1 = await ws.saveList('{"version":1}', null);
    await expect(ws.saveList('{"version":1}', null)).rejects.toBeInstanceOf(ConflictError);
    expect((await ws.loadList()).version).toBe(v1);
    await ws.open(A).save('{"a":1}', null);
    await ws.open(A).putFile(C, bytes(7));
    expect(files.entries.has(`workspaces/${A}/tasks.json`)).toBe(true);
    expect(files.entries.has(`workspaces/${A}/attachments/${C}`)).toBe(true);
    expect((await ws.open('main').load()).text).toBeNull();
  });

  it('moves a deleted workspace aside and back', async () => {
    const files = memoryFiles();
    const ws = new NativeWorkspaces(documentsData(files));
    await ws.open(A).save('{"a":1}', null);
    await ws.deleteFolder(A, 1700);
    expect(files.entries.has(`workspaces/.deleted/${A}-1700/tasks.json`)).toBe(true);
    expect((await ws.open(A).load()).text).toBeNull();
    await ws.restoreFolder(A, 1700);
    expect((await ws.open(A).load()).text).toBe('{"a":1}');
    await expect(ws.deleteFolder('main', 1)).rejects.toThrow();
    expect(() => ws.open('../x')).toThrow();
  });
});
