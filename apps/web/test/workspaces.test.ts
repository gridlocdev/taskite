import { describe, expect, it, vi } from 'vitest';
import { MemoryWorkspaces, TaskSession, memoryRecovery, memoryWorkspaceMemory } from '@taskite/ui';
import { AppController } from '../src/app/controller.ts';
import { NEWER_LIST, UNREADABLE_LIST, WorkspaceDirectory, recoveryKey } from '../src/app/workspaces.ts';
import { NOW } from './helpers.ts';

const A = '0b6f1c1e-3a4d-4c8e-9f00-1a2b3c4d5e6f';
const B = '7d3e2f10-5b6c-4d7e-8f90-a1b2c3d4e5f6';

async function makeApp(listText: string | null = null, opts: { remembered?: string } = {}) {
  const stores = new MemoryWorkspaces(undefined, listText);
  const ids = [A, B];
  let stamp = 1000;
  const workspaces = new WorkspaceDirectory(stores, { now: () => stamp++, newId: () => ids.shift()! });
  await workspaces.load();
  const memory = memoryWorkspaceMemory(opts.remembered ?? null);
  let n = 0;
  const openWorkspace = (id: string) =>
    TaskSession.open(stores.open(id), {
      recovery: memoryRecovery(),
      wait: async () => undefined,
      now: () => NOW,
      newId: () => `${id.slice(0, 4)}-${++n}`,
    });
  const remembered = memory.get();
  const first = remembered && workspaces.find(remembered) ? remembered : 'main';
  const { session } = await openWorkspace(first);
  const app = new AppController(session, {
    now: () => NOW,
    wait: async () => undefined,
    workspaces,
    openWorkspace,
    workspaceId: first,
    workspaceMemory: memory,
  });
  return { app, stores, workspaces, memory };
}

const listOf = (...names: [string, string][]) =>
  JSON.stringify({ version: 1, workspaces: names.map(([id, name]) => ({ id, name })) });

describe('switching workspaces (PRD §14.2)', () => {
  it('shows one workspace at a time, each with its own tasks and settings', async () => {
    const { app, stores, memory } = await makeApp();
    app.list.addTask({ title: 'Main task' });
    app.list.updateSettings({ theme: 'dark' });
    expect(await app.newWorkspace('Games')).toBe(true);
    expect(app.workspaceId.value).toBe(A);
    expect(app.list.liveTasks()).toEqual([]);
    expect(app.theme.value).not.toBe('dark');
    app.list.addTask({ title: 'Boss fight' });
    await app.session.flush();
    expect(await app.switchWorkspace('main')).toBe(true);
    expect(app.list.liveTasks().map((t) => t.title)).toEqual(['Main task']);
    expect(app.theme.value).toBe('dark');
    expect(memory.id).toBe('main');
    expect(stores.open(A).text).toContain('Boss fight');
    expect(stores.open('main').text).toContain('Main task');
  });

  it('opens the workspace the device had open, or main when it is gone', async () => {
    const list = listOf(['main', 'Personal'], [A, 'Work']);
    expect((await makeApp(list, { remembered: A })).app.workspaceId.value).toBe(A);
    expect((await makeApp(list, { remembered: B })).app.workspaceId.value).toBe('main');
  });

  it("opens the other workspace's last view and clears the screen", async () => {
    const { app } = await makeApp(listOf(['main', 'Personal'], [A, 'Work']));
    app.go({ type: 'upcoming' });
    app.search.value = 'x';
    app.selected.value = new Set(['t']);
    app.open({ kind: 'settings' });
    await app.switchWorkspace(A);
    expect(app.view.value).toEqual({ type: 'today' });
    expect(app.search.value).toBe('');
    expect(app.selected.value.size).toBe(0);
    expect(app.dialog.value).toBeNull();
  });

  it('stays put when the changes here could not be saved', async () => {
    const { app, stores } = await makeApp(listOf(['main', 'Personal'], [A, 'Work']));
    stores.open('main').failSaves = 99;
    app.list.addTask({ title: 'Unsaved' });
    expect(await app.switchWorkspace(A)).toBe(false);
    expect(app.workspaceId.value).toBe('main');
    expect(app.notice.value?.text).toMatch(/Couldn't switch to Work/);
  });

  it('does not undo across workspaces', async () => {
    const { app } = await makeApp(listOf(['main', 'Personal'], [A, 'Work']));
    app.list.addTask({ title: 'Here' });
    await app.switchWorkspace(A);
    expect(app.list.canUndo).toBe(false);
  });

  it('switches by number for ⌃1–⌃9', async () => {
    const { app } = await makeApp(listOf(['main', 'Personal'], [A, 'Work']));
    app.switchToNumber(2);
    await vi.waitFor(() => expect(app.workspaceId.value).toBe(A));
    app.switchToNumber(9);
    expect(app.workspaceId.value).toBe(A);
  });

  it('names the workspace in the window title once there are two', async () => {
    const { app } = await makeApp();
    expect(app.windowTitle.value).toBe('Taskite');
    await app.newWorkspace('Games');
    expect(app.windowTitle.value).toBe('Games — Taskite');
  });

  it('keeps a recovery snapshot per workspace, main under the old key', () => {
    expect(recoveryKey('main')).toBe('taskite.unsaved');
    expect(recoveryKey(A)).toBe(`taskite.unsaved.${A}`);
  });
});

describe('managing workspaces (PRD §14.3)', () => {
  it('refuses an empty or taken name', async () => {
    const { app } = await makeApp(listOf(['main', 'Personal'], [A, 'Work']));
    expect(await app.newWorkspace('  ')).toBe(false);
    expect(await app.newWorkspace('work')).toBe(false);
    expect(app.notice.value?.text).toBe("There's already a workspace called Work.");
    expect(await app.renameWorkspace(A, 'WORK')).toBe(true);
    expect(app.currentWorkspace.value.name).toBe('Personal');
    expect(app.workspaceList.value[1]?.name).toBe('WORK');
  });

  it('deletes after asking, opens main if it was open, and Undo brings it back', async () => {
    const { app, stores } = await makeApp(listOf(['main', 'Personal'], [A, 'Work']), { remembered: A });
    app.list.addTask({ title: 'Ship it' });
    await app.session.flush();
    app.deleteWorkspace();
    const d = app.dialog.value;
    expect(d?.kind === 'confirm' && d.confirm).toBe('Delete Workspace');
    if (d?.kind !== 'confirm') return;
    d.run();
    await vi.waitFor(() => expect(app.notice.value?.text).toBe('Deleted workspace Work.'));
    expect(app.workspaceId.value).toBe('main');
    expect(app.workspaceList.value.map((w) => w.id)).toEqual(['main']);
    expect(stores.deleted.size).toBe(1);
    expect(app.notice.value?.text).toBe('Deleted workspace Work.');
    app.notice.value?.action?.run();
    await vi.waitFor(() => expect(app.workspaceList.value.map((w) => w.id)).toEqual(['main', A]));
    await app.switchWorkspace(A);
    expect(app.list.liveTasks().map((t) => t.title)).toEqual(['Ship it']);
  });

  it('never deletes main', async () => {
    const { app } = await makeApp();
    app.deleteWorkspace('main');
    expect(app.dialog.value).toBeNull();
  });

  it('opens main when the open workspace was deleted elsewhere', async () => {
    const { app, stores } = await makeApp(listOf(['main', 'Personal'], [A, 'Work']), { remembered: A });
    await stores.saveList(listOf(['main', 'Personal']), (await stores.loadList()).version);
    await app.refreshWorkspaces();
    expect(app.workspaceId.value).toBe('main');
    expect(app.notice.value?.text).toBe(
      'The workspace Work was deleted elsewhere, so Taskite opened Personal.',
    );
  });

  it('applies an edit again when the list changed elsewhere', async () => {
    const { app, stores } = await makeApp(listOf(['main', 'Personal']));
    await stores.saveList(listOf(['main', 'Personal'], [B, 'Other']), (await stores.loadList()).version);
    expect(await app.newWorkspace('Games')).toBe(true);
    expect(app.workspaceList.value.map((w) => w.name)).toEqual(['Personal', 'Other', 'Games']);
  });

  it('keeps an unreadable or newer list as it is, and says so', async () => {
    for (const [text, problem] of [
      ['{', UNREADABLE_LIST],
      ['{"version":2,"workspaces":[]}', NEWER_LIST],
    ] as const) {
      const { app, stores } = await makeApp(text);
      expect(app.workspaceList.value.map((w) => w.id)).toEqual(['main']);
      expect(await app.newWorkspace('Games')).toBe(false);
      expect(app.notice.value?.text).toContain(problem);
      expect((await stores.loadList()).text).toBe(text);
    }
  });
});
