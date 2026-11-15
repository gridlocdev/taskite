import { describe, expect, it } from 'vitest';
import {
  CommandCatalog,
  SEQUENCE_MS,
  filterEntries,
  formatSequence,
  parseSequence,
  sequenceAccelerator,
  type CommandSpec,
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

function catalog(extra: CommandSpec[] = []) {
  const ran: string[] = [];
  const spec = (id: string, shortcuts: string[], more: Partial<CommandSpec> = {}): CommandSpec => ({
    id,
    title: id,
    description: id,
    group: 'Task',
    shortcuts,
    run: () => void ran.push(id),
    ...more,
  });
  const c = new CommandCatalog([
    spec('menu', ['mod+k', 'mod+p'], { global: true, group: 'View' }),
    spec('complete', ['space']),
    spec('edit', ['enter']),
    spec('undo', ['mod+z'], { global: true, group: 'Edit' }),
    spec('redo', ['mod+shift+z', 'mod+y'], { global: true, group: 'Edit' }),
    spec('shortcuts', ['?', 'mod+/'], { group: 'Help' }),
    spec('inbox', ['g i'], { group: 'Go' }),
    spec('today', ['g t'], { group: 'Go' }),
    spec('down', ['down', 'j'], { group: 'Select' }),
    spec('extend', ['shift+down'], { group: 'Select' }),
    ...extra,
  ]);
  return { c, ran };
}

const id = (r: ReturnType<CommandCatalog['forEvent']>) =>
  r?.kind === 'run' ? r.command.id : (r?.kind ?? null);

describe('shortcuts', () => {
  it('mod is ⌘ on a Mac and Ctrl elsewhere', () => {
    const { c } = catalog();
    expect(id(c.forEvent(key({ key: 'k', metaKey: true }), 'list', 0, true))).toBe('menu');
    expect(id(c.forEvent(key({ key: 'k', ctrlKey: true }), 'list', 0, true))).toBeNull();
    expect(id(c.forEvent(key({ key: 'k', ctrlKey: true }), 'list', 0, false))).toBe('menu');
  });

  it('extra modifiers stop a match; Shift is ignored for symbols such as ?', () => {
    const { c } = catalog();
    expect(id(c.forEvent(key({ key: 'z', metaKey: true, shiftKey: true }), 'list', 0, true))).toBe('redo');
    expect(id(c.forEvent(key({ key: 'ArrowDown', shiftKey: true }), 'list', 0, true))).toBe('extend');
    expect(id(c.forEvent(key({ key: 'j', altKey: true }), 'list', 0, true))).toBeNull();
    expect(id(c.forEvent(key({ key: '?', shiftKey: true, code: 'Slash' }), 'list', 0, true))).toBe(
      'shortcuts',
    );
  });

  it('plain keys only count in the list; global chords work in text fields', () => {
    const { c } = catalog();
    expect(id(c.forEvent(key({ key: ' ' }), 'text', 0, true))).toBeNull();
    expect(id(c.forEvent(key({ key: 'z', metaKey: true }), 'text', 0, true))).toBe('undo');
    expect(id(c.forEvent(key({ key: ' ' }), 'control', 0, true))).toBeNull();
    expect(id(c.forEvent(key({ key: 'Enter' }), 'control', 0, true))).toBeNull();
    expect(id(c.forEvent(key({ key: 'j' }), 'control', 0, true))).toBe('down');
    expect(id(c.forEvent(key({ key: ' ' }), 'list', 0, true))).toBe('complete');
  });

  it('two-key shortcuts wait for the second key, for a while', () => {
    const { c } = catalog();
    expect(id(c.forEvent(key({ key: 'g' }), 'list', 0, true))).toBe('wait');
    expect(id(c.forEvent(key({ key: 't' }), 'list', 100, true))).toBe('today');
    expect(id(c.forEvent(key({ key: 'g' }), 'list', 1000, true))).toBe('wait');
    expect(id(c.forEvent(key({ key: 'i' }), 'list', 1000 + SEQUENCE_MS + 1, true))).toBeNull();
    expect(id(c.forEvent(key({ key: 'g' }), 'text', 0, true))).toBeNull();
  });

  it('are shown with the right key caps, and only single chords go in menus', () => {
    expect(formatSequence(parseSequence('mod+shift+z'), true)).toEqual(['⇧⌘Z']);
    expect(formatSequence(parseSequence('mod+shift+z'), false)).toEqual(['Ctrl+Shift+Z']);
    expect(formatSequence(parseSequence('g i'), true)).toEqual(['G', 'I']);
    expect(formatSequence(parseSequence('backspace'), true)).toEqual(['⌫']);
    expect(sequenceAccelerator(parseSequence('mod+k'))).toBe('CmdOrCtrl+K');
    expect(sequenceAccelerator(parseSequence('shift+down'))).toBe('Shift+Down');
    expect(sequenceAccelerator(parseSequence('g i'))).toBeNull();
  });
});

describe('the catalog', () => {
  it('runs enabled commands through the gate and keeps 5 recents', () => {
    let open = true;
    const { c, ran } = catalog([
      {
        id: 'off',
        title: 'Off',
        description: 'Off',
        group: 'Task',
        run: () => undefined,
        enabled: () => false,
      },
    ]);
    expect(c.run('off')).toBe(false);
    c.gate = () => open;
    open = false;
    expect(c.run('undo')).toBe(false);
    open = true;
    for (const x of ['undo', 'redo', 'inbox', 'today', 'down', 'extend', 'undo']) c.run(x);
    expect(ran).toEqual(['undo', 'redo', 'inbox', 'today', 'down', 'extend', 'undo']);
    expect(c.recentIds).toEqual(['undo', 'extend', 'down', 'today', 'inbox']);
  });

  it('refuses duplicate ids', () => {
    expect(
      () =>
        new CommandCatalog(
          [1, 2].map(() => ({
            id: 'x',
            title: 'x',
            description: 'x',
            group: 'Task' as const,
            run: () => undefined,
          })),
        ),
    ).toThrow();
  });
});

describe('the command menu', () => {
  const entries = [
    { id: 'today', title: 'Go to Today', group: 'Go' },
    { id: 'inbox', title: 'Go to Inbox', group: 'Go' },
    { id: 'new', title: 'New Task', group: 'File' },
  ];

  const ids = (q: string, recent?: string[]) => filterEntries(entries, q, recent).map((e) => e.id);

  it('matches every word and puts recent commands first', () => {
    expect(ids('go in')).toEqual(['inbox']);
    expect(ids('file')).toEqual(['new']);
    expect(ids('', ['new', 'today'])).toEqual(['new', 'today', 'inbox']);
    expect(ids('go')).toEqual(['today', 'inbox']);
    expect(ids('go', ['inbox'])).toEqual(['inbox', 'today']);
  });

  it('ignores spaces, so a run-together or split query finds the same command', () => {
    expect(ids('newtask')).toEqual(['new']);
    expect(ids('new task')).toEqual(['new']);
    expect(ids('gotoinbox')).toEqual(['inbox']);
    expect(ids('goto inb')).toEqual(['inbox']);
  });

  it('ranks title matches over keyword matches, and finds letters in order last', () => {
    const more = [...entries, { id: 'add', title: 'Add Project', group: 'File', keywords: 'new list' }];
    expect(filterEntries(more, 'new').map((e) => e.id)).toEqual(['new', 'add']);
    expect(filterEntries(more, 'newlist').map((e) => e.id)).toEqual(['add']);
    expect(ids('nwtk')).toEqual(['new']);
    expect(ids('zzz')).toEqual([]);
  });
});
