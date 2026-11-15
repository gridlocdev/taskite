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
    expect(store.copies.get(name)).toContain('mine');
    expect(session.list.data.tasks.map((t) => t.title)).toEqual(['theirs']);
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

  it('forgets recovery data that matches the file', async () => {
    const text = serialize(withTask('same'));
    const recovery = memoryRecovery();
    recovery.set(text);
    const { session } = await TaskSession.open(new MemoryStore(text), opts({ recovery }));
    expect(session.recoverable.value).toBeNull();
    expect(recovery.text).toBeNull();
  });
});
