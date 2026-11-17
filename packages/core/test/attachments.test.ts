import { beforeEach, describe, expect, it } from 'vitest';
import {
  TaskList,
  attachmentIds,
  emptyData,
  isAttachmentId,
  normalize,
  parseDataFile,
  serialize,
  type Attachment,
} from '../src/index.ts';
import { checkInvariants } from './support/invariants.ts';

const A = '0b6f1c1e-3a4d-4c8e-9f00-1a2b3c4d5e6f';
const B = '7d3e2f10-5b6c-4d7e-8f90-a1b2c3d4e5f6';
const file = (id: string, name = 'notes.pdf'): Attachment => ({
  id,
  name,
  size: 1200,
  type: 'application/pdf',
});

let list: TaskList;

beforeEach(() => {
  let n = 0;
  list = new TaskList(emptyData(), { newId: () => `id${++n}`, now: () => 5 });
});

describe('attachments (PRD §4.8)', () => {
  it('takes only UUIDs as ids, so an id is always a safe file name', () => {
    expect(isAttachmentId(A)).toBe(true);
    expect(isAttachmentId(A.toUpperCase())).toBe(false);
    expect(isAttachmentId('../tasks.json')).toBe(false);
    expect(isAttachmentId(`${A}/x`)).toBe(false);
    expect(isAttachmentId(42)).toBe(false);
  });

  it('reads attachments from the file, dropping broken entries and repeated ids, and keeps unknown fields', () => {
    const data = normalize({
      tasks: [
        {
          id: 't1',
          title: 'One',
          attachments: [
            { id: A, name: 'a.png', size: 10, type: 'image/png', extra: 'kept' },
            { id: 'nope', name: 'bad id' },
            { id: B, name: '  ' },
            { id: B, name: 'b.txt', size: -1, type: 3 },
            'junk',
          ],
        },
        { id: 't2', title: 'Two', attachments: [{ id: A, name: 'again.png' }] },
        { id: 't3', title: 'Three', attachments: 'junk' },
      ],
    });
    expect(data.tasks[0]!.attachments).toEqual([
      { id: A, name: 'a.png', size: 10, type: 'image/png', extra: 'kept' },
      { id: B, name: 'b.txt', size: 0, type: '' },
    ]);
    expect('attachments' in data.tasks[1]!).toBe(false);
    expect('attachments' in data.tasks[2]!).toBe(false);
  });

  it('attaches files as one undo step, and leaves the field out of the file once none are left', () => {
    const task = list.addTask({ title: 'Report' });
    expect(serialize(list.data)).not.toContain('attachments');
    expect(list.addAttachments(task.id, [file(A), file(B, 'b.txt')])).toHaveLength(2);
    expect(list.getTask(task.id)?.attachments?.map((a) => a.name)).toEqual(['notes.pdf', 'b.txt']);

    list.removeAttachment(task.id, A);
    list.removeAttachment(task.id, B);
    expect('attachments' in list.getTask(task.id)!).toBe(false);
    expect(serialize(list.data)).not.toContain('attachments');

    list.undo();
    list.undo();
    expect(list.getTask(task.id)?.attachments).toHaveLength(2);
    list.undo();
    expect(list.getTask(task.id)?.attachments).toBeUndefined();
  });

  it('records no step for an attachment that changes nothing', () => {
    const task = list.addTask({ title: 'Report' });
    const other = list.addTask({ title: 'Other' });
    list.addAttachments(task.id, [file(A)]);
    const step = list.step;
    expect(list.addAttachments(other.id, [file(A)])).toEqual([]);
    expect(list.addAttachments(task.id, [file('not-a-uuid')])).toEqual([]);
    expect(list.addAttachments('missing', [file(B)])).toEqual([]);
    list.removeAttachment(task.id, B);
    list.removeAttachment(other.id, A);
    expect(list.step).toBe(step);
  });

  it('takes no attachments on a task in the Trash, and keeps them through the Trash and back', () => {
    const task = list.addTask({ title: 'Report' });
    list.addAttachments(task.id, [file(A)]);
    list.deleteTasks(task.id);
    expect(list.addAttachments(task.id, [file(B)])).toEqual([]);
    expect(attachmentIds(list.data)).toEqual(new Set([A]));
    list.restoreTasks(task.id);
    expect(list.getTask(task.id)?.attachments?.map((a) => a.id)).toEqual([A]);
  });

  it('names every file a task holds, the Trash included, until the task is deleted for good', () => {
    const kept = list.addTask({ title: 'Kept' });
    const gone = list.addTask({ title: 'Gone' });
    list.addAttachments(kept.id, [file(A)]);
    list.addAttachments(gone.id, [file(B)]);
    list.deleteTasks(gone.id);
    expect(attachmentIds(list.data)).toEqual(new Set([A, B]));
    list.purgeTasks(gone.id);
    expect(attachmentIds(list.data)).toEqual(new Set([A]));
    list.undo();
    expect(attachmentIds(list.data)).toEqual(new Set([A, B]));
  });

  it('saves and loads attachments unchanged', () => {
    const task = list.addTask({ title: 'Report' });
    list.addAttachments(task.id, [file(A), { ...file(B), name: 'été 漢字.txt', type: '' }]);
    checkInvariants(list.data);
    const parsed = parseDataFile(serialize(list.data), 5);
    expect(parsed.ok && parsed.data).toEqual(JSON.parse(serialize(list.data)));
  });
});
