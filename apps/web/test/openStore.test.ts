import { describe, expect, it } from 'vitest';
import { AuthError, MemoryStore, NasClient, type NasInfo, type NativeData } from '@taskite/ui';
import { chooseStore } from '../src/app/openStore.ts';

class FakeNas extends NasClient {
  tries = 0;
  readonly answer: NasInfo | null;
  readonly good: string;
  readonly token: { value: string | null };
  constructor(answer: NasInfo | null, good: string, token: { value: string | null }) {
    super('', { get: () => token.value, set: (t) => (token.value = t) });
    this.answer = answer;
    this.good = good;
    this.token = token;
  }
  override async info() {
    return this.answer;
  }
  override async request(): Promise<Response> {
    this.tries++;
    if (this.token.value !== this.good) throw new AuthError();
    return new Response('{}', { status: 200, headers: { etag: '"v1"' } });
  }
}

const base = { askToken: async () => null, setToken: () => undefined, browserAvailable: false };

describe('chooseStore', () => {
  it('uses the desktop bridge first', async () => {
    const native = { load: async () => ({}) } as unknown as NativeData;
    expect((await chooseStore({ ...base, native, nas: null })).store.kind).toBe('native');
  });

  it('asks for the token until one works', async () => {
    const token = { value: null as string | null };
    const nas = new FakeNas({ name: 'Taskite', version: '1', auth: true }, 'right', token);
    const asked: boolean[] = [];
    const answers = ['wrong', 'right'];
    const choice = await chooseStore({
      ...base,
      native: null,
      nas,
      askToken: async (wrong) => {
        asked.push(wrong);
        return answers.shift() ?? null;
      },
      setToken: (t) => (token.value = t),
    });
    expect(choice.store.kind).toBe('nas');
    expect(asked).toEqual([false, true]);
  });

  it('keeps tasks in memory, and says so, when sign-in is cancelled or nothing else works', async () => {
    const nas = new FakeNas({ name: 'Taskite', version: '1', auth: true }, 'right', { value: null });
    const cancelled = await chooseStore({ ...base, native: null, nas });
    expect(cancelled.store).toBeInstanceOf(MemoryStore);
    expect(cancelled.notice).toMatch(/Not signed in/);
    const none = await chooseStore({ ...base, native: null, nas: new FakeNas(null, '', { value: null }) });
    expect(none.store).toBeInstanceOf(MemoryStore);
  });
});
