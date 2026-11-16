import { emptyData, serialize, type AppData } from '@taskite/core';
import { describe, expect, it } from 'vitest';
import { MemoryStore, TaskSession, memoryRecovery, sha256Hex, type SessionOptions } from '../src/index.ts';

const noWait: SessionOptions['wait'] = () => Promise.resolve();
let ids = 0;
const opts = (more: Partial<SessionOptions> = {}): SessionOptions => ({
  wait: noWait,
  newId: () => `id-${++ids}`,
  ...more,
});

function withTask(title: string): AppData {
  const data = emptyData();
  data.tasks.push({
    id: `t-${title}`,
    title,
    description: '',
    projectId: 'inbox',
    parentId: null,
    labels: [],
    priority: 4,
    due: null,
    recurrence: null,
    completed: false,
    completedAt: null,
    createdAt: 1,
    order: 0,
    deletedAt: null,
  });
  return data;
}

describe('a task session', () => {
  it('saves every change, one save at a time', async () => {
    const store = new MemoryStore();
    const { session } = await TaskSession.open(store, opts());
    session.list.addTask({ title: 'one' });
    session.list.addTask({ title: 'two' });
    await session.flush();
    expect(session.status.value).toBe('saved');
    expect(JSON.parse(store.text ?? '').tasks.map((t: { title: string }) => t.title)).toEqual(['one', 'two']);
    expect(session.version).toBe(await sha256Hex(store.text ?? ''));
  });

  it('retries a failed save twice, then waits for Try again', async () => {
    const store = new MemoryStore();
    const waits: number[] = [];
    const recovery = memoryRecovery();
    const { session } = await TaskSession.open(
      store,
      opts({ recovery, wait: (ms) => (waits.push(ms), Promise.resolve()) }),
    );

    store.failSaves = 2;
    session.list.addTask({ title: 'saved on the third try' });
    await session.flush();
    expect(waits).toEqual([300, 600]);
    expect(session.status.value).toBe('saved');

    store.failSaves = 3;
    session.list.addTask({ title: 'not yet' });
    await session.flush();
    expect(session.status.value).toBe('failed');
    expect(recovery.text).toContain('not yet');

    session.retry();
    await session.flush();
    expect(session.status.value).toBe('saved');
    expect(store.text).toContain('not yet');
    expect(recovery.text).toBeNull();
  });

  it('drops an older backup and says so when the browser has no room for the new one', async () => {
    const store = new MemoryStore();
    const recovery = memoryRecovery();
    let full = false;
    const set = recovery.set.bind(recovery);
    recovery.set = (text) => (full ? false : set(text));
    const { session } = await TaskSession.open(store, opts({ recovery }));
    store.failSaves = 3;
    session.list.addTask({ title: 'kept in the backup' });
    await session.flush();
    expect(recovery.text).toContain('kept in the backup');
    expect(session.backedUp.value).toBe(true);

    full = true;
    store.failSaves = 3;
    session.list.addTask({ title: 'no room for this one' });
    await session.flush();
    expect(session.status.value).toBe('failed');
    // The older backup would offer to restore stale data next time, so it goes.
    expect(recovery.text).toBeNull();
    expect(session.backedUp.value).toBe(false);
  });

  it('stops on a conflict and counts the tasks that differ', async () => {
    const store = new MemoryStore(serialize(withTask('a')));
    const { session } = await TaskSession.open(store, opts());
    store.text = serialize(withTask('changed elsewhere'));
    session.list.addTask({ title: 'mine' });
    await session.flush();
    expect(session.status.value).toBe('conflict');
    expect(session.conflict.value).toEqual({ changed: 3 });
    // More changes wait for the choice instead of saving.
    session.list.addTask({ title: 'also mine' });
    await session.flush();
    expect(store.text).toContain('changed elsewhere');
  });

  it('keeps changes made while the conflict dialog is up in the recovery slot', async () => {
    const store = new MemoryStore(serialize(withTask('a')));
    const recovery = memoryRecovery();
    const { session } = await TaskSession.open(store, opts({ recovery }));
    store.text = serialize(withTask('changed elsewhere'));
    session.list.addTask({ title: 'mine' });
    await session.flush();
    session.list.addTask({ title: 'typed during the conflict' });
    expect(recovery.text).toContain('typed during the conflict');
  });

  it('takes one conflict choice at a time, so a second click never acts on a later conflict', async () => {
    // Found by the random session test (FUZZ_SEED=270): Use Theirs, then Keep Mine before it finished.
    const store = new MemoryStore(serialize(withTask('a')));
    const { session } = await TaskSession.open(store, opts());
    store.text = serialize(withTask('theirs'));
    session.list.addTask({ title: 'mine' });
    await session.flush();
    const theirs = session.reload();
    expect(session.choosing.value).toBe(true);
    await session.keepMine();
    await theirs;
    expect(session.list.data.tasks.map((t) => t.title)).toEqual(['theirs']);
    expect(store.text).toBe(serialize(withTask('theirs')));
    expect([session.status.value, session.choosing.value]).toEqual(['saved', false]);
  });

  it('takes a change made elsewhere when nothing is unsaved, as one undo step', async () => {
    const store = new MemoryStore(serialize(withTask('a')));
    const { session } = await TaskSession.open(store, opts());
    expect(await session.refresh()).toBeNull();
    store.text = serialize(withTask('from the CLI'));
    expect(await session.refresh()).toBe(2);
    expect(session.list.data.tasks.map((t) => t.title)).toEqual(['from the CLI']);
    expect(session.status.value).toBe('saved');
    session.list.undo();
    await session.flush();
    expect(store.text).toContain('"a"');
  });

  it('leaves a change made elsewhere for the conflict dialog while this window has unsaved changes', async () => {
    const store = new MemoryStore(serialize(withTask('a')));
    const { session } = await TaskSession.open(store, opts());
    store.text = serialize(withTask('theirs'));
    session.list.addTask({ title: 'mine' });
    expect(await session.refresh()).toBeNull();
    await session.flush();
    expect(session.status.value).toBe('conflict');
  });

  it('refresh drops a read that a save from this window finished during', async () => {
    const store = new MemoryStore(serialize(withTask('a')));
    const { session } = await TaskSession.open(store, opts());
    const stale = await store.load();
    let release = () => {};
    store.load = () => new Promise((r) => (release = () => r(stale)));
    const refreshing = session.refresh();
    session.list.addTask({ title: 'mine' });
    await session.flush();
    release();
    expect(await refreshing).toBeNull();
    expect(session.list.data.tasks.map((t) => t.title)).toEqual(['a', 'mine']);
  });

  it('refuses to open a file from a newer Taskite', async () => {
    const store = new MemoryStore('{"version": 99, "tasks": []}');
    await expect(TaskSession.open(store, opts())).rejects.toThrow(/newer version/);
    expect(store.text).toBe('{"version": 99, "tasks": []}');
  });

  it('Reload takes the file; Keep mine overwrites it; Save a copy keeps mine beside it', async () => {
    const store = new MemoryStore(serialize(withTask('a')));
    const { session } = await TaskSession.open(store, opts());
    const conflict = async () => {
      store.text = serialize(withTask('theirs'));
      session.list.addTask({ title: 'mine' });
      await session.flush();
    };

    await conflict();
    await session.reload();
    expect(session.list.data.tasks.map((t) => t.title)).toEqual(['theirs']);
    expect([session.status.value, session.conflict.value]).toEqual(['saved', null]);

    await conflict();
    await session.keepMine();
    expect(store.text).toContain('mine');
    expect(session.status.value).toBe('saved');

    await conflict();
    const name = await session.saveCopyAndReload();
    expect(store.copies.get(name ?? '')).toContain('mine');
    expect(session.list.data.tasks.map((t) => t.title)).toEqual(['theirs']);
  });

  it('Keep mine never overwrites a file a newer Taskite saved meanwhile', async () => {
    const store = new MemoryStore(serialize(withTask('a')));
    const { session } = await TaskSession.open(store, opts());
    const newer = '{"version": 99, "tasks": [], "more": "from the future"}';
    store.text = newer;
    session.list.addTask({ title: 'mine' });
    await session.flush();
    expect(session.status.value).toBe('conflict');
    await expect(session.keepMine()).rejects.toThrow(/newer version/);
    expect(store.text).toBe(newer);
    expect(session.conflict.value).not.toBeNull();
    await expect(session.reload()).rejects.toThrow(/newer version/);
    expect(store.text).toBe(newer);
  });

  it('keeps an unreadable file as a copy and starts empty', async () => {
    const store = new MemoryStore('{ not json');
    const { session, notice } = await TaskSession.open(store, opts());
    await session.flush();
    const [name] = [...store.copies.keys()];
    expect(name).toMatch(/^tasks\.corrupt-\d+\.json$/);
    expect(store.copies.get(name ?? '')).toBe('{ not json');
    expect(notice).toContain(name);
    expect(JSON.parse(store.text ?? '')).toMatchObject({ version: 1, tasks: [] });
  });

  it('offers back unsaved data from last time', async () => {
    const store = new MemoryStore(serialize(withTask('on disk')));
    const recovery = memoryRecovery();
    recovery.set(serialize(withTask('unsaved')));
    const { session } = await TaskSession.open(store, opts({ recovery }));
    expect(session.recoverable.value).toContain('unsaved');
    session.restoreRecovered();
    await session.flush();
    expect(store.text).toContain('unsaved');
    expect(recovery.text).toBeNull();
  });

  it("keeps last time's unsaved data when opening starts a save of its own", async () => {
    // The file has a task trashed 40 days ago, so opening it empties that from the Trash and saves.
    const onDisk = withTask('on disk');
    onDisk.tasks[0]!.deletedAt = 1;
    const store = new MemoryStore(serialize(onDisk));
    const recovery = memoryRecovery();
    const unsaved = serialize(withTask('unsaved'));
    recovery.set(unsaved);
    const { session } = await TaskSession.open(store, opts({ recovery, now: () => 40 * 86_400_000 }));
    await session.flush();
    expect(session.recoverable.value).toBe(unsaved);
    // Closing now, before choosing, still leaves the unsaved data for next time.
    expect(recovery.text).toBe(unsaved);
    session.discardRecovered();
    expect(recovery.text).toBeNull();
  });

  it("doesn't offer unsaved data that matches the file before the Trash is emptied", async () => {
    const onDisk = withTask('on disk');
    onDisk.tasks[0]!.deletedAt = 1;
    const text = serialize(onDisk);
    const recovery = memoryRecovery();
    recovery.set(text);
    const { session } = await TaskSession.open(
      new MemoryStore(text),
      opts({ recovery, now: () => 40 * 86_400_000 }),
    );
    await session.flush();
    expect(session.recoverable.value).toBeNull();
    expect(recovery.text).toBeNull();
  });

  it('forgets recovery data that matches the file', async () => {
    const text = serialize(withTask('same'));
    const recovery = memoryRecovery();
    recovery.set(text);
    const { session } = await TaskSession.open(new MemoryStore(text), opts({ recovery }));
    expect(session.recoverable.value).toBeNull();
    expect(recovery.text).toBeNull();
  });
});
