import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readDataFile, versionOf, writeCopy, writeDataFile } from '../src/index.ts';

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'taskite-files-'));
  file = path.join(dir, 'sub', 'tasks.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('the data file on disk', () => {
  it('reads nothing when there is no file', async () => {
    expect(await readDataFile(file)).toEqual({ text: null, version: null });
  });

  it('creates the file and its folder, then saves only from the version it read', async () => {
    const first = await writeDataFile(file, 'one', null);
    expect(first).toEqual({ ok: true, version: versionOf('one') });
    expect(await writeDataFile(file, 'two', null)).toEqual({
      ok: false,
      reason: 'conflict',
      version: versionOf('one'),
    });
    expect(await writeDataFile(file, 'two', versionOf('one'))).toMatchObject({ ok: true });
    expect(await readFile(file, 'utf8')).toBe('two');
  });

  it('refuses to save over a file changed by someone else', async () => {
    await writeDataFile(file, 'one', null);
    await writeFile(file, 'edited elsewhere');
    expect(await writeDataFile(file, 'mine', versionOf('one'))).toMatchObject({ ok: false });
    expect(await readFile(file, 'utf8')).toBe('edited elsewhere');
  });

  it('leaves no temp files behind', async () => {
    await writeDataFile(file, 'one', null);
    expect(await readdir(path.dirname(file))).toEqual(['tasks.json']);
  });

  it('runs saves one at a time, so the second sees the first', async () => {
    await writeDataFile(file, 'a', null);
    const [x, y] = await Promise.all([
      writeDataFile(file, 'b', versionOf('a')),
      writeDataFile(file, 'c', versionOf('a')),
    ]);
    expect([x.ok, y.ok]).toEqual([true, false]);
  });

  it('names copies by date, and never replaces one', async () => {
    const now = new Date(2026, 10, 15, 9, 5, 7);
    const a = await writeCopy(file, 'A', 'copy', now);
    const b = await writeCopy(file, 'B', 'copy', now);
    expect(path.basename(b)).toBe('tasks.copy-2026-11-15-090507-2.json');
    expect([await readFile(a, 'utf8'), await readFile(b, 'utf8')]).toEqual(['A', 'B']);
  });
});

describe('saving alongside other programs', () => {
  it('keeps a symlinked file a symlink and writes through it', async () => {
    const real = path.join(dir, 'real', 'tasks.json');
    await mkdir(path.dirname(real), { recursive: true });
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(real, 'one');
    await symlink(real, file);
    expect(await writeDataFile(file, 'two', versionOf('one'))).toMatchObject({ ok: true });
    expect((await lstat(file)).isSymbolicLink()).toBe(true);
    expect(await readFile(real, 'utf8')).toBe('two');
  });

  it('waits while another process holds the lock, then checks the version it left', async () => {
    await writeDataFile(file, 'one', null);
    const lock = path.join(path.dirname(file), '.tasks.json.lock');
    await writeFile(lock, '');
    const saving = writeDataFile(file, 'mine', versionOf('one'));
    await new Promise((r) => setTimeout(r, 60));
    expect(await readFile(file, 'utf8')).toBe('one');
    // The other process saves, then lets go.
    await writeFile(file, 'theirs');
    await rm(lock);
    expect(await saving).toEqual({ ok: false, reason: 'conflict', version: versionOf('theirs') });
    expect(await readFile(file, 'utf8')).toBe('theirs');
    expect(await readdir(path.dirname(file))).toEqual(['tasks.json']);
  });

  it('takes over a lock left by a process that died', async () => {
    await writeDataFile(file, 'one', null);
    const lock = path.join(path.dirname(file), '.tasks.json.lock');
    await writeFile(lock, '');
    const old = new Date(Date.now() - 60_000);
    await utimes(lock, old, old);
    expect(await writeDataFile(file, 'two', versionOf('one'))).toMatchObject({ ok: true });
    expect(await readdir(path.dirname(file))).toEqual(['tasks.json']);
  });
});
