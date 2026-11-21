import { describe, expect, it } from 'vitest';
import {
  MAIN_WORKSPACE_ID,
  addWorkspace,
  defaultWorkspaceList,
  deletedWorkspaceDir,
  findWorkspaceByName,
  isWorkspaceId,
  parseWorkspaces,
  removeWorkspace,
  renameWorkspace,
  restoreWorkspace,
  serializeWorkspaces,
  workspaceDataPath,
  workspaceDir,
  workspaceNameProblem,
  type WorkspaceList,
} from '../src/index.ts';

const A = '0b6f1c1e-3a4d-4c8e-9f00-1a2b3c4d5e6f';
const B = '7d3e2f10-5b6c-4d7e-8f90-a1b2c3d4e5f6';

function parsed(text: string | null): WorkspaceList {
  const r = parseWorkspaces(text);
  if (!r.ok) throw new Error(r.reason);
  return r.list;
}

const two = (): WorkspaceList => ({
  version: 1,
  workspaces: [
    { id: MAIN_WORKSPACE_ID, name: 'Personal' },
    { id: A, name: 'Work' },
  ],
});

describe('reading workspaces.json (PRD §14.1)', () => {
  it('is main alone, named Tasks, when there is no file', () => {
    expect(parsed(null)).toEqual({ version: 1, workspaces: [{ id: 'main', name: 'Tasks' }] });
  });

  it('keeps the order and unknown fields, and reads a byte-order mark', () => {
    const text = `\uFEFF${JSON.stringify({
      version: 1,
      extra: 'kept',
      workspaces: [
        { id: A, name: 'Work', icon: 'briefcase' },
        { id: 'main', name: 'Personal' },
      ],
    })}`;
    expect(parsed(text)).toEqual({
      version: 1,
      extra: 'kept',
      workspaces: [
        { id: A, name: 'Work', icon: 'briefcase' },
        { id: 'main', name: 'Personal' },
      ],
    });
  });

  it('drops entries without a workspace id or a name, and repeated ids', () => {
    const list = parsed(
      JSON.stringify({
        workspaces: [
          { id: 'main', name: 'Personal' },
          { id: '../etc', name: 'Escape' },
          { id: A.toUpperCase(), name: 'Upper' },
          { id: B, name: '  ' },
          { id: B },
          'junk',
          null,
          { id: A, name: 'Work' },
          { id: A, name: 'Work again' },
        ],
      }),
    );
    expect(list.workspaces.map((w) => w.name)).toEqual(['Personal', 'Work']);
  });

  it('puts a missing main first', () => {
    const list = parsed(JSON.stringify({ version: 1, workspaces: [{ id: A, name: 'Work' }] }));
    expect(list.workspaces).toEqual([
      { id: 'main', name: 'Tasks' },
      { id: A, name: 'Work' },
    ]);
  });

  it('reads a list that is not an array as main alone', () => {
    expect(parsed('{"workspaces": 3}').workspaces).toEqual([{ id: 'main', name: 'Tasks' }]);
  });

  it('reports text that is not a JSON object', () => {
    for (const text of ['{', '[]', 'null', '"x"'])
      expect(parseWorkspaces(text)).toEqual({ ok: false, reason: 'corrupt' });
  });

  it('refuses a list from a newer Taskite', () => {
    expect(parseWorkspaces('{"version": 2, "workspaces": []}')).toEqual({
      ok: false,
      reason: 'newer',
      version: 2,
    });
  });

  it('writes two-space JSON that reads back the same', () => {
    const list = two();
    const text = serializeWorkspaces(list);
    expect(text).toBe(JSON.stringify(list, null, 2));
    expect(parsed(text)).toEqual(list);
  });
});

describe('workspace ids and paths', () => {
  it('accepts main and lower-case UUIDs only', () => {
    expect(isWorkspaceId('main')).toBe(true);
    expect(isWorkspaceId(A)).toBe(true);
    for (const id of ['', 'Main', A.toUpperCase(), '../x', `${A}/..`, 'workspaces', 3, null])
      expect(isWorkspaceId(id)).toBe(false);
  });

  it('puts main at tasks.json and the others in workspaces/<id>/', () => {
    expect(workspaceDir('main')).toBe('');
    expect(workspaceDataPath('main')).toBe('tasks.json');
    expect(workspaceDir(A)).toBe(`workspaces/${A}`);
    expect(workspaceDataPath(A)).toBe(`workspaces/${A}/tasks.json`);
  });

  it('never builds a path from a bad id', () => {
    expect(() => workspaceDir('../../etc')).toThrow();
    expect(() => workspaceDataPath('x')).toThrow();
    expect(() => deletedWorkspaceDir('main', 1)).toThrow();
  });

  it('moves a deleted workspace under workspaces/.deleted with the time', () => {
    expect(deletedWorkspaceDir(A, 1700)).toBe(`workspaces/.deleted/${A}-1700`);
  });
});

describe('workspace names (PRD §14.3)', () => {
  it('needs a name of at most 80 characters', () => {
    const list = defaultWorkspaceList();
    expect(workspaceNameProblem(list, '   ')).toBe('Give the workspace a name.');
    expect(workspaceNameProblem(list, 'x'.repeat(81))).toMatch(/at most 80/);
    expect(workspaceNameProblem(list, ` ${'x'.repeat(80)} `)).toBeNull();
  });

  it('refuses a name another workspace has, ignoring case, but not its own', () => {
    const list = two();
    expect(workspaceNameProblem(list, ' work ')).toBe("There's already a workspace called Work.");
    expect(workspaceNameProblem(list, 'WORK', A)).toBeNull();
  });

  it('finds a workspace by name ignoring case', () => {
    expect(findWorkspaceByName(two(), ' WORK')?.id).toBe(A);
    expect(findWorkspaceByName(two(), 'Games')).toBeUndefined();
  });
});

describe('editing the list', () => {
  it('adds a workspace last with a trimmed name, leaving the old list alone', () => {
    const list = two();
    const next = addWorkspace(list, B, '  Games ');
    expect(next.workspaces.map((w) => w.name)).toEqual(['Personal', 'Work', 'Games']);
    expect(list.workspaces).toHaveLength(2);
  });

  it('refuses a bad or taken id and a refused name', () => {
    expect(() => addWorkspace(two(), 'main', 'Games')).toThrow();
    expect(() => addWorkspace(two(), A, 'Games')).toThrow();
    expect(() => addWorkspace(two(), B, 'work')).toThrow(/already/);
  });

  it('renames, and returns the same list when nothing changes', () => {
    const list = two();
    expect(renameWorkspace(list, A, 'Job').workspaces[1]).toEqual({ id: A, name: 'Job' });
    expect(renameWorkspace(list, A, ' Work ')).toBe(list);
    expect(renameWorkspace(list, B, 'Games')).toBe(list);
    expect(renameWorkspace(list, 'main', 'Home').workspaces[0]?.name).toBe('Home');
  });

  it('removes any workspace but main', () => {
    const list = two();
    expect(removeWorkspace(list, A).workspaces.map((w) => w.id)).toEqual(['main']);
    expect(removeWorkspace(list, B)).toBe(list);
    expect(() => removeWorkspace(list, 'main')).toThrow();
  });

  it('puts a removed workspace back in its place, never before main', () => {
    const list = addWorkspace(two(), B, 'Games');
    const work = { id: A, name: 'Work' };
    const removed = removeWorkspace(list, A);
    expect(restoreWorkspace(removed, work, 1)).toEqual(list);
    expect(restoreWorkspace(removed, work, 0).workspaces.map((w) => w.id)).toEqual(['main', A, B]);
    expect(restoreWorkspace(removed, work, 9).workspaces.map((w) => w.id)).toEqual(['main', B, A]);
    expect(restoreWorkspace(list, work, 1)).toBe(list);
  });
});
