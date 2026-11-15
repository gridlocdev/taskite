import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { parseArgs } from '../src/args.ts';
import { runCli } from '../src/cli.ts';
import { desktopFile, type CliIo } from '../src/io.ts';

/** 2026-03-10 (a Tuesday) at noon. */
const NOW = new Date(2026, 2, 10, 12).getTime();

let dir: string;
let file: string;

function io(env: Record<string, string> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const value: CliIo = {
    stdout: (t) => out.push(t),
    stderr: (t) => err.push(t),
    env: { TASKITE_FILE: file, ...env },
    cwd: dir,
    home: path.join(dir, 'home'),
    platform: 'darwin',
    now: () => NOW,
  };
  return { io: value, out: () => out.join(''), err: () => err.join('') };
}

async function cli(...argv: string[]) {
  const t = io();
  const code = await runCli(argv, t.io, '2.0.0');
  return { code, out: t.out(), err: t.err() };
}

const saved = () => JSON.parse(readFileSync(file, 'utf8')) as { tasks: { id: string; title: string }[] };

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'taskite-cli-'));
  file = path.join(dir, 'tasks.json');
});

describe('taskite', () => {
  it('adds with Quick Add and lists Today', async () => {
    const added = await cli('add', 'Call', 'mum', 'today', 'p1', '#Family', '@phone');
    expect(added.code).toBe(0);
    expect(added.out).toMatch(/^[0-9a-f-]{8} \(made the project "Family"\)\n$/);
    const list = await cli('list');
    expect(list.out).toContain('Today       p1  Call mum @phone  (Family)');
    const json = JSON.parse((await cli('list', 'today', '--json')).out);
    expect(json.tasks[0]).toMatchObject({
      title: 'Call mum',
      project: 'Family',
      priority: 1,
      due: '2026-03-10',
    });
  });

  it('adds to the Inbox with no date', async () => {
    await cli('add', 'Read a book');
    expect((await cli('list')).out).toBe('No tasks.\n');
    expect((await cli('list', 'inbox')).out).toContain('Read a book  (Inbox)');
  });

  it('completes by id prefix, and moves a repeating task on', async () => {
    await cli('add', 'Water plants every day');
    const id = saved().tasks[0]!.id;
    const done = await cli('done', id.slice(0, 4));
    expect(done.out).toBe('"Water plants" is next due tomorrow.\n');
    await cli('add', 'Once');
    const once = saved().tasks[1]!.id;
    expect((await cli('done', once)).out).toBe('Completed "Once".\n');
    expect((await cli('list', 'completed')).out).toContain('Once');
    expect((await cli('reopen', once)).out).toBe('Reopened "Once".\n');
  });

  it('trashes and restores', async () => {
    await cli('add', 'Old idea');
    const id = saved().tasks[0]!.id;
    expect((await cli('trash', id)).out).toBe('Moved "Old idea" to the Trash.\n');
    expect((await cli('list', 'trash')).out).toContain('Old idea');
    expect((await cli('restore', id)).out).toBe('Restored "Old idea".\n');
  });

  it('names a task by part of its title, and lists the choices when several match', async () => {
    await cli('add', 'Call mum');
    await cli('add', 'Call the bank');
    await cli('add', 'Call');
    expect((await cli('done', 'call', 'MUM')).out).toBe('Completed "Call mum".\n');
    // "call" equals one title exactly, so that one wins over the titles that only contain it.
    expect((await cli('done', 'call')).out).toBe('Completed "Call".\n');
    expect((await cli('reopen', 'call')).out).toBe('Reopened "Call".\n');
    const both = await cli('trash', 'cal');
    expect(both.code).toBe(1);
    expect(both.err).toContain('3 tasks match "cal"; give more of the title, or the id:');
    expect(both.err).toContain('Call the bank  (Inbox)');
    expect(saved().tasks.every((t) => !('deletedAt' in t) || t.deletedAt === null)).toBe(true);
  });

  it('prefers a title to an id that happens to start with the same letters', async () => {
    const task = (id: string, title: string) => ({ id, title, projectId: 'inbox', createdAt: 1 });
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        tasks: [
          task('bed12345-0000-4000-8000-000000000001', 'Other'),
          task('aaaa0000-0000-4000-8000-000000000002', 'Make bed'),
        ],
      }),
    );
    expect((await cli('done', 'bed')).out).toBe('Completed "Make bed".\n');
    // An id start names a task only from 4 characters, and only among the tasks the command can act on.
    expect((await cli('done', 'bed1')).out).toBe('Completed "Other".\n');
    expect((await cli('done', 'bed1')).code).toBe(1);
  });

  it('moves a task to a project and sets its due date', async () => {
    await cli('add', 'Fix the gate #Home_Repairs');
    await cli('add', 'Water plants');
    expect((await cli('move', 'water', '#home', 'repairs')).out).toBe(
      'Moved "Water plants" to Home Repairs.\n',
    );
    expect((await cli('move', 'water', 'Nowhere')).err).toBe(
      'taskite: no project is called "Nowhere" (see taskite projects)\n',
    );
    expect((await cli('due', 'water', 'tomorrow')).out).toBe('"Water plants" is due tomorrow.\n');
    expect(JSON.parse((await cli('list', 'upcoming', '--json')).out).tasks[0]).toMatchObject({
      title: 'Water plants',
      project: 'Home Repairs',
      due: '2026-03-11',
    });
    expect((await cli('due', 'water', 'none')).out).toBe('"Water plants" has no due date.\n');
    expect(await cli('due', 'water', 'someday', 'soon')).toMatchObject({ code: 2 });
    expect(await cli('due', 'water')).toMatchObject({ code: 2 });
  });

  it('adds into a section and lists sections as headings', async () => {
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        projects: [
          { id: 'inbox', name: 'Inbox', color: 'gray' },
          { id: 'w', name: 'Work', color: 'red', sections: [{ id: 's1', name: 'Doing' }] },
        ],
        tasks: [],
      }),
    );
    await cli('add', 'Loose #Work');
    expect((await cli('add', 'Report #Work', '--section', 'doing')).code).toBe(0);
    expect((await cli('add', 'Nope #Work', '--section', 'later')).err).toBe(
      'taskite: "Work" has no section "later"; its sections are "Doing"\n',
    );
    expect((await cli('add', 'Nope', '--section', 'later')).err).toBe('taskite: "Inbox" has no sections\n');
    const out = (await cli('list', '--project', 'work')).out;
    expect(out).toMatch(/Loose {2}\(Work\)\n\n## Doing\n.*Report {2}\(Work\)\n$/);
    expect(JSON.parse((await cli('list', '--project', 'work', '--json')).out).tasks[1]).toMatchObject({
      title: 'Report',
      section: 'Doing',
    });
  });

  it('lists by project and label, and counts projects', async () => {
    await cli('add', 'Report #Work @deep');
    await cli('add', 'Email #Work');
    expect((await cli('list', '--project', 'work')).out.trim().split('\n')).toHaveLength(2);
    expect((await cli('list', '--label=@deep')).out).toContain('Report');
    expect((await cli('projects')).out).toBe('   0  Inbox\n   2  Work\n');
  });

  it('says what went wrong, with exit 1 for problems and 2 for mistakes', async () => {
    expect(await cli('done', 'nope')).toMatchObject({
      code: 1,
      err: 'taskite: no task matches "nope"\n',
    });
    expect(await cli('frobnicate')).toMatchObject({
      code: 2,
      err: expect.stringContaining('unknown command'),
    });
    expect(await cli('list', 'someday')).toMatchObject({ code: 2 });
    expect(await cli('add')).toMatchObject({ code: 2 });
    expect(await cli('list', '--file')).toMatchObject({ code: 2, err: 'taskite: --file needs a value\n' });
    const json = await cli('done', 'nope', '--json');
    expect(JSON.parse(json.out)).toEqual({ ok: false, error: 'no task matches "nope"' });
  });

  it('refuses a file that changed while it ran', async () => {
    await cli('add', 'A');
    const t = io();
    const original = t.io.now;
    // Another writer changes the file between read and write: the save must not overwrite it.
    let touched = false;
    t.io.now = () => {
      if (!touched) {
        touched = true;
        writeFileSync(file, readFileSync(file, 'utf8') + ' ');
      }
      return original();
    };
    expect(await runCli(['add', 'B'], t.io, '2.0.0')).toBe(1);
    expect(t.err()).toContain('changed while this ran');
  });

  it('leaves a broken file alone', async () => {
    writeFileSync(file, '{ not json');
    expect((await cli('list')).code).toBe(1);
    expect(readFileSync(file, 'utf8')).toBe('{ not json');
  });

  it("won't make the desktop file before the app has brought over the old Tasks app's file", async () => {
    const t = io();
    const env = { ...t.io.env };
    delete env.TASKITE_FILE;
    const old = path.join(t.io.home, 'Library/Application Support/Tasks');
    mkdirSync(old, { recursive: true });
    writeFileSync(path.join(old, 'tasks.json'), '{}');
    expect(await runCli(['add', 'X'], { ...t.io, env }, '2.0.0')).toBe(1);
    expect(t.err()).toContain('open the Taskite app once first');
  });

  it('finds the desktop file on each system, and --file wins', () => {
    const base = { env: {}, home: '/h' };
    expect(desktopFile({ ...base, platform: 'darwin' })).toBe(
      '/h/Library/Application Support/Taskite/tasks.json',
    );
    expect(desktopFile({ ...base, platform: 'linux' })).toBe('/h/.config/Taskite/tasks.json');
    expect(desktopFile({ env: { APPDATA: 'C:/AD' }, home: '/h', platform: 'win32' })).toBe(
      path.join('C:/AD', 'Taskite', 'tasks.json'),
    );
    expect(parseArgs(['--file', 'x.json', 'path']).file).toBe('x.json');
  });

  it('prints help and the version', async () => {
    expect((await cli('--help')).out).toContain('Usage: taskite <command>');
    expect((await cli('help')).out).toContain('Exit codes');
    expect((await cli('--version')).out).toBe('2.0.0\n');
  });
});
