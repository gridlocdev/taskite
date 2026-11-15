import { describe, expect, it } from 'vitest';
import {
  dropOrder,
  duePreview,
  editorPatch,
  parseDueText,
  parseLabels,
  stepOrder,
} from '../src/app/forms.ts';

const TODAY = '2026-03-10';

describe('forms', () => {
  it('reads due dates', () => {
    expect(parseDueText('tomorrow', TODAY)).toEqual({ due: '2026-03-11', ok: true });
    expect(parseDueText(' none ', TODAY)).toEqual({ due: null, ok: true });
    expect(parseDueText('whenever', TODAY).ok).toBe(false);
    expect(duePreview('', TODAY)).toBe('No due date');
    expect(duePreview('today', TODAY)).toBe('Due today (2026-03-10)');
    expect(duePreview('blah', TODAY)).toBe('Not a date I understand yet.');
  });

  it('reads labels', () => {
    expect(parseLabels(' @phone, errands ,Phone, deep work,')).toEqual(['phone', 'errands', 'deep-work']);
  });

  it('works out the order after a drop', () => {
    const ids = ['a', 'b', 'c', 'd'];
    expect(dropOrder(ids, ['a'], 'c', true)).toEqual(['b', 'c', 'a', 'd']);
    expect(dropOrder(ids, ['d', 'b'], 'a', false)).toEqual(['b', 'd', 'a', 'c']);
    expect(dropOrder(ids, ['a'], 'b', false)).toBeNull();
    expect(dropOrder(ids, ['a'], 'a', true)).toBeNull();
  });

  describe('stepOrder', () => {
    // a has subtasks a1 and a2; b, c and d have none.
    const ids = ['a', 'a1', 'a2', 'b', 'c', 'd'];
    const parentOf = (id: string) => (id.length > 1 ? id[0]! : null);

    it('moves a task past its neighbour, subtasks and all', () => {
      expect(stepOrder(ids, parentOf, ['b'], -1)).toEqual(['b', 'a', 'a1', 'a2', 'c', 'd']);
      expect(stepOrder(ids, parentOf, ['a'], 1)).toEqual(['b', 'a', 'a1', 'a2', 'c', 'd']);
    });

    it('moves a block together, and gaps close against the edge', () => {
      expect(stepOrder(ids, parentOf, ['c', 'd'], -1)).toEqual(['a', 'a1', 'a2', 'c', 'd', 'b']);
      expect(stepOrder(ids, parentOf, ['a', 'c'], -1)).toEqual(['a', 'a1', 'a2', 'c', 'b', 'd']);
      expect(stepOrder(ids, parentOf, ['a', 'b'], -1)).toBeNull();
      expect(stepOrder(ids, parentOf, ['d'], 1)).toBeNull();
    });

    it('moves subtasks of one parent among their siblings', () => {
      expect(stepOrder(ids, parentOf, ['a2'], -1)).toEqual(['a', 'a2', 'a1', 'b', 'c', 'd']);
      expect(stepOrder(ids, parentOf, ['a1'], -1)).toBeNull();
    });

    it('moves the parent when a subtask is chosen with other tasks', () => {
      expect(stepOrder(ids, parentOf, ['a1', 'c'], 1)).toEqual(['b', 'a', 'a1', 'a2', 'd', 'c']);
    });
  });

  describe('editorPatch', () => {
    const start = { title: 'Buy milk', description: '', due: '', labels: 'home' };
    it('sends only the fields typed in', () => {
      expect(editorPatch(start, start)).toEqual({});
      expect(editorPatch(start, { ...start, description: ' two litres ' })).toEqual({
        description: 'two litres',
      });
      expect(editorPatch(start, { ...start, labels: 'home,  shop' })).toEqual({ labels: ['home', 'shop'] });
      expect(editorPatch(start, { ...start, due: '2026-03-12' })).toEqual({ due: '2026-03-12' });
    });
    it('keeps the old name when the name is cleared', () => {
      expect(editorPatch(start, { ...start, title: '  ' })).toEqual({});
    });
    it('ignores spacing and label order that mean the same thing', () => {
      expect(editorPatch(start, { ...start, title: 'Buy milk ', labels: ' home ' })).toEqual({});
    });
  });
});
