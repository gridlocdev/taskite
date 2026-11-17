import { createHash } from 'node:crypto';
import { emptyData, parseDataFile, serialize, type CopyLabel } from '@taskite/core';
import { describe, expect, it } from 'vitest';
import { ConflictError, TaskSession, memoryRecovery, type StoredFile, type TaskStore } from '../src/index.ts';
import { RANDOM_TIMEOUT, runRandomOps, type Op } from './support/randomOps.ts';

/** A store whose reads and writes wait until the test lets each one through, in any order. */
class GatedStore implements TaskStore {
  readonly kind = 'memory';
  text: string | null = null;
  /** Every text the file has held, in order, by version. */
  readonly history = new Map<string, { text: string; seq: number }>();
  /** `early` answers a read with the file as it was when the read started, as a slow disk or network can. */
  readonly waiting: { kind: 'load' | 'save'; let(fail: boolean, early: boolean): void }[] = [];

  version(text: string | null): string | null {
    if (text === null) return null;
    const version = createHash('sha256').update(text).digest('hex');
    if (!this.history.has(version)) this.history.set(version, { text, seq: this.history.size });
    return version;
  }

  write(text: string): void {
    this.text = text;
    this.version(text);
  }

  load(): Promise<StoredFile> {
    const before = this.text;
    return new Promise((resolve, reject) => {
      this.waiting.push({
        kind: 'load',
        let: (fail, early) => {
          if (fail) return reject(new Error('offline'));
          const text = early ? before : this.text;
          resolve({ text, version: this.version(text) });
        },
      });
    });
  }

  save(text: string, expected: string | null): Promise<string> {
    return new Promise((resolve, reject) => {
      this.waiting.push({
        kind: 'save',
        let: (fail) => {
          if (fail) return reject(new Error('disk full'));
          if (this.version(this.text) !== expected) return reject(new ConflictError());
          this.write(text);
          resolve(this.version(text) ?? '');
        },
      });
    });
  }

  saveCopy(_text: string, label: CopyLabel): Promise<string> {
    return Promise.resolve(label);
  }

  location(): string {
    return 'gated';
  }

  // Attached files never pass through the save session.
  putFile(): Promise<void> {
    return Promise.reject(new Error('not used'));
  }

  getFile(): Promise<Uint8Array | null> {
    return Promise.resolve(null);
  }

  cleanFiles(): Promise<number> {
    return Promise.resolve(0);
  }
}

interface World {
  store: GatedStore;
  session: TaskSession;
  errors: unknown[];
  /** The newest file version this window has had; it never goes back to an older one. */
  seq: number;
}

/** Lets every promise that can move on do so. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

function track(w: World, promise: Promise<unknown>): void {
  // A choice that can't read the file fails, and the dialog says so; anything else is a bug.
  promise.catch((e: unknown) => {
    if (!(e instanceof Error && e.message === 'offline')) w.errors.push(e);
  });
}

const ops: Op<World>[] = [
  {
    name: 'edit',
    weight: 3,
    run: async (w, r) => {
      w.session.list.addTask({ title: r.text(4) });
      await settle();
    },
  },
  {
    name: 'refresh',
    run: async (w) => {
      track(w, w.session.refresh());
      await settle();
    },
  },
  {
    name: 'outsideWrite',
    weight: 0.5,
    run: async (w, r) => {
      const parsed = w.store.text === null ? null : parseDataFile(w.store.text, 0);
      const data = parsed?.ok ? parsed.data : emptyData();
      data.tasks.push({
        ...structuredClone(data.tasks[0] ?? sample()),
        id: `out${w.store.history.size}`,
        title: r.text(4),
      });
      w.store.write(serialize(data));
      await settle();
    },
  },
  {
    name: 'letThrough',
    weight: 4,
    when: (w) => w.store.waiting.length > 0,
    run: async (w, r) => {
      const [call] = w.store.waiting.splice(r.int(w.store.waiting.length), 1);
      const fail = r.chance(0.15);
      call?.let(fail, r.chance(0.5));
      await settle();
      return `${call?.kind}${fail ? ' (fails)' : ''}`;
    },
  },
  {
    name: 'retry',
    weight: 0.5,
    run: async (w) => {
      w.session.retry();
      await settle();
    },
  },
  {
    name: 'keepMine',
    weight: 0.5,
    when: (w) => w.session.conflict.value !== null,
    run: async (w) => {
      track(w, w.session.keepMine());
      await settle();
    },
  },
  {
    name: 'saveCopy',
    weight: 0.3,
    when: (w) => w.session.conflict.value !== null,
    run: async (w) => {
      track(w, w.session.saveCopyAndReload());
      await settle();
    },
  },
  {
    name: 'reload',
    weight: 0.5,
    when: (w) => w.session.conflict.value !== null,
    run: async (w) => {
      track(w, w.session.reload());
      await settle();
    },
  },
];

function sample() {
  return {
    id: 'x',
    title: 'x',
    description: '',
    projectId: 'inbox',
    parentId: null,
    labels: [],
    priority: 4 as const,
    due: null,
    recurrence: null,
    completed: false,
    completedAt: null,
    createdAt: 0,
    order: 0,
    deletedAt: null,
  };
}

describe('a task session', () => {
  it(
    'random edits, refreshes, outside writes and slow or failing saves never lose a change or go back to an older file',
    async () => {
      let n = 0;
      await runRandomOps<World>({
        steps: 120,
        setup: async () => {
          const store = new GatedStore();
          const opening = TaskSession.open(store, {
            recovery: memoryRecovery(),
            wait: () => Promise.resolve(),
            now: () => 0,
            newId: () => `id${++n}`,
          });
          await settle();
          store.waiting.shift()?.let(false, false);
          const { session } = await opening;
          return { store, session, errors: [], seq: -1 };
        },
        ops,
        check: (w) => {
          expect(w.errors, 'no conflict choice or refresh throws').toEqual([]);
          expect(
            w.store.waiting.filter((c) => c.kind === 'save').length,
            'never two writes at once',
          ).toBeLessThanOrEqual(1);
          const version = w.session.version;
          if (version === null) return;
          const held = w.store.history.get(version);
          expect(held, 'the window holds a version the file had').toBeDefined();
          if (!held) return;
          expect(held.seq, 'the window never goes back to an older file').toBeGreaterThanOrEqual(w.seq);
          w.seq = held.seq;
          if (w.session.state === 'clean')
            expect(serialize(w.session.list.data), 'saved means the file has every change').toBe(held.text);
        },
      });
    },
    RANDOM_TIMEOUT,
  );
});
