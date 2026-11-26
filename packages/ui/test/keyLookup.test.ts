import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CommandCatalog,
  LISTEN_IDLE_MS,
  listenForKeys,
  listeningForKeys,
  lookUpKey,
  pressedLabel,
  type CommandSpec,
  type KeyLookup,
  type ShortcutEvent,
} from '../src/index.ts';

const key = (e: Partial<ShortcutEvent>): ShortcutEvent => ({
  key: '',
  code: '',
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...e,
});

const spec = (id: string, shortcuts: string[]): CommandSpec => ({
  id,
  title: `Title ${id}`,
  description: id,
  group: 'Task',
  shortcuts,
  run: () => undefined,
});

const catalog = () =>
  new CommandCatalog([spec('menu', ['mod+k']), spec('inbox', ['g i']), spec('complete', ['space'])]);

/** A keydown as the window gets it; Node has no KeyboardEvent. */
function keydown(e: Partial<ShortcutEvent>): Event {
  return Object.assign(new Event('keydown', { cancelable: true }), key(e));
}

/**
 * The window: Press a Shortcut listens in its capture phase, and a key it stops never reaches the app's own
 * handler, which runs after (Node's EventTarget has no phases, so the app's handler is `press` itself).
 */
function page() {
  const target = new EventTarget();
  const reached: string[] = [];
  const press = (e: Partial<ShortcutEvent>): Event => {
    const event = keydown(e);
    target.dispatchEvent(event);
    if (!event.cancelBubble) reached.push((event as KeyboardEvent).key);
    return event;
  };
  return { target, reached, press };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Press a Shortcut', () => {
  it('writes the key pressed the way shortcuts are written', () => {
    expect(pressedLabel(key({ key: 'k', code: 'KeyK', metaKey: true }), true)).toBe('⌘K');
    expect(pressedLabel(key({ key: 'Z', code: 'KeyZ', ctrlKey: true, shiftKey: true }), false)).toBe(
      'Ctrl+Shift+Z',
    );
    expect(pressedLabel(key({ key: 'ArrowDown', code: 'ArrowDown' }), true)).toBe('↓');
    expect(pressedLabel(key({ key: '¬', code: 'KeyL', altKey: true, metaKey: true }), true)).toBe('⌥⌘L');
  });

  it('names the command a key runs, a sequence by both keys, and says when none does', () => {
    const c = catalog();
    const menu = lookUpKey(c, key({ key: 'k', code: 'KeyK', metaKey: true }), null, 0, true);
    expect(menu).toMatchObject({ kind: 'found', keys: ['⌘K'], command: { id: 'menu' } });
    const g = lookUpKey(c, key({ key: 'g', code: 'KeyG' }), null, 0, true);
    expect(g).toMatchObject({ kind: 'found', keys: ['G'], command: 'more' });
    const i = lookUpKey(c, key({ key: 'i', code: 'KeyI' }), 'G', 100, true);
    expect(i).toMatchObject({ kind: 'found', keys: ['G', 'I'], command: { id: 'inbox' } });
    expect(lookUpKey(c, key({ key: 'j', code: 'KeyJ', metaKey: true }), null, 0, true)).toMatchObject({
      kind: 'found',
      keys: ['⌘J'],
      command: null,
    });
    expect(lookUpKey(c, key({ key: 'Meta', code: 'MetaLeft', metaKey: true }), null, 0, true)).toEqual({
      kind: 'wait',
    });
  });

  it('keeps every key from the page and runs nothing, then lets keys through once stopped', () => {
    const { target, reached, press } = page();
    const found: KeyLookup[] = [];
    const stop = listenForKeys(
      target,
      (e, prev) => lookUpKey(catalog(), e, prev, 0, true),
      (f) => void found.push(f),
      () => undefined,
    );
    expect(listeningForKeys()).toBe(true);
    const e = press({ key: 'k', code: 'KeyK', metaKey: true });
    expect(e.defaultPrevented).toBe(true);
    expect(reached).toEqual([]);
    expect(found).toMatchObject([{ keys: ['⌘K'], command: { id: 'menu' } }]);
    stop();
    expect(listeningForKeys()).toBe(false);
    press({ key: 'k', code: 'KeyK', metaKey: true });
    expect(reached).toEqual(['k']);
  });

  it('never takes Escape: it stops listening and goes on to the page', () => {
    const { target, reached, press } = page();
    const onStop = vi.fn();
    listenForKeys(
      target,
      () => ({ kind: 'wait' }),
      () => undefined,
      onStop,
    );
    const esc = press({ key: 'Escape', code: 'Escape' });
    expect(esc.defaultPrevented).toBe(false);
    expect(reached).toEqual(['Escape']);
    expect(onStop).toHaveBeenCalledOnce();
    expect(listeningForKeys()).toBe(false);
    press({ key: 'a', code: 'KeyA' });
    expect(reached).toEqual(['Escape', 'a']);
  });

  it('lets go of the keyboard when looking a key up throws, so keys reach the app again', () => {
    const { target, reached, press } = page();
    const onStop = vi.fn();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    listenForKeys(
      target,
      () => {
        throw new Error('broken lookup');
      },
      () => undefined,
      onStop,
    );
    press({ key: 'k', code: 'KeyK', metaKey: true });
    expect(onStop).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalled();
    expect(listeningForKeys()).toBe(false);
    press({ key: 'j', code: 'KeyJ' });
    expect(reached).toEqual(['j']);
    error.mockRestore();
  });

  it('lets go of the keyboard when the found handler throws too', () => {
    const { target, reached, press } = page();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    listenForKeys(
      target,
      () => ({ kind: 'found', keys: ['J'], command: null }),
      () => {
        throw new Error('broken view');
      },
      () => undefined,
    );
    press({ key: 'j', code: 'KeyJ' });
    press({ key: 'j', code: 'KeyJ' });
    expect(reached).toEqual(['j']);
    expect(listeningForKeys()).toBe(false);
    error.mockRestore();
  });

  it('stops on its own after a while without a key', () => {
    vi.useFakeTimers();
    const { target, reached, press } = page();
    const onStop = vi.fn();
    listenForKeys(
      target,
      () => ({ kind: 'wait' }),
      () => undefined,
      onStop,
    );
    vi.advanceTimersByTime(LISTEN_IDLE_MS - 1);
    press({ key: 'Shift', code: 'ShiftLeft', shiftKey: true });
    vi.advanceTimersByTime(LISTEN_IDLE_MS - 1);
    expect(onStop).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onStop).toHaveBeenCalledOnce();
    press({ key: 'a', code: 'KeyA' });
    expect(reached).toEqual(['a']);
  });

  it('stopping twice is harmless, and stopping quietly calls no onStop', () => {
    const { target } = page();
    const onStop = vi.fn();
    const stop = listenForKeys(
      target,
      () => ({ kind: 'wait' }),
      () => undefined,
      onStop,
    );
    stop();
    stop();
    expect(onStop).not.toHaveBeenCalled();
    expect(listeningForKeys()).toBe(false);
  });
});
